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
    NothingToCommit,
    IdentityMissing,
    WouldOverwriteChanges,
    BranchNotFullyMerged,
    BranchExists,
    InvalidRefName,
    OperationInProgress,
    OperationCancelled,
    AuthenticationFailed,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<ErrorDetails>,
}

/// Optional structured context for some error kinds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetails {
    /// Exit code of the failed Git process (`git_command_failed`).
    pub exit_code: Option<i32>,
    /// Affected files (`would_overwrite_changes`).
    pub paths: Vec<String>,
}

impl CommandError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            details: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
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
            GitErrorKind::NothingToCommit => ErrorKind::NothingToCommit,
            GitErrorKind::IdentityMissing => ErrorKind::IdentityMissing,
            GitErrorKind::WouldOverwriteChanges => ErrorKind::WouldOverwriteChanges,
            GitErrorKind::BranchNotFullyMerged => ErrorKind::BranchNotFullyMerged,
            GitErrorKind::BranchExists => ErrorKind::BranchExists,
            GitErrorKind::InvalidRefName => ErrorKind::InvalidRefName,
            GitErrorKind::OperationInProgress => ErrorKind::OperationInProgress,
            GitErrorKind::Cancelled => ErrorKind::OperationCancelled,
            GitErrorKind::AuthenticationFailed => ErrorKind::AuthenticationFailed,
            GitErrorKind::Io => ErrorKind::Internal,
        };
        let details: Option<ErrorDetails> = match (error.exit_code(), error.paths()) {
            (None, []) => None,
            (exit_code, paths) => Some(ErrorDetails {
                exit_code,
                paths: paths.to_vec(),
            }),
        };
        Self {
            kind,
            message: error.to_string(),
            details,
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
        Self::new(kind, error.to_string())
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
    fn carries_exit_code_and_paths_in_details() {
        let error: CommandError = GitError::CommandFailed {
            command: "commit".to_owned(),
            exit_code: Some(1),
            stderr: "hook said no".to_owned(),
        }
        .into();
        assert_eq!(error.details.as_ref().and_then(|d| d.exit_code), Some(1));
        let json: String = serde_json::to_string(&error).expect("serialize");
        assert!(
            json.contains(r#""details":{"exitCode":1,"paths":[]}"#),
            "{json}"
        );

        let error: CommandError = GitError::WouldOverwriteChanges(vec!["a.txt".to_owned()]).into();
        assert_eq!(error.kind, ErrorKind::WouldOverwriteChanges);
        assert_eq!(error.details.expect("details").paths, ["a.txt"]);
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
