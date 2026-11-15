//! RustGit application services that do not depend on the desktop shell.

pub mod database;
pub mod error;
pub mod locks;

pub use database::{
    Database, DatabaseError, RepositoryEntry, Settings, ThemePreference, owning_repository,
};
pub use error::{CommandError, CommandResult, ErrorDetails, ErrorKind};
pub use locks::RepositoryLocks;
