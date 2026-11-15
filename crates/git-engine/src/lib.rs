//! Git execution engine for RustGit.
//!
//! Operations run the Git CLI with explicit arguments (never through a shell)
//! and parse machine-readable (`--porcelain`, `-z`) output.

pub mod error;
pub mod executor;
pub mod redact;
pub mod repository;
pub mod status;

pub use error::{GitError, GitErrorKind, GitResult};
pub use executor::{CommandRecord, GitExecutor};
pub use repository::{RepositoryLocation, discover, init};
pub use status::{BranchStatus, ChangeKind, FileStatus, StatusSnapshot, read_status};
