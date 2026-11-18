use std::collections::VecDeque;
use std::ffi::{OsStr, OsString};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::error::{GitError, GitResult};
use crate::redact::redact_credentials;

/// Maximum number of command records kept in memory for the command inspector.
const HISTORY_CAPACITY: usize = 200;

/// A completed Git invocation, with credentials redacted, for display in the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRecord {
    /// Monotonically increasing per executor (per process in the app).
    pub sequence: u64,
    /// Unix time in milliseconds when the command started.
    pub started_at: u64,
    pub args: Vec<String>,
    pub cwd: String,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub stderr: String,
}

const TOKEN_ACTIVE: u8 = 0;
const TOKEN_CANCELLED: u8 = 1;
const TOKEN_COMMITTED: u8 = 2;

/// Cooperative cancellation for long-running commands. Cloning shares the state.
///
/// Once an operation reaches a step that must not be interrupted it calls
/// [`CancelToken::commit`]; from then on [`CancelToken::cancel`] refuses, so
/// callers can tell the user truthfully whether cancelling took effect.
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<AtomicU8>);

impl CancelToken {
    /// A token that can never be cancelled (e.g. for push).
    pub fn uncancellable() -> Self {
        Self(Arc::new(AtomicU8::new(TOKEN_COMMITTED)))
    }

    /// Requests cancellation. Returns `false` if the operation already
    /// committed to finishing (or was cancelled before).
    pub fn cancel(&self) -> bool {
        self.0
            .compare_exchange(
                TOKEN_ACTIVE,
                TOKEN_CANCELLED,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst) == TOKEN_CANCELLED
    }

    /// Marks the start of a non-cancellable step. Returns `false` if
    /// cancellation was requested first, in which case the step must not run.
    pub fn commit(&self) -> bool {
        match self.0.compare_exchange(
            TOKEN_ACTIVE,
            TOKEN_COMMITTED,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => true,
            Err(state) => state == TOKEN_COMMITTED,
        }
    }
}

/// Runs the Git executable with explicit arguments. Never uses a shell.
#[derive(Debug, Clone)]
pub struct GitExecutor {
    git_path: PathBuf,
    history: Arc<Mutex<VecDeque<CommandRecord>>>,
    sequence: Arc<AtomicU64>,
    /// Extra environment for every Git process (the credential prompt helper).
    extra_env: Arc<Vec<(OsString, OsString)>>,
}

impl GitExecutor {
    /// Returns a copy that also sets `variables` on every Git process it starts.
    #[must_use]
    pub fn with_env(mut self, variables: Vec<(OsString, OsString)>) -> Self {
        self.extra_env = Arc::new(variables);
        self
    }

    /// Creates an executor for the given Git binary (`git` resolves through `PATH`).
    pub fn new(git_path: impl Into<PathBuf>) -> Self {
        Self {
            git_path: git_path.into(),
            history: Arc::new(Mutex::new(VecDeque::with_capacity(HISTORY_CAPACITY))),
            sequence: Arc::new(AtomicU64::new(0)),
            extra_env: Arc::new(Vec::new()),
        }
    }

    pub fn git_path(&self) -> &Path {
        &self.git_path
    }

    /// Returns the installed Git version string, e.g. `2.54.0.windows.1`.
    pub fn version(&self) -> GitResult<String> {
        let current_dir: PathBuf = std::env::current_dir()?;
        let stdout: String = self.run_text(&current_dir, ["--version"])?;
        stdout
            .trim()
            .strip_prefix("git version ")
            .map(str::to_owned)
            .ok_or_else(|| GitError::Parse {
                command: "--version".to_owned(),
                detail: stdout.trim().to_owned(),
            })
    }

    /// Runs Git and returns stdout as UTF-8 (lossy) text when the exit code is zero.
    pub fn run_text<I, S>(&self, cwd: &Path, args: I) -> GitResult<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let output: Output = self.run(cwd, args, None)?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// Runs Git, optionally writing `stdin`, and fails on a non-zero exit code.
    pub fn run<I, S>(&self, cwd: &Path, args: I, stdin: Option<&[u8]>) -> GitResult<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args: Vec<OsString> = collect_args(args);
        let output: Output = self.execute(cwd, &args, stdin)?;
        check_success(&args, output)
    }

    /// Runs Git and returns its output regardless of exit code.
    pub fn run_unchecked<I, S>(
        &self,
        cwd: &Path,
        args: I,
        stdin: Option<&[u8]>,
    ) -> GitResult<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args: Vec<OsString> = collect_args(args);
        self.execute(cwd, &args, stdin)
    }

    /// Runs Git, delivering each stderr progress line (split on `\r` and `\n`)
    /// to `on_stderr_line` as it arrives. When `cancel` is triggered the Git
    /// process is killed and [`GitError::Cancelled`] is returned.
    pub fn run_streaming<I, S>(
        &self,
        cwd: &Path,
        args: I,
        cancel: &CancelToken,
        on_stderr_line: &mut dyn FnMut(&str),
    ) -> GitResult<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args: Vec<OsString> = collect_args(args);
        let started: Instant = Instant::now();
        let started_at: u64 = unix_millis();
        let mut child: Child = self.spawn_with(cwd, &args, false, true)?;

        let stdout_reader: JoinHandle<Vec<u8>> = read_all_in_thread(child.stdout.take());
        let (sender, receiver): (Sender<String>, Receiver<String>) = mpsc::channel();
        let stderr_pipe: Option<std::process::ChildStderr> = child.stderr.take();
        let stderr_reader: JoinHandle<Vec<u8>> =
            std::thread::spawn(move || stream_lines(stderr_pipe, &sender));

        let mut cancelled: bool = false;
        let status: ExitStatus = loop {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(line) => on_stderr_line(&line),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    if let Some(status) = child.try_wait()? {
                        break status;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
            if cancel.is_cancelled() && !cancelled {
                cancelled = true;
                kill_process_tree(&mut child);
            }
            if cancelled {
                break child.wait()?;
            }
        };
        // Drain lines still queued after exit.
        while let Ok(line) = receiver.try_recv() {
            on_stderr_line(&line);
        }

        let output: Output = Output {
            status,
            stdout: stdout_reader.join().unwrap_or_default(),
            stderr: stderr_reader.join().unwrap_or_default(),
        };
        self.record(cwd, &args, started_at, started.elapsed(), &output);
        if cancelled {
            return Err(GitError::Cancelled);
        }
        check_success(&args, output)
    }

    fn spawn(&self, cwd: &Path, args: &[OsString], piped_stdin: bool) -> GitResult<Child> {
        self.spawn_with(cwd, args, piped_stdin, false)
    }

    /// `own_group` puts the process in a new process group (Unix) so the
    /// whole tree (remote helpers, ssh) can be killed on cancellation.
    fn spawn_with(
        &self,
        cwd: &Path,
        args: &[OsString],
        piped_stdin: bool,
        own_group: bool,
    ) -> GitResult<Child> {
        let mut command: Command = Command::new(&self.git_path);
        command
            .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
            .args(args)
            .current_dir(cwd)
            // Never block on an interactive credential prompt or terminal editor.
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_EDITOR", "true")
            // Stable English messages so failures can be classified. Paths and
            // commit text are unaffected (-z, core.quotepath=false).
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .stdin(if piped_stdin {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command.envs(self.extra_env.iter().map(|(k, v)| (k, v)));
        hide_console_window(&mut command);
        if own_group {
            new_process_group(&mut command);
        }
        command.spawn().map_err(|error: std::io::Error| {
            if error.kind() == ErrorKind::NotFound {
                GitError::GitNotFound(self.git_path.clone())
            } else {
                GitError::Io(error)
            }
        })
    }

    fn execute(&self, cwd: &Path, args: &[OsString], stdin: Option<&[u8]>) -> GitResult<Output> {
        let started: Instant = Instant::now();
        let started_at: u64 = unix_millis();
        let mut child: Child = self.spawn(cwd, args, stdin.is_some())?;

        // Write stdin from another thread so a child that fills its stdout
        // pipe before reading all input cannot deadlock us.
        let writer: Option<JoinHandle<std::io::Result<()>>> = match (stdin, child.stdin.take()) {
            (Some(input), Some(mut pipe)) => {
                let input: Vec<u8> = input.to_vec();
                Some(std::thread::spawn(move || pipe.write_all(&input)))
            }
            _ => None,
        };
        let output: Output = child.wait_with_output()?;
        if let Some(writer) = writer {
            // A child may exit without reading all input (e.g. on error);
            // its exit status is what matters, so a broken pipe is ignored.
            match writer.join() {
                Ok(Err(error)) if error.kind() != ErrorKind::BrokenPipe => {
                    return Err(GitError::Io(error));
                }
                _ => {}
            }
        }
        self.record(cwd, args, started_at, started.elapsed(), &output);
        Ok(output)
    }

    fn record(
        &self,
        cwd: &Path,
        args: &[OsString],
        started_at: u64,
        elapsed: Duration,
        output: &Output,
    ) {
        let record: CommandRecord = CommandRecord {
            sequence: self.sequence.fetch_add(1, Ordering::SeqCst) + 1,
            started_at,
            args: args
                .iter()
                .map(|arg: &OsString| redact_credentials(&arg.to_string_lossy()))
                .collect(),
            cwd: cwd.to_string_lossy().into_owned(),
            duration_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
            exit_code: output.status.code(),
            stderr: redact_credentials(String::from_utf8_lossy(&output.stderr).trim()),
        };
        tracing::debug!(
            args = ?record.args,
            duration_ms = record.duration_ms,
            exit_code = ?record.exit_code,
            "git command finished"
        );
        if let Ok(mut history) = self.history.lock() {
            if history.len() == HISTORY_CAPACITY {
                history.pop_front();
            }
            history.push_back(record);
        }
    }

    /// Returns the most recent command records, oldest first.
    pub fn history(&self) -> Vec<CommandRecord> {
        self.history
            .lock()
            .map(|history| history.iter().cloned().collect())
            .unwrap_or_default()
    }
}

fn check_success(args: &[OsString], output: Output) -> GitResult<Output> {
    if output.status.success() {
        Ok(output)
    } else {
        Err(GitError::CommandFailed {
            command: command_label(args),
            exit_code: output.status.code(),
            stderr: redact_credentials(String::from_utf8_lossy(&output.stderr).trim()),
        })
    }
}

fn read_all_in_thread<R: Read + Send + 'static>(pipe: Option<R>) -> JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buffer: Vec<u8> = Vec::new();
        if let Some(mut pipe) = pipe {
            // Read errors end the stream; the exit status reports failures.
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    })
}

/// Reads `pipe` to the end, sending each `\r`- or `\n`-terminated line, and
/// returns everything read.
fn stream_lines<R: Read>(pipe: Option<R>, sender: &Sender<String>) -> Vec<u8> {
    let mut all: Vec<u8> = Vec::new();
    let Some(mut pipe) = pipe else {
        return all;
    };
    let mut line: Vec<u8> = Vec::new();
    let mut chunk: [u8; 4096] = [0; 4096];
    loop {
        let read: usize = match pipe.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        all.extend_from_slice(&chunk[..read]);
        for byte in &chunk[..read] {
            if *byte == b'\r' || *byte == b'\n' {
                if !line.is_empty() {
                    // The receiver may be gone after cancellation.
                    let _ = sender.send(String::from_utf8_lossy(&line).into_owned());
                    line.clear();
                }
            } else {
                line.push(*byte);
            }
        }
    }
    if !line.is_empty() {
        let _ = sender.send(String::from_utf8_lossy(&line).into_owned());
    }
    all
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn collect_args<I, S>(args: I) -> Vec<OsString>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    args.into_iter()
        .map(|arg: S| arg.as_ref().to_os_string())
        .collect()
}

fn command_label(args: &[OsString]) -> String {
    let joined: Vec<String> = args
        .iter()
        .map(|arg: &OsString| arg.to_string_lossy().into_owned())
        .collect();
    redact_credentials(&joined.join(" "))
}

/// Kills `child` and every process it started (Git's remote helpers and ssh
/// keep its pipes open otherwise). Errors mean the processes already exited.
fn kill_process_tree(child: &mut Child) {
    let pid: String = child.id().to_string();
    #[cfg(windows)]
    {
        let mut taskkill: Command = Command::new("taskkill");
        taskkill
            .args(["/T", "/F", "/PID", &pid])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_console_window(&mut taskkill);
        let _ = taskkill.status();
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-KILL", &format!("-{pid}")])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

#[cfg(unix)]
fn new_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn new_process_group(_command: &mut Command) {}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}
