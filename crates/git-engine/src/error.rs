use std::path::PathBuf;

use serde::Serialize;

/// Errors produced while locating or running Git.
#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error(
        "Git executable was not found ({0}). Install Git or configure its location in Settings."
    )]
    GitNotFound(PathBuf),

    #[error("'{0}' is not inside a Git repository.")]
    NotARepository(PathBuf),

    #[error("Path '{0}' does not exist or is not a directory.")]
    InvalidPath(PathBuf),

    #[error("git {command} failed with exit code {exit_code:?}: {stderr}")]
    CommandFailed {
        command: String,
        exit_code: Option<i32>,
        stderr: String,
    },

    #[error("Unexpected output from git {command}: {detail}")]
    Parse { command: String, detail: String },

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("The diff changed since it was displayed ({0}). Reload it and try again.")]
    StaleDiff(String),

    #[error("Nothing is staged. Stage changes before committing.")]
    NothingToCommit,

    #[error("Git does not know who you are. Set user.name and user.email (missing: {0}).")]
    IdentityMissing(String),

    #[error("Your local changes would be overwritten: {}. Commit or stash them first.", .0.join(", "))]
    WouldOverwriteChanges(Vec<String>),

    #[error("Branch '{0}' is not fully merged. Deleting it may lose commits.")]
    BranchNotFullyMerged(String),

    #[error("A branch named '{0}' already exists.")]
    BranchExists(String),

    #[error("'{0}' is not a valid branch name.")]
    InvalidRefName(String),

    #[error("A {0} is in progress. Continue or abort it first.")]
    OperationInProgress(String),

    #[error("The operation was cancelled.")]
    Cancelled,

    #[error("Authentication failed: {0}")]
    AuthenticationFailed(String),

    #[error("I/O error while running Git: {0}")]
    Io(#[from] std::io::Error),
}

/// Stable machine-readable error category for the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GitErrorKind {
    GitNotFound,
    NotARepository,
    InvalidPath,
    CommandFailed,
    Parse,
    InvalidRequest,
    StaleDiff,
    NothingToCommit,
    IdentityMissing,
    WouldOverwriteChanges,
    BranchNotFullyMerged,
    BranchExists,
    InvalidRefName,
    OperationInProgress,
    Cancelled,
    AuthenticationFailed,
    Io,
}

/// Fragments of Git and helper output that mean credentials were rejected or
/// unavailable (Git runs with `LC_ALL=C`).
const AUTHENTICATION_MARKERS: &[&str] = &[
    "Authentication failed",
    "could not read Username",
    "could not read Password",
    "Permission denied (publickey",
    "terminal prompts disabled",
    "Invalid username or password",
    "HTTP Basic: Access denied",
];

impl GitError {
    pub fn kind(&self) -> GitErrorKind {
        match self {
            Self::GitNotFound(_) => GitErrorKind::GitNotFound,
            Self::NotARepository(_) => GitErrorKind::NotARepository,
            Self::InvalidPath(_) => GitErrorKind::InvalidPath,
            Self::CommandFailed { .. } => GitErrorKind::CommandFailed,
            Self::Parse { .. } => GitErrorKind::Parse,
            Self::InvalidRequest(_) => GitErrorKind::InvalidRequest,
            Self::StaleDiff(_) => GitErrorKind::StaleDiff,
            Self::NothingToCommit => GitErrorKind::NothingToCommit,
            Self::IdentityMissing(_) => GitErrorKind::IdentityMissing,
            Self::WouldOverwriteChanges(_) => GitErrorKind::WouldOverwriteChanges,
            Self::BranchNotFullyMerged(_) => GitErrorKind::BranchNotFullyMerged,
            Self::BranchExists(_) => GitErrorKind::BranchExists,
            Self::InvalidRefName(_) => GitErrorKind::InvalidRefName,
            Self::OperationInProgress(_) => GitErrorKind::OperationInProgress,
            Self::Cancelled => GitErrorKind::Cancelled,
            Self::AuthenticationFailed(_) => GitErrorKind::AuthenticationFailed,
            Self::Io(_) => GitErrorKind::Io,
        }
    }

    /// Exit code of a failed Git process, when known.
    pub fn exit_code(&self) -> Option<i32> {
        match self {
            Self::CommandFailed { exit_code, .. } => *exit_code,
            _ => None,
        }
    }

    /// Paths attached to the error (files that would be overwritten).
    pub fn paths(&self) -> &[String] {
        match self {
            Self::WouldOverwriteChanges(paths) => paths,
            _ => &[],
        }
    }

    /// Reclassifies credential failures of network commands.
    pub fn classify_network(self) -> Self {
        match self {
            Self::CommandFailed { ref stderr, .. }
                if AUTHENTICATION_MARKERS
                    .iter()
                    .any(|marker: &&str| stderr.contains(marker)) =>
            {
                Self::AuthenticationFailed(stderr.clone())
            }
            other => other,
        }
    }
}

pub type GitResult<T> = Result<T, GitError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_authentication_failures() {
        let error: GitError = GitError::CommandFailed {
            command: "fetch".to_owned(),
            exit_code: Some(128),
            stderr:
                "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
                    .to_owned(),
        }
        .classify_network();
        assert_eq!(error.kind(), GitErrorKind::AuthenticationFailed);

        let other: GitError = GitError::CommandFailed {
            command: "fetch".to_owned(),
            exit_code: Some(128),
            stderr: "fatal: unable to access: Could not resolve host".to_owned(),
        }
        .classify_network();
        assert_eq!(other.kind(), GitErrorKind::CommandFailed);
        assert_eq!(other.exit_code(), Some(128));
    }
}
