//! Filesystem watching for open repositories (`repository-changed`).
//!
//! The working tree root is watched non-recursively and each top-level
//! directory recursively, except `.git` and directories Git ignores, so
//! `.git/objects`, `node_modules` or `target` never generate events. Events
//! from ignored directories nested deeper (`apps/app/node_modules`) are
//! dropped by the debouncer using a per-directory ignore cache. The
//! per-worktree Git directory (index, HEAD) and the common directory's refs
//! are watched separately so linked worktrees work. Events are debounced:
//! 300 ms after the last event, at most 2 s after the first.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use notify::event::EventKind;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use rustgit_git_engine::{GitExecutor, RepositoryLocation};
use serde::Serialize;

pub const QUIET_PERIOD: Duration = Duration::from_millis(300);
pub const MAX_DELAY: Duration = Duration::from_secs(2);
pub const MAX_WATCHED: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeScope {
    Worktree,
    Index,
    Refs,
    Head,
    Config,
}

pub const ALL_SCOPES: [ChangeScope; 5] = [
    ChangeScope::Worktree,
    ChangeScope::Index,
    ChangeScope::Refs,
    ChangeScope::Head,
    ChangeScope::Config,
];

/// Payload of the `repository-changed` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryChanged {
    pub repository_id: i64,
    pub scopes: Vec<ChangeScope>,
}

pub type ChangeSink = Arc<dyn Fn(RepositoryChanged) + Send + Sync>;

#[derive(Debug, thiserror::Error)]
pub enum WatchError {
    #[error("could not watch the repository: {0}")]
    Notify(#[from] notify::Error),
    #[error("could not read the repository directory: {0}")]
    Io(#[from] std::io::Error),
}

/// Paths that decide which scope an event belongs to.
#[derive(Debug, Clone)]
struct Layout {
    root: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
}

fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

impl Layout {
    fn new(location: &RepositoryLocation) -> Self {
        Self {
            root: canonical(&location.root),
            git_dir: canonical(&location.git_dir),
            common_dir: canonical(&location.common_dir),
        }
    }

    /// Scope for a changed path, or `None` for paths that never matter
    /// (objects, logs, lock files).
    fn classify(&self, path: &Path) -> Option<ChangeScope> {
        let is_lock: bool = path
            .extension()
            .is_some_and(|extension| extension == "lock");
        for git_dir in [&self.git_dir, &self.common_dir] {
            if let Ok(relative) = path.strip_prefix(git_dir) {
                if is_lock {
                    return None;
                }
                let first: Option<&str> = relative
                    .components()
                    .next()
                    .and_then(|c| c.as_os_str().to_str());
                return match first {
                    Some("index") => Some(ChangeScope::Index),
                    Some(
                        "HEAD" | "MERGE_HEAD" | "CHERRY_PICK_HEAD" | "REVERT_HEAD" | "REBASE_HEAD"
                        | "ORIG_HEAD" | "rebase-merge" | "rebase-apply",
                    ) => Some(ChangeScope::Head),
                    Some("refs" | "packed-refs" | "FETCH_HEAD") => Some(ChangeScope::Refs),
                    Some("config") => Some(ChangeScope::Config),
                    _ => None,
                };
            }
        }
        if path.starts_with(&self.root) {
            return Some(ChangeScope::Worktree);
        }
        None
    }
}

/// Top-level directories of the working tree that Git does not ignore.
fn watched_top_level_dirs(git: &GitExecutor, root: &Path) -> Result<Vec<PathBuf>, WatchError> {
    let mut names: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let name: String = entry.file_name().to_string_lossy().into_owned();
            if name != ".git" {
                names.push(name);
            }
        }
    }
    let ignored: BTreeSet<String> = ignored_names(git, root, &names);
    Ok(names
        .into_iter()
        .filter(|name: &String| !ignored.contains(name))
        .map(|name: String| root.join(name))
        .collect())
}

fn ignored_names(git: &GitExecutor, root: &Path, names: &[String]) -> BTreeSet<String> {
    if names.is_empty() {
        return BTreeSet::new();
    }
    let mut input: Vec<u8> = Vec::new();
    for name in names {
        input.extend_from_slice(name.as_bytes());
        input.push(0);
    }
    // Exit code 1 means "nothing ignored"; any failure just means we watch more.
    match git.run_unchecked(root, ["check-ignore", "--stdin", "-z"], Some(&input)) {
        Ok(output) => output
            .stdout
            .split(|byte: &u8| *byte == 0)
            .filter(|name: &&[u8]| !name.is_empty())
            .map(|name: &[u8]| {
                String::from_utf8_lossy(name)
                    .trim_end_matches('/')
                    .to_owned()
            })
            .collect(),
        Err(error) => {
            tracing::warn!(%error, "could not check ignored directories");
            BTreeSet::new()
        }
    }
}

const IGNORE_CACHE_LIMIT: usize = 4096;

/// Remembers which directories Git ignores, so events from nested ignored
/// trees (`apps/app/node_modules`, `crates/x/target`) can be dropped cheaply.
#[derive(Default)]
struct IgnoreCache {
    directories: HashMap<PathBuf, bool>,
}

impl IgnoreCache {
    /// True when `path` lies inside a directory below `root` that Git ignores.
    fn in_ignored_directory(&mut self, git: &GitExecutor, root: &Path, path: &Path) -> bool {
        if path.file_name().is_some_and(|name| name == ".gitignore") {
            self.directories.clear();
            return false;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            return false;
        };
        let Some(parent) = relative.parent() else {
            return false;
        };
        let mut current: PathBuf = PathBuf::new();
        for component in parent.components() {
            current.push(component);
            if self.is_ignored(git, root, &current) {
                return true;
            }
        }
        false
    }

    fn is_ignored(&mut self, git: &GitExecutor, root: &Path, relative: &Path) -> bool {
        if let Some(known) = self.directories.get(relative) {
            return *known;
        }
        if self.directories.len() >= IGNORE_CACHE_LIMIT {
            self.directories.clear();
        }
        let argument: String = format!("{}/", relative.to_string_lossy().replace('\\', "/"));
        // Exit 0 means ignored; any failure means "watch it" (not ignored).
        let ignored: bool = git
            .run_unchecked(
                root,
                [
                    "--literal-pathspecs",
                    "check-ignore",
                    "-q",
                    "--",
                    argument.as_str(),
                ],
                None,
            )
            .map(|output| output.status.success())
            .unwrap_or(false);
        self.directories.insert(relative.to_path_buf(), ignored);
        ignored
    }
}

struct WatchedRepository {
    // Dropping the watcher closes the event channel and ends the debounce
    // thread, which only holds a weak reference.
    _watcher: Arc<Mutex<RecommendedWatcher>>,
}

/// Watches up to [`MAX_WATCHED`] repositories; the oldest is dropped first.
#[derive(Default)]
pub struct RepositoryWatchers {
    watched: Mutex<Vec<(i64, WatchedRepository)>>,
}

impl RepositoryWatchers {
    pub fn watch(
        &self,
        git: &GitExecutor,
        repository_id: i64,
        location: &RepositoryLocation,
        sink: ChangeSink,
    ) -> Result<(), WatchError> {
        self.unwatch(repository_id);
        let layout: Layout = Layout::new(location);
        let (sender, receiver): (
            Sender<notify::Result<Event>>,
            Receiver<notify::Result<Event>>,
        ) = mpsc::channel();
        let mut watcher: RecommendedWatcher = notify::recommended_watcher(sender)?;

        watcher.watch(&layout.root, RecursiveMode::NonRecursive)?;
        for directory in watched_top_level_dirs(git, &layout.root)? {
            watcher.watch(&directory, RecursiveMode::Recursive)?;
        }
        watcher.watch(&layout.git_dir, RecursiveMode::NonRecursive)?;
        if layout.common_dir != layout.git_dir {
            watcher.watch(&layout.common_dir, RecursiveMode::NonRecursive)?;
        }
        let refs: PathBuf = layout.common_dir.join("refs");
        if refs.is_dir() {
            watcher.watch(&refs, RecursiveMode::Recursive)?;
        }

        let watcher: Arc<Mutex<RecommendedWatcher>> = Arc::new(Mutex::new(watcher));
        spawn_debouncer(
            repository_id,
            layout,
            receiver,
            sink,
            Arc::downgrade(&watcher),
            git.clone(),
        );
        let mut watched = self
            .watched
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if watched.len() >= MAX_WATCHED {
            watched.remove(0);
        }
        watched.push((repository_id, WatchedRepository { _watcher: watcher }));
        Ok(())
    }

    pub fn unwatch(&self, repository_id: i64) {
        if let Ok(mut watched) = self.watched.lock() {
            watched.retain(|(id, _)| *id != repository_id);
        }
    }

    pub fn is_watching(&self, repository_id: i64) -> bool {
        self.watched
            .lock()
            .map(|watched| watched.iter().any(|(id, _)| *id == repository_id))
            .unwrap_or(false)
    }
}

/// Starts watching a directory created directly under the root, unless Git
/// ignores it.
fn watch_new_top_level_dir(
    watcher: &Weak<Mutex<RecommendedWatcher>>,
    git: &GitExecutor,
    layout: &Layout,
    path: &Path,
) {
    let Some(name) = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
    else {
        return;
    };
    if name == ".git" || !ignored_names(git, &layout.root, std::slice::from_ref(&name)).is_empty() {
        return;
    }
    if let Some(watcher) = watcher.upgrade() {
        let result: notify::Result<()> = watcher
            .lock()
            .map_err(|_| notify::Error::generic("watcher lock poisoned"))
            .and_then(|mut watcher| watcher.watch(path, RecursiveMode::Recursive));
        if let Err(error) = result {
            tracing::warn!(%error, path = %path.display(), "could not watch new directory");
        }
    }
}

fn spawn_debouncer(
    repository_id: i64,
    layout: Layout,
    receiver: Receiver<notify::Result<Event>>,
    sink: ChangeSink,
    watcher: Weak<Mutex<RecommendedWatcher>>,
    git: GitExecutor,
) {
    std::thread::spawn(move || {
        let mut pending: BTreeSet<ChangeScope> = BTreeSet::new();
        let mut first: Option<Instant> = None;
        let mut last: Instant = Instant::now();
        let mut ignore_cache: IgnoreCache = IgnoreCache::default();
        loop {
            let timeout: Duration = match first {
                None => Duration::from_secs(3600),
                Some(started) => {
                    let quiet_left: Duration = QUIET_PERIOD.saturating_sub(last.elapsed());
                    let max_left: Duration = MAX_DELAY.saturating_sub(started.elapsed());
                    quiet_left.min(max_left)
                }
            };
            match receiver.recv_timeout(timeout) {
                Ok(Ok(event)) => {
                    if matches!(event.kind, EventKind::Access(_)) {
                        continue;
                    }
                    for path in &event.paths {
                        if let Some(scope) = layout.classify(path) {
                            if scope == ChangeScope::Worktree
                                && ignore_cache.in_ignored_directory(&git, &layout.root, path)
                            {
                                continue;
                            }
                            pending.insert(scope);
                        }
                        let top_level: bool = path
                            .parent()
                            .is_some_and(|parent| canonical(parent) == layout.root);
                        if top_level && path.is_dir() && !matches!(event.kind, EventKind::Remove(_))
                        {
                            watch_new_top_level_dir(&watcher, &git, &layout, path);
                        }
                    }
                    if !pending.is_empty() {
                        first.get_or_insert_with(Instant::now);
                        last = Instant::now();
                    }
                }
                Ok(Err(error)) => {
                    // Overflow or watch failure: ask for a full refresh.
                    tracing::warn!(%error, repository_id, "filesystem watcher error");
                    pending.extend(ALL_SCOPES);
                    first.get_or_insert_with(Instant::now);
                    last = Instant::now();
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        sink(RepositoryChanged {
                            repository_id,
                            scopes: std::mem::take(&mut pending).into_iter().collect(),
                        });
                    }
                    first = None;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> Layout {
        Layout {
            root: PathBuf::from("/repo"),
            git_dir: PathBuf::from("/repo/.git/worktrees/wt"),
            common_dir: PathBuf::from("/repo/.git"),
        }
    }

    #[test]
    fn classifies_paths_into_scopes() {
        let layout: Layout = layout();
        assert_eq!(
            layout.classify(Path::new("/repo/src/main.rs")),
            Some(ChangeScope::Worktree)
        );
        assert_eq!(
            layout.classify(Path::new("/repo/.git/worktrees/wt/index")),
            Some(ChangeScope::Index)
        );
        assert_eq!(
            layout.classify(Path::new("/repo/.git/worktrees/wt/HEAD")),
            Some(ChangeScope::Head)
        );
        assert_eq!(
            layout.classify(Path::new("/repo/.git/refs/heads/main")),
            Some(ChangeScope::Refs)
        );
        assert_eq!(
            layout.classify(Path::new("/repo/.git/packed-refs")),
            Some(ChangeScope::Refs)
        );
        assert_eq!(
            layout.classify(Path::new("/repo/.git/config")),
            Some(ChangeScope::Config)
        );
        assert_eq!(
            layout.classify(Path::new("/repo/.git/objects/ab/cdef")),
            None
        );
        assert_eq!(layout.classify(Path::new("/repo/.git/index.lock")), None);
        assert_eq!(layout.classify(Path::new("/elsewhere/file")), None);
    }
}
