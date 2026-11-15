use std::ffi::{OsStr, OsString};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{GitError, GitResult};
use crate::redact::redact_credentials;

/// Maximum number of command records kept in memory for the command inspector.
const HISTORY_CAPACITY: usize = 200;

/// A completed Git invocation, with credentials redacted, for display in the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRecord {
    pub args: Vec<String>,
    pub cwd: String,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub stderr: String,
}

/// Runs the Git executable with explicit arguments. Never uses a shell.
#[derive(Debug, Clone)]
pub struct GitExecutor {
    git_path: PathBuf,
    history: Arc<Mutex<Vec<CommandRecord>>>,
}

impl GitExecutor {
    /// Creates an executor for the given Git binary (`git` resolves through `PATH`).
    pub fn new(git_path: impl Into<PathBuf>) -> Self {
        Self {
            git_path: git_path.into(),
            history: Arc::new(Mutex::new(Vec::new())),
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
        if output.status.success() {
            Ok(output)
        } else {
            Err(GitError::CommandFailed {
                command: command_label(&args),
                exit_code: output.status.code(),
                stderr: redact_credentials(String::from_utf8_lossy(&output.stderr).trim()),
            })
        }
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

    fn execute(&self, cwd: &Path, args: &[OsString], stdin: Option<&[u8]>) -> GitResult<Output> {
        let mut command: Command = Command::new(&self.git_path);
        command
            .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
            .args(args)
            .current_dir(cwd)
            // Never block on an interactive credential prompt from a GUI process.
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console_window(&mut command);

        let started: Instant = Instant::now();
        let mut child: std::process::Child = command.spawn().map_err(|error: std::io::Error| {
            if error.kind() == ErrorKind::NotFound {
                GitError::GitNotFound(self.git_path.clone())
            } else {
                GitError::Io(error)
            }
        })?;

        if let Some(input) = stdin {
            use std::io::Write;
            let mut pipe: std::process::ChildStdin = child
                .stdin
                .take()
                .ok_or_else(|| GitError::Io(std::io::Error::other("stdin pipe was not opened")))?;
            pipe.write_all(input)?;
        }

        let output: Output = child.wait_with_output()?;
        let elapsed: Duration = started.elapsed();

        let record: CommandRecord = CommandRecord {
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
        self.push_record(record);

        Ok(output)
    }

    /// Returns the most recent command records, newest last.
    pub fn history(&self) -> Vec<CommandRecord> {
        self.history
            .lock()
            .map(|history| history.clone())
            .unwrap_or_default()
    }

    fn push_record(&self, record: CommandRecord) {
        if let Ok(mut history) = self.history.lock() {
            if history.len() == HISTORY_CAPACITY {
                history.remove(0);
            }
            history.push(record);
        }
    }
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

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}
