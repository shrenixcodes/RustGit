use crate::error::{GitError, GitResult};

/// Validates repository-relative paths supplied by the UI.
///
/// Rejects empty lists, empty paths, absolute paths, drive or UNC prefixes,
/// `..` components and NUL bytes, so a request can never address files
/// outside the working tree.
pub fn validate_relative_paths(paths: &[String]) -> GitResult<()> {
    if paths.is_empty() {
        return Err(GitError::InvalidRequest("no paths given".to_owned()));
    }
    for path in paths {
        validate_relative_path(path)?;
    }
    Ok(())
}

pub fn validate_relative_path(path: &str) -> GitResult<()> {
    let invalid = |reason: &str| GitError::InvalidRequest(format!("path '{path}' {reason}"));
    if path.is_empty() {
        return Err(invalid("is empty"));
    }
    if path.contains('\0') {
        return Err(invalid("contains a NUL byte"));
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(invalid("is absolute"));
    }
    if has_drive_prefix(path) {
        return Err(invalid("has a drive prefix"));
    }
    if path
        .split(['/', '\\'])
        .any(|component: &str| component == "..")
    {
        return Err(invalid("contains '..'"));
    }
    Ok(())
}

/// `C:`, `C:/...` or `C:\...`. Other names containing ':' are valid on Unix.
fn has_drive_prefix(path: &str) -> bool {
    let bytes: &[u8] = path.as_bytes();
    bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes.len() == 2 || bytes[2] == b'/' || bytes[2] == b'\\')
}

/// Encodes paths for `--pathspec-from-file=- --pathspec-file-nul`.
pub fn nul_separated(paths: &[String]) -> Vec<u8> {
    let mut buffer: Vec<u8> = Vec::with_capacity(paths.iter().map(|p| p.len() + 1).sum());
    for path in paths {
        buffer.extend_from_slice(path.as_bytes());
        buffer.push(0);
    }
    buffer
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|path: &&str| (*path).to_owned()).collect()
    }

    #[test]
    fn accepts_normal_relative_paths() {
        assert!(validate_relative_paths(&owned(&["a.txt", "dir/b c.rs", "ünï/*star*.md"])).is_ok());
    }

    #[test]
    fn rejects_escaping_and_absolute_paths() {
        for bad in [
            "",
            "/etc/passwd",
            "\\x",
            "C:/Windows",
            "a/../../b",
            "..",
            "a\0b",
        ] {
            assert!(
                matches!(
                    validate_relative_path(bad),
                    Err(GitError::InvalidRequest(_))
                ),
                "{bad:?} must be rejected"
            );
        }
        assert!(validate_relative_paths(&[]).is_err());
    }

    #[test]
    fn encodes_nul_separated() {
        assert_eq!(nul_separated(&owned(&["a", "b c"])), b"a\0b c\0");
    }
}
