//! Commit creation and the context the commit composer needs.

use std::path::Path;

use serde::Serialize;

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::status::{FileStatus, InProgress, StatusSnapshot, in_progress, read_status};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SigningMode {
    Off,
    Gpg,
    Ssh,
    X509,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadCommit {
    pub oid: String,
    pub summary: String,
    pub message: String,
    /// Whether HEAD is reachable from its upstream (amending would rewrite
    /// published history). `None` when there is no upstream.
    pub on_upstream: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitContext {
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub signing: SigningMode,
    pub head: Option<HeadCommit>,
    pub in_progress: InProgress,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedCommit {
    pub oid: String,
    pub summary: String,
}

pub fn commit_context(git: &GitExecutor, root: &Path) -> GitResult<CommitContext> {
    let config: Config = read_config(
        git,
        root,
        &["commit.gpgsign", "gpg.format", "user.name", "user.email"],
    )?;
    let signing: SigningMode = if config.flag("commit.gpgsign") {
        match config.value("gpg.format").as_deref() {
            Some("ssh") => SigningMode::Ssh,
            Some("x509") => SigningMode::X509,
            _ => SigningMode::Gpg,
        }
    } else {
        SigningMode::Off
    };

    let head: Option<HeadCommit> = match head_oid(git, root)? {
        Some(oid) => {
            let message: String = git
                .run_text(root, ["log", "-1", "--format=%B", oid.as_str()])?
                .trim_end()
                .to_owned();
            let on_upstream: Option<bool> = upstream_contains_head(git, root)?;
            Some(HeadCommit {
                oid,
                summary: message.lines().next().unwrap_or_default().to_owned(),
                message,
                on_upstream,
            })
        }
        None => None,
    };

    Ok(CommitContext {
        author_name: config.value("user.name"),
        author_email: config.value("user.email"),
        signing,
        head,
        in_progress: in_progress(git, root)?,
    })
}

/// The commit HEAD points at, or `None` before the first commit.
fn head_oid(git: &GitExecutor, root: &Path) -> GitResult<Option<String>> {
    let output: std::process::Output =
        git.run_unchecked(root, ["rev-parse", "--verify", "--quiet", "HEAD"], None)?;
    let oid: String = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    Ok((output.status.success() && !oid.is_empty()).then_some(oid))
}

fn upstream_contains_head(git: &GitExecutor, root: &Path) -> GitResult<Option<bool>> {
    let upstream: std::process::Output = git.run_unchecked(
        root,
        [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        None,
    )?;
    if !upstream.status.success() {
        return Ok(None);
    }
    let output: std::process::Output = git.run_unchecked(
        root,
        ["merge-base", "--is-ancestor", "HEAD", "@{upstream}"],
        None,
    )?;
    match output.status.code() {
        Some(0) => Ok(Some(true)),
        Some(1) => Ok(Some(false)),
        code => Err(GitError::CommandFailed {
            command: "merge-base --is-ancestor".to_owned(),
            exit_code: code,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        }),
    }
}

/// Configuration entries read in one `git config` call. Keys are lowercase
/// (the form Git prints); a key set without `=` has no value.
struct Config {
    entries: Vec<(String, Option<String>)>,
}

impl Config {
    /// The effective (last) entry for `key`, if set.
    fn last(&self, key: &str) -> Option<&Option<String>> {
        self.entries
            .iter()
            .rev()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value)
    }

    /// Like `git config --get`: the effective value, `None` when unset or empty.
    fn value(&self, key: &str) -> Option<String> {
        self.last(key)
            .and_then(|value| value.as_deref())
            .map(str::trim)
            .filter(|value: &&str| !value.is_empty())
            .map(str::to_owned)
    }

    /// Like `git config --type=bool --get`, treating invalid values as false.
    fn flag(&self, key: &str) -> bool {
        match self.last(key) {
            None => false,
            Some(None) => true,
            Some(Some(value)) => {
                let value: String = value.trim().to_ascii_lowercase();
                match value.as_str() {
                    "true" | "yes" | "on" => true,
                    "" | "false" | "no" | "off" => false,
                    number => number.parse::<i64>().is_ok_and(|number: i64| number != 0),
                }
            }
        }
    }
}

/// Reads `keys` (lowercase) from every configuration scope at once.
/// Fails with `IdentityMissing` unless Git would know the commit author.
/// Works outside a repository too, where only global and system config apply.
pub(crate) fn ensure_identity(git: &GitExecutor, dir: &Path) -> GitResult<()> {
    let identity: Option<Config> = read_config(git, dir, &["user.name", "user.email"]).ok();
    let missing: Vec<&str> = ["user.name", "user.email"]
        .into_iter()
        .filter(|key: &&str| {
            identity
                .as_ref()
                .and_then(|config: &Config| config.value(key))
                .is_none()
        })
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(GitError::IdentityMissing(missing.join(", ")))
    }
}

fn read_config(git: &GitExecutor, root: &Path, keys: &[&str]) -> GitResult<Config> {
    let pattern: String = format!(
        "^({})$",
        keys.iter()
            .map(|key: &&str| key.replace('.', "\\."))
            .collect::<Vec<String>>()
            .join("|")
    );
    let output: std::process::Output = git.run_unchecked(
        root,
        ["config", "--null", "--get-regexp", pattern.as_str()],
        None,
    )?;
    match output.status.code() {
        Some(0) => Ok(parse_config(&output.stdout)),
        // Exit code 1: none of the keys is set.
        Some(1) => Ok(Config {
            entries: Vec::new(),
        }),
        code => Err(GitError::CommandFailed {
            command: "config --get-regexp".to_owned(),
            exit_code: code,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        }),
    }
}

/// Parses `git config --null` records: `key\nvalue\0`, or `key\0` without a value.
fn parse_config(raw: &[u8]) -> Config {
    let entries: Vec<(String, Option<String>)> = raw
        .split(|byte: &u8| *byte == 0)
        .filter(|record: &&[u8]| !record.is_empty())
        .map(|record: &[u8]| {
            let record: String = String::from_utf8_lossy(record).into_owned();
            match record.split_once('\n') {
                Some((key, value)) => (key.to_owned(), Some(value.to_owned())),
                None => (record, None),
            }
        })
        .collect();
    Config { entries }
}

/// Commits the index. Hooks and signing follow the user's Git configuration;
/// any failure is returned with Git's stderr.
pub fn create_commit(
    git: &GitExecutor,
    root: &Path,
    message: &str,
    amend: bool,
) -> GitResult<CreatedCommit> {
    if message.trim().is_empty() {
        return Err(GitError::InvalidRequest(
            "the commit message is empty".to_owned(),
        ));
    }
    ensure_identity(git, root)?;
    if !amend {
        let status: StatusSnapshot = read_status(git, root)?;
        let staged: bool = status
            .files
            .iter()
            .any(|file: &FileStatus| file.staged.is_some());
        if !staged && status.in_progress != InProgress::Merging {
            return Err(GitError::NothingToCommit);
        }
    }

    let mut args: Vec<&str> = vec!["commit", "--file=-"];
    if amend {
        args.push("--amend");
    }
    git.run(root, args, Some(message.as_bytes()))?;

    let created: String = git.run_text(root, ["log", "-1", "--format=%H%n%s", "HEAD"])?;
    let (oid, summary): (&str, &str) = created
        .trim_end()
        .split_once('\n')
        .unwrap_or((created.trim(), ""));
    Ok(CreatedCommit {
        oid: oid.to_owned(),
        summary: summary.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_takes_the_last_value_and_follows_git_bool_rules() {
        let config: Config = parse_config(
            b"user.name\nGlobal\0user.name\nLocal\0x.bare\0x.empty\n\0x.num\n2\0x.no\nOff\0",
        );
        assert_eq!(config.value("user.name").as_deref(), Some("Local"));
        assert_eq!(config.value("x.empty"), None);
        assert_eq!(config.value("missing"), None);
        assert!(config.flag("x.bare"));
        assert!(config.flag("x.num"));
        assert!(!config.flag("x.empty"));
        assert!(!config.flag("x.no"));
        assert!(!config.flag("missing"));
    }
}
