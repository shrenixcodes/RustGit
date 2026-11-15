//! Helpers that create disposable Git repositories for integration tests.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use rustgit_git_engine::GitExecutor;

pub fn executor() -> GitExecutor {
    GitExecutor::new("git")
}

/// A real repository inside a temporary directory, deleted on drop.
pub struct TestRepo {
    pub dir: tempfile::TempDir,
    pub git: GitExecutor,
}

impl TestRepo {
    /// Creates an empty repository on branch `main` with a local test identity.
    pub fn new() -> Self {
        let dir: tempfile::TempDir = tempfile::tempdir().expect("create temp dir");
        std::fs::create_dir(dir.path().join("repo")).expect("create repo dir");
        let repo: TestRepo = TestRepo {
            dir,
            git: executor(),
        };
        repo.git_ok(&["init", "--initial-branch=main"]);
        repo.git_ok(&["config", "user.name", "RustGit Test"]);
        repo.git_ok(&["config", "user.email", "test@rustgit.invalid"]);
        repo.git_ok(&["config", "commit.gpgsign", "false"]);
        repo.git_ok(&["config", "core.autocrlf", "false"]);
        repo
    }

    pub fn root(&self) -> PathBuf {
        self.dir.path().join("repo")
    }

    pub fn write(&self, relative: &str, contents: &str) {
        let path: PathBuf = self.root().join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent dirs");
        }
        std::fs::write(path, contents).expect("write file");
    }

    pub fn read(&self, relative: &str) -> String {
        std::fs::read_to_string(self.root().join(relative)).expect("read file")
    }

    /// Runs git in the repository and panics with stderr on failure.
    pub fn git_ok(&self, args: &[&str]) -> String {
        run_git(&self.git, &self.root(), args)
    }

    pub fn commit_file(&self, relative: &str, contents: &str, message: &str) -> String {
        self.write(relative, contents);
        self.git_ok(&["add", "--", relative]);
        self.git_ok(&["commit", "-m", message]);
        self.git_ok(&["rev-parse", "HEAD"]).trim().to_owned()
    }
}

pub fn run_git(git: &GitExecutor, cwd: &Path, args: &[&str]) -> String {
    git.run_text(cwd, args)
        .unwrap_or_else(|error| panic!("git {args:?} failed: {error}"))
}
