//! Git execution engine for RustGit.
//!
//! Operations run the Git CLI with explicit arguments (never through a shell)
//! and parse machine-readable (`--porcelain`, `-z`) output.

pub mod commit;
pub mod compare;
pub mod diff;
pub mod error;
pub mod executor;
pub mod history;
pub mod index;
pub mod integrate;
pub mod patch;
pub mod pathspec;
pub mod redact;
pub mod refs;
pub mod remote;
pub mod repository;
pub mod stash;
pub mod status;
pub mod worktree;

pub use commit::{
    CommitContext, CreatedCommit, HeadCommit, SigningMode, commit_context, create_commit,
};
pub use compare::{Comparison, compare_file_diff, compare_revisions};
pub use diff::{
    ChangeTotals, DEFAULT_CONTEXT_LINES, DiffFileStatus, DiffHunk, DiffLine, DiffLineKind,
    DiffRequest, DiffSide, FileDiff, FileTotals, change_totals, file_diff,
};
pub use error::{GitError, GitErrorKind, GitResult};
pub use executor::{CancelToken, CommandRecord, GitExecutor};
pub use history::{
    CommitDetails, CommitFile, LogCommit, LogPage, LogQuery, commit_details, commit_file_diff,
    log_page,
};
pub use index::{discard_paths, stage_all, stage_paths, unstage_all, unstage_paths};
pub use integrate::{
    ConflictVersions, IntegrationOutcome, IntegrationResult, abort_operation, cherry_pick,
    conflict_versions, continue_operation, merge_branch, rebase_branch, resolve_conflict,
    revert_commit,
};
pub use patch::{HunkAction, HunkRequest, apply_hunk};
pub use refs::{
    HeadState, RefEntry, RefKind, RefList, checkout_branch, create_branch, delete_branch,
    list_refs, rename_branch, set_upstream,
};
pub use repository::{InitOptions, RepositoryLocation, discover, init, init_with_options};
pub use status::{
    BranchStatus, ChangeKind, FileStatus, InProgress, StatusSnapshot, in_progress, read_status,
};
