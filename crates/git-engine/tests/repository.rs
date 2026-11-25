//! Integration tests against real temporary Git repositories.

mod support;

use rustgit_git_engine::{
    ChangeKind, GitError, GitExecutor, RepositoryLocation, StatusSnapshot, discover, init,
    read_status,
};
use support::TestRepo;

#[test]
fn reports_git_version() {
    let git: GitExecutor = support::executor();
    let version: String = git.version().expect("git is installed");
    assert!(
        version.starts_with(|c: char| c.is_ascii_digit()),
        "{version}"
    );
}

#[test]
fn missing_git_executable_is_reported() {
    let git: GitExecutor = GitExecutor::new("definitely-not-a-git-binary-rustgit");
    let dir: tempfile::TempDir = tempfile::tempdir().expect("tempdir");
    let result = git.run_text(dir.path(), ["--version"]);
    assert!(
        matches!(result, Err(GitError::GitNotFound(_))),
        "{result:?}"
    );
}

#[test]
fn init_then_discover_from_subdirectory() {
    let dir: tempfile::TempDir = tempfile::tempdir().expect("tempdir");
    let git: GitExecutor = support::executor();
    let location: RepositoryLocation =
        init(&git, &dir.path().join("project"), "main").expect("init");
    std::fs::create_dir_all(location.root.join("nested/deep")).expect("mkdir");

    let found: RepositoryLocation =
        discover(&git, &location.root.join("nested/deep")).expect("discover");
    assert_eq!(
        found.root.canonicalize().expect("canonical"),
        location.root.canonicalize().expect("canonical")
    );
    assert!(!found.is_linked_worktree);
}

/// An executor whose global Git config is `config` alone (no system config),
/// so identity-dependent tests do not depend on the machine running them.
fn isolated_git(dir: &std::path::Path, config: &str) -> GitExecutor {
    let path = dir.join("global.gitconfig");
    std::fs::write(&path, config).expect("write global config");
    support::executor().with_env(vec![
        ("GIT_CONFIG_GLOBAL".into(), path.into_os_string()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
    ])
}

const IDENTITY: &str =
    "[user]\n\tname = Init Test\n\temail = init@rustgit.invalid\n[commit]\n\tgpgsign = false\n";

#[test]
fn init_with_readme_gitignore_and_license() {
    let dir: tempfile::TempDir = tempfile::tempdir().expect("tempdir");
    let git: GitExecutor = isolated_git(dir.path(), IDENTITY);
    let project_path = dir.path().join("my-cool-project");
    let options = rustgit_git_engine::InitOptions {
        initial_branch: Some("main".to_owned()),
        description: Some("A test project description".to_owned()),
        readme: true,
        gitignore_template: Some("rust".to_owned()),
        license_template: Some("mit".to_owned()),
    };
    let location = rustgit_git_engine::init_with_options(&git, &project_path, &options)
        .expect("init_with_options");

    let readme = std::fs::read_to_string(location.root.join("README.md")).expect("readme");
    assert!(readme.contains("# my-cool-project"));
    assert!(readme.contains("A test project description"));

    let gitignore = std::fs::read_to_string(location.root.join(".gitignore")).expect("gitignore");
    assert!(gitignore.contains("/target/"));

    let license = std::fs::read_to_string(location.root.join("LICENSE")).expect("license");
    assert!(license.contains("MIT License"));

    let git_desc =
        std::fs::read_to_string(location.git_dir.join("description")).expect("description");
    assert_eq!(git_desc.trim(), "A test project description");

    // The starter files are committed, not left behind on an unborn branch.
    let status: StatusSnapshot = read_status(&git, &location.root).expect("status");
    assert!(status.files.is_empty(), "{:?}", status.files);
}

#[test]
fn init_offers_a_gpl_notice() {
    let dir: tempfile::TempDir = tempfile::tempdir().expect("tempdir");
    let git: GitExecutor = isolated_git(dir.path(), IDENTITY);
    let options = rustgit_git_engine::InitOptions {
        license_template: Some("gpl-3.0".to_owned()),
        ..Default::default()
    };
    let location = rustgit_git_engine::init_with_options(&git, &dir.path().join("gpl"), &options)
        .expect("init_with_options");
    let license = std::fs::read_to_string(location.root.join("LICENSE")).expect("license");
    assert!(license.contains("GNU General Public License"));
    assert!(license.contains("Init Test"));
}

#[test]
fn init_with_starter_files_needs_an_identity_first() {
    let dir: tempfile::TempDir = tempfile::tempdir().expect("tempdir");
    let git: GitExecutor = isolated_git(dir.path(), "");
    let project = dir.path().join("nobody");
    let options = rustgit_git_engine::InitOptions {
        readme: true,
        ..Default::default()
    };
    let result = rustgit_git_engine::init_with_options(&git, &project, &options);
    assert!(
        matches!(result, Err(GitError::IdentityMissing(_))),
        "{result:?}"
    );
    assert!(!project.exists(), "nothing is left behind");
    // Without starter files nothing is committed, so no identity is needed.
    init(&git, &project, "main").expect("plain init");
}

#[test]
fn discover_rejects_plain_directory_and_missing_path() {
    let dir: tempfile::TempDir = tempfile::tempdir().expect("tempdir");
    let git: GitExecutor = support::executor();

    let result = discover(&git, dir.path());
    assert!(
        matches!(result, Err(GitError::NotARepository(_))),
        "{result:?}"
    );

    let missing = discover(&git, &dir.path().join("missing"));
    assert!(matches!(missing, Err(GitError::InvalidPath(_))));
}

#[test]
fn discovers_linked_worktree_with_git_file() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "initial");
    let worktree_path = repo.dir.path().join("wt");
    repo.git_ok(&[
        "worktree",
        "add",
        "-b",
        "feature",
        worktree_path.to_str().expect("utf8 path"),
    ]);

    assert!(
        worktree_path.join(".git").is_file(),
        "linked worktrees use a .git file"
    );
    let location: RepositoryLocation =
        discover(&repo.git, &worktree_path).expect("discover worktree");
    assert!(location.is_linked_worktree);
}

#[test]
fn status_reports_real_changes() {
    let repo: TestRepo = TestRepo::new();
    repo.write("tracked.txt", "one\n");
    repo.write("delete-me.txt", "bye\n");
    repo.git_ok(&["add", "."]);
    repo.git_ok(&["commit", "-m", "initial"]);

    repo.write("tracked.txt", "two\n");
    std::fs::remove_file(repo.root().join("delete-me.txt")).expect("remove");
    repo.write("staged.txt", "new\n");
    repo.git_ok(&["add", "staged.txt"]);
    repo.write("ünïcode dir/file.txt", "x\n");

    let status: StatusSnapshot = read_status(&repo.git, &repo.root()).expect("status");
    assert_eq!(status.branch.head.as_deref(), Some("main"));
    assert!(status.branch.oid.is_some());

    let find = |path: &str| {
        status
            .files
            .iter()
            .find(|file| file.path == path)
            .unwrap_or_else(|| panic!("{path} missing from {:?}", status.files))
    };
    assert_eq!(find("tracked.txt").unstaged, Some(ChangeKind::Modified));
    assert_eq!(find("delete-me.txt").unstaged, Some(ChangeKind::Deleted));
    assert_eq!(find("staged.txt").staged, Some(ChangeKind::Added));
    assert_eq!(
        find("ünïcode dir/file.txt").unstaged,
        Some(ChangeKind::Untracked)
    );
}

#[test]
fn status_on_unborn_branch() {
    let repo: TestRepo = TestRepo::new();
    let status: StatusSnapshot = read_status(&repo.git, &repo.root()).expect("status");
    assert_eq!(status.branch.oid, None);
    assert!(status.files.is_empty());
}

#[test]
fn failed_commands_are_recorded_with_redaction() {
    let repo: TestRepo = TestRepo::new();
    let result = repo.git.run_text(
        &repo.root(),
        [
            "ls-remote",
            "https://user:secret-token@127.0.0.1:9/none.git",
        ],
    );
    let error: GitError = result.expect_err("unreachable remote must fail");
    let message: String = error.to_string();
    assert!(!message.contains("secret-token"), "{message}");

    let last = repo.git.history().pop().expect("history recorded");
    assert!(
        last.args
            .iter()
            .all(|arg: &String| !arg.contains("secret-token"))
    );
    assert_ne!(last.exit_code, Some(0));
}
