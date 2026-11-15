/// Removes credentials embedded in URLs (`https://user:token@host/...`).
///
/// Every `scheme://userinfo@` occurrence has its userinfo replaced with `***`.
pub fn redact_credentials(input: &str) -> String {
    let mut output: String = String::with_capacity(input.len());
    let mut rest: &str = input;

    while let Some(scheme_end) = rest.find("://") {
        let authority_start: usize = scheme_end + 3;
        output.push_str(&rest[..authority_start]);
        let after_scheme: &str = &rest[authority_start..];
        let authority_end: usize = after_scheme
            .find(|c: char| c == '/' || c.is_whitespace())
            .unwrap_or(after_scheme.len());
        let authority: &str = &after_scheme[..authority_end];
        match authority.rfind('@') {
            Some(at) => {
                output.push_str("***");
                output.push_str(&authority[at..]);
            }
            None => output.push_str(authority),
        }
        rest = &after_scheme[authority_end..];
    }
    output.push_str(rest);
    output
}

#[cfg(test)]
mod tests {
    use super::redact_credentials;

    #[test]
    fn redacts_user_and_token() {
        assert_eq!(
            redact_credentials("fatal: https://me:ghp_secret@github.com/o/r.git not found"),
            "fatal: https://***@github.com/o/r.git not found"
        );
    }

    #[test]
    fn leaves_plain_urls_untouched() {
        let text: &str = "push to https://github.com/o/r.git and ssh://git@host/r";
        assert_eq!(
            redact_credentials(text),
            "push to https://github.com/o/r.git and ssh://***@host/r"
        );
        assert_eq!(redact_credentials("no url here"), "no url here");
    }
}
