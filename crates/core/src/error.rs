use rustgit_git_engine::{GitError, GitErrorKind};
use serde::Serialize;

use crate::database::DatabaseError;

/// Machine-readable error categories shared with the frontend (`services/types.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    GitNotFound,
    NotARepository,
    InvalidPath,
    InvalidRequest,
    StaleDiff,
    GitCommandFailed,
    GitOutputUnrecognized,
    RepositoryNotFound,
    Database,
    Internal,
}

/// The error payload every command returns on failure.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub kind: ErrorKind,
    pub message: String,
}

impl CommandError {
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Internal,
            message: message.into(),
        }
    }
}

impl From<GitError> for CommandError {
    fn from(error: GitError) -> Self {
        let kind: ErrorKind = match error.kind() {
            GitErrorKind::GitNotFound => ErrorKind::GitNotFound,
            GitErrorKind::NotARepository => ErrorKind::NotARepository,
            GitErrorKind::InvalidPath => ErrorKind::InvalidPath,
            GitErrorKind::CommandFailed => ErrorKind::GitCommandFailed,
            GitErrorKind::Parse => ErrorKind::GitOutputUnrecognized,
            GitErrorKind::InvalidRequest => ErrorKind::InvalidRequest,
            GitErrorKind::StaleDiff => ErrorKind::StaleDiff,
            GitErrorKind::Io => ErrorKind::Internal,
        };
        Self {
            kind,
            message: error.to_string(),
        }
    }
}

impl From<DatabaseError> for CommandError {
    fn from(error: DatabaseError) -> Self {
        let kind: ErrorKind = match error {
            DatabaseError::RepositoryNotFound(_) => ErrorKind::RepositoryNotFound,
            _ => ErrorKind::Database,
        };
        tracing::error!(%error, "database operation failed");
        Self {
            kind,
            message: error.to_string(),
        }
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn maps_git_errors_to_stable_kinds() {
        let error: CommandError = GitError::NotARepository(PathBuf::from("/tmp/x")).into();
        assert_eq!(error.kind, ErrorKind::NotARepository);
        assert!(error.message.contains("/tmp/x"));

        let error: CommandError = GitError::GitNotFound(PathBuf::from("git")).into();
        assert_eq!(error.kind, ErrorKind::GitNotFound);

        let error: CommandError = GitError::StaleDiff("@@ -1 +1 @@".to_owned()).into();
        assert_eq!(error.kind, ErrorKind::StaleDiff);
        let json: String = serde_json::to_string(&error).expect("serialize");
        assert!(json.contains(r#""kind":"stale_diff""#), "{json}");
    }

    #[test]
    fn maps_missing_repository_record() {
        let error: CommandError = DatabaseError::RepositoryNotFound(7).into();
        assert_eq!(error.kind, ErrorKind::RepositoryNotFound);
    }

    #[test]
    fn serializes_with_snake_case_kind() {
        let error: CommandError = CommandError::internal("boom");
        let json: String = serde_json::to_string(&error).expect("serialize");
        assert_eq!(json, r#"{"kind":"internal","message":"boom"}"#);
    }
}
