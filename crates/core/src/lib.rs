//! RustGit application services that do not depend on the desktop shell.

pub mod database;
pub mod error;
pub mod locks;
pub mod operations;

pub use database::{
    Database, DatabaseError, RepositoryEntry, Settings, ThemePreference, owning_repository,
};
pub use error::{CommandError, CommandResult, ErrorDetails, ErrorKind};
pub use locks::RepositoryLocks;
pub use operations::{
    OperationFinished, OperationKind, OperationOutcome, OperationProgress, OperationRegistry,
    OperationStarted, ProgressCounts, ProgressThrottle,
};
