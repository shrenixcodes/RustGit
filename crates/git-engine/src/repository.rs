use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;

/// Location details of an opened repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryLocation {
    /// Root of the working tree.
    pub root: PathBuf,
    /// Absolute Git directory. For linked worktrees this is not `<root>/.git`.
    pub git_dir: PathBuf,
    /// Directory shared by all worktrees (refs, config, objects).
    pub common_dir: PathBuf,
    /// Whether `root` is a linked worktree rather than the main working tree.
    pub is_linked_worktree: bool,
}

/// Resolves the repository containing `path` using Git itself, so `.git` files,
/// linked worktrees and other layouts are handled exactly the way Git handles them.
pub fn discover(git: &GitExecutor, path: &Path) -> GitResult<RepositoryLocation> {
    if !path.is_dir() {
        return Err(GitError::InvalidPath(path.to_path_buf()));
    }

    let output: std::process::Output = git.run_unchecked(
        path,
        [
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--git-dir",
            "--git-common-dir",
        ],
        None,
    )?;

    if !output.status.success() {
        let stderr: String = String::from_utf8_lossy(&output.stderr).into_owned();
        if stderr.contains("not a git repository") || stderr.contains("must be run in a work tree")
        {
            return Err(GitError::NotARepository(path.to_path_buf()));
        }
        return Err(GitError::CommandFailed {
            command: "rev-parse".to_owned(),
            exit_code: output.status.code(),
            stderr: stderr.trim().to_owned(),
        });
    }

    let stdout: String = String::from_utf8_lossy(&output.stdout).into_owned();
    let mut lines = stdout.lines();
    let mut next = |field: &str| -> GitResult<PathBuf> {
        lines
            .next()
            .filter(|line: &&str| !line.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| GitError::Parse {
                command: "rev-parse".to_owned(),
                detail: format!("missing {field}"),
            })
    };
    let root: PathBuf = next("toplevel")?;
    let git_dir: PathBuf = next("git-dir")?;
    let common_dir: PathBuf = next("git-common-dir")?;

    Ok(RepositoryLocation {
        is_linked_worktree: normalize(&git_dir) != normalize(&common_dir),
        root,
        git_dir,
        common_dir,
    })
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct InitOptions {
    pub initial_branch: Option<String>,
    pub description: Option<String>,
    pub readme: bool,
    pub gitignore_template: Option<String>,
    pub license_template: Option<String>,
}

pub fn gitignore_text(template: &str) -> Option<&'static str> {
    match template.to_lowercase().as_str() {
        "node" => Some("node_modules/\ndist/\nbuild/\n.env\n.env.local\n*.log\ncoverage/\n"),
        "rust" => Some("/target/\n**/*.rs.bk\n*.exe\n*.pdb\n"),
        "python" => Some("__pycache__/\n*.py[cod]\nbuild/\ndist/\n.venv/\nenv/\n*.egg-info/\n"),
        "go" => Some("bin/\n*.exe\n*.out\n*.test\n"),
        "c++" | "cpp" => Some("*.o\n*.obj\n*.exe\n*.out\nbuild/\nbin/\n"),
        "java" => Some("*.class\n*.jar\n*.war\ntarget/\nbuild/\n.gradle/\n"),
        "general" => Some(".DS_Store\nThumbs.db\n.vscode/\n.idea/\n*.log\n*.tmp\n"),
        _ => None,
    }
}

pub fn license_text(spdx: &str, year: u32, author: &str) -> Option<String> {
    match spdx.to_lowercase().as_str() {
        "mit" => Some(format!(
            "MIT License\n\nCopyright (c) {year} {author}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.\n"
        )),
        "apache-2.0" | "apache" => Some(format!(
            "Copyright {year} {author}\n\nLicensed under the Apache License, Version 2.0 (the \"License\");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software distributed under the License is distributed on an \"AS IS\" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and limitations under the License.\n"
        )),
        "bsd-3-clause" | "bsd" => Some(format!(
            "Copyright (c) {year}, {author}\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\" AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED.\n"
        )),
        "unlicense" => Some(
            "This is free and unencumbered software released into the public domain.\n\nAnyone is free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.\n".to_owned()
        ),
        _ => None,
    }
}

/// Initializes a new repository at `path` with optional starter files and description.
pub fn init_with_options(
    git: &GitExecutor,
    path: &Path,
    options: &InitOptions,
) -> GitResult<RepositoryLocation> {
    std::fs::create_dir_all(path)?;
    let branch = options.initial_branch.as_deref().unwrap_or("main");
    let branch_arg: String = format!("--initial-branch={branch}");
    git.run(path, ["init", branch_arg.as_str()], None)?;

    if let Some(desc) = &options.description {
        let trimmed = desc.trim();
        if !trimmed.is_empty() {
            let _ = std::fs::write(path.join(".git").join("description"), trimmed);
        }
    }

    let repo_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("repository");

    let mut created_files: Vec<&'static str> = Vec::new();

    if options.readme {
        let content = if let Some(desc) = &options.description {
            let trimmed = desc.trim();
            if !trimmed.is_empty() {
                format!("# {repo_name}\n\n{trimmed}\n")
            } else {
                format!("# {repo_name}\n")
            }
        } else {
            format!("# {repo_name}\n")
        };
        std::fs::write(path.join("README.md"), content)?;
        created_files.push("README.md");
    }

    if let Some(template) = &options.gitignore_template {
        if let Some(content) = gitignore_text(template) {
            std::fs::write(path.join(".gitignore"), content)?;
            created_files.push(".gitignore");
        }
    }

    if let Some(template) = &options.license_template {
        let author = git
            .run(path, ["config", "user.name"], None)
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Contributor".to_owned());
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let year = (1970 + secs / 31_557_600) as u32;
        if let Some(content) = license_text(template, year, &author) {
            std::fs::write(path.join("LICENSE"), content)?;
            created_files.push("LICENSE");
        }
    }

    if !created_files.is_empty() {
        for file in &created_files {
            let _ = git.run(path, ["add", *file], None);
        }
        let _ = git.run(path, ["commit", "-m", "Initial commit"], None);
    }

    discover(git, path)
}

/// Initializes a new repository at `path`, creating the directory if needed.
pub fn init(git: &GitExecutor, path: &Path, initial_branch: &str) -> GitResult<RepositoryLocation> {
    init_with_options(
        git,
        path,
        &InitOptions {
            initial_branch: Some(initial_branch.to_owned()),
            ..Default::default()
        },
    )
}

fn normalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}
