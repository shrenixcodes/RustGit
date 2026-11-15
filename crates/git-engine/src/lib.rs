//! Git execution engine for RustGit.
//!
//! Operations run the Git CLI with explicit arguments (never through a shell)
//! and parse machine-readable (`--porcelain`, `-z`) output.

pub mod commit;
pub mod diff;
pub mod error;
pub mod executor;
pub mod index;
pub mod patch;
pub mod pathspec;
pub mod redact;
pub mod repository;
pub mod status;

pub use commit::{
    AuthorIdentity, CreatedCommit, author_identity, create_commit, last_commit_message,
};
pub use diff::{
    ChangeTotals, DiffFileStatus, DiffHunk, DiffLine, DiffLineKind, DiffRequest, DiffSide,
    FileDiff, FileTotals, change_totals, file_diff,
};
pub use error::{GitError, GitErrorKind, GitResult};
pub use executor::{CommandRecord, GitExecutor};
pub use index::{discard_paths, stage_all, stage_paths, unstage_all, unstage_paths};
pub use patch::{HunkAction, HunkRequest, apply_hunk};
pub use repository::{RepositoryLocation, discover, init};
pub use status::{BranchStatus, ChangeKind, FileStatus, StatusSnapshot, read_status};
