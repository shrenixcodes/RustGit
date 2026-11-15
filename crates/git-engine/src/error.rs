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
    Io,
}

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
            Self::Io(_) => GitErrorKind::Io,
        }
    }
}

pub type GitResult<T> = Result<T, GitError>;
