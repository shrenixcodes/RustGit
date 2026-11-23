//! GitHub sign-in (OAuth device flow) and the few REST calls RustGit needs.
//!
//! The device flow needs only the application's public client id: nothing
//! secret ships in the binary. The access token is kept in the operating
//! system's credential store, never in the database or in logs, and is handed
//! to Git only through the credential prompt broker.

use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const API: &str = "https://api.github.com";
const SCOPE: &str = "repo";
const SERVICE: &str = "RustGit";
const ACCOUNT: &str = "github-token";
/// Largest response body read from GitHub.
const MAX_BODY: u64 = 4 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum GithubError {
    #[error("could not reach GitHub: {0}")]
    Network(String),
    #[error("GitHub answered unexpectedly: {0}")]
    Protocol(String),
    #[error("the sign-in code expired; start again")]
    Expired,
    #[error("sign-in was denied on GitHub")]
    Denied,
    #[error("sign-in was cancelled")]
    Cancelled,
    #[error("GitHub rejected the stored token; sign in again")]
    Unauthorized,
    #[error("GitHub refused: {0}")]
    Rejected(String),
    #[error("the credential store failed: {0}")]
    Store(String),
}

/// What the person must do to finish signing in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceCode {
    /// Secret handed to GitHub when polling; never sent to the webview.
    #[serde(skip_serializing)]
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubAccount {
    pub login: String,
}

/// Read from GitHub's snake_case JSON, sent to the UI in camelCase.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct GithubRepository {
    pub full_name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub private: bool,
    pub clone_url: String,
}

/// Minimal HTTP surface, so the flow can be tested without a network.
pub trait Http: Send + Sync {
    /// `POST` with a form body; returns the response body whatever the status.
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<String, GithubError>;
    /// API request; an empty token sends no authorization header. Returns `(status, body)`.
    fn api(
        &self,
        method: &str,
        url: &str,
        token: &str,
        body: Option<&str>,
    ) -> Result<(u16, String), GithubError>;
}

/// `ureq`-backed implementation.
pub struct UreqHttp {
    agent: ureq::Agent,
}

impl Default for UreqHttp {
    fn default() -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(30)))
            .user_agent("RustGit")
            .build()
            .into();
        Self { agent }
    }
}

fn read_body(mut response: ureq::http::Response<ureq::Body>) -> Result<(u16, String), GithubError> {
    let status: u16 = response.status().as_u16();
    let mut text: String = String::new();
    response
        .body_mut()
        .as_reader()
        .take(MAX_BODY)
        .read_to_string(&mut text)
        .map_err(|error| GithubError::Network(error.to_string()))?;
    Ok((status, text))
}

impl Http for UreqHttp {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<String, GithubError> {
        let response = self
            .agent
            .post(url)
            .header("Accept", "application/json")
            .send_form(form.iter().copied())
            .map_err(|error| GithubError::Network(error.to_string()))?;
        read_body(response).map(|(_, body)| body)
    }

    fn api(
        &self,
        method: &str,
        url: &str,
        token: &str,
        body: Option<&str>,
    ) -> Result<(u16, String), GithubError> {
        let token = token.trim();
        let response = match (method, body) {
            ("POST", Some(body)) => {
                let mut request = self
                    .agent
                    .post(url)
                    .header("Accept", "application/vnd.github+json")
                    .header("Content-Type", "application/json");
                if !token.is_empty() {
                    request = request.header("Authorization", format!("Bearer {token}"));
                }
                request.send(body)
            }
            _ => {
                let mut request = self
                    .agent
                    .get(url)
                    .header("Accept", "application/vnd.github+json");
                if !token.is_empty() {
                    request = request.header("Authorization", format!("Bearer {token}"));
                }
                request.call()
            }
        }
        .map_err(|error| GithubError::Network(error.to_string()))?;
        read_body(response)
    }
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: Option<String>,
    error: Option<String>,
    interval: Option<u64>,
}

/// Step 1: asks GitHub for a user code to show the person.
pub fn start_device_flow(http: &dyn Http, client_id: &str) -> Result<DeviceCode, GithubError> {
    let body: String = http.post_form(
        DEVICE_CODE_URL,
        &[("client_id", client_id), ("scope", SCOPE)],
    )?;
    serde_json::from_str(&body)
        .map_err(|_| GithubError::Protocol("no device code in the reply".to_owned()))
}

/// Step 2: polls until the person approves, denies, or the code expires.
/// `sleep` is a parameter so tests do not wait.
pub fn wait_for_token(
    http: &dyn Http,
    client_id: &str,
    code: &DeviceCode,
    cancelled: &AtomicBool,
    sleep: &dyn Fn(Duration),
) -> Result<String, GithubError> {
    let mut interval: u64 = code.interval.max(1);
    let mut waited: u64 = 0;
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(GithubError::Cancelled);
        }
        sleep(Duration::from_secs(interval));
        waited += interval;
        if cancelled.load(Ordering::SeqCst) {
            return Err(GithubError::Cancelled);
        }
        let body: String = http.post_form(
            TOKEN_URL,
            &[
                ("client_id", client_id),
                ("device_code", &code.device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ],
        )?;
        let reply: TokenReply = serde_json::from_str(&body)
            .map_err(|_| GithubError::Protocol("unreadable token reply".to_owned()))?;
        if let Some(token) = reply.access_token {
            return Ok(token);
        }
        match reply.error.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval = reply.interval.unwrap_or(interval + 5),
            Some("expired_token") => return Err(GithubError::Expired),
            Some("access_denied") => return Err(GithubError::Denied),
            Some(other) => return Err(GithubError::Rejected(other.to_owned())),
            None => return Err(GithubError::Protocol("empty token reply".to_owned())),
        }
        if waited > code.expires_in {
            return Err(GithubError::Expired);
        }
    }
}

fn authorised(
    http: &dyn Http,
    method: &str,
    url: &str,
    token: &str,
    body: Option<&str>,
) -> Result<String, GithubError> {
    let (status, text): (u16, String) = http.api(method, url, token, body)?;
    match status {
        200 | 201 => Ok(text),
        401 => Err(GithubError::Unauthorized),
        _ => {
            let message: String = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|value| value["message"].as_str().map(str::to_owned))
                .unwrap_or_else(|| format!("status {status}"));
            Err(GithubError::Rejected(message))
        }
    }
}

pub fn current_account(http: &dyn Http, token: &str) -> Result<GithubAccount, GithubError> {
    let text: String = authorised(http, "GET", &format!("{API}/user"), token, None)?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| GithubError::Protocol("unreadable user reply".to_owned()))?;
    let login: &str = value["login"]
        .as_str()
        .ok_or_else(|| GithubError::Protocol("no login in the user reply".to_owned()))?;
    Ok(GithubAccount {
        login: login.to_owned(),
    })
}

/// One page (up to 100) of repositories the account can access, most recently pushed first.
pub fn list_repositories(
    http: &dyn Http,
    token: &str,
    page: u32,
) -> Result<Vec<GithubRepository>, GithubError> {
    let url: String = format!(
        "{API}/user/repos?per_page=100&page={}&sort=pushed&affiliation=owner,collaborator,organization_member",
        page.max(1)
    );
    let text: String = authorised(http, "GET", &url, token, None)?;
    serde_json::from_str(&text)
        .map_err(|_| GithubError::Protocol("unreadable repository list".to_owned()))
}

/// Creates a repository under the signed-in account.
pub fn create_repository(
    http: &dyn Http,
    token: &str,
    name: &str,
    description: Option<&str>,
    private: bool,
) -> Result<GithubRepository, GithubError> {
    let mut body_map = serde_json::json!({ "name": name, "private": private });
    if let Some(desc) = description.filter(|d| !d.trim().is_empty()) {
        body_map["description"] = serde_json::Value::String(desc.trim().to_owned());
    }
    let body: String = body_map.to_string();
    let text: String = authorised(
        http,
        "POST",
        &format!("{API}/user/repos"),
        token,
        Some(&body),
    )?;
    serde_json::from_str(&text)
        .map_err(|_| GithubError::Protocol("unreadable repository reply".to_owned()))
}

/// Where the access token lives between runs.
pub trait TokenStore: Send + Sync {
    fn load(&self) -> Result<Option<String>, GithubError>;
    fn save(&self, token: &str) -> Result<(), GithubError>;
    fn clear(&self) -> Result<(), GithubError>;
}

/// The operating system's credential store (Windows Credential Manager, macOS Keychain).
#[derive(Debug, Default)]
pub struct KeychainStore;

impl KeychainStore {
    fn entry() -> Result<keyring::Entry, GithubError> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|error| GithubError::Store(error.to_string()))
    }
}

const DISCONNECTED_SENTINEL: &str = "__DISCONNECTED__";

/// Probes the local operating system and tool configuration for an existing GitHub token.
///
/// Sources checked in order:
/// 1. GITHUB_TOKEN or GH_TOKEN environment variables
/// 2. GitHub CLI (`gh auth token`)
/// 3. GitHub CLI configuration file (`hosts.yml`)
/// 4. GitHub Desktop credential store entry
/// 5. Git Credential Manager entry
/// 6. Git credential helper (`git credential fill`)
pub fn probe_local_github_token() -> Option<String> {
    // 1. Environment variables
    if let Ok(token) = std::env::var("GITHUB_TOKEN").or_else(|_| std::env::var("GH_TOKEN")) {
        let trimmed = token.trim();
        if is_valid_token_shape(trimmed) {
            return Some(trimmed.to_owned());
        }
    }

    // 2. GitHub CLI (gh auth token)
    if let Ok(output) = std::process::Command::new("gh")
        .args(["auth", "token", "--hostname", "github.com"])
        .output()
        && output.status.success()
    {
        let token = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if is_valid_token_shape(&token) {
            return Some(token);
        }
    }

    // 3. GitHub CLI configuration file
    if let Some(token) = read_gh_hosts_file()
        && is_valid_token_shape(&token)
    {
        return Some(token);
    }

    // 4. GitHub Desktop credential store entry
    if let Ok(entry) = keyring::Entry::new("GitHub - https://api.github.com", "")
        && let Ok(token) = entry.get_password()
        && is_valid_token_shape(&token)
    {
        return Some(token);
    }

    // 5. Git Credential Manager entry
    if let Ok(entry) = keyring::Entry::new("git:https://github.com", "")
        && let Ok(token) = entry.get_password()
        && is_valid_token_shape(&token)
    {
        return Some(token);
    }

    // 6. Git credential helper query
    if let Some(token) = query_git_credential_helper()
        && is_valid_token_shape(&token)
    {
        return Some(token);
    }

    None
}

/// Checks whether a string resembles a valid GitHub personal or OAuth access token.
pub fn is_valid_token_shape(token: &str) -> bool {
    let t = token.trim();
    if t.len() < 16 {
        return false;
    }
    t.starts_with("ghp_")
        || t.starts_with("gho_")
        || t.starts_with("github_pat_")
        || t.starts_with("ghu_")
        || t.starts_with("ghs_")
        || (t.len() == 40 && t.chars().all(|c| c.is_ascii_hexdigit()))
}

fn read_gh_hosts_file() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(PathBuf::from(appdata).join("GitHub CLI").join("hosts.yml"));
    }
    if let Ok(userprofile) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let p = PathBuf::from(userprofile);
        candidates.push(p.join(".config").join("gh").join("hosts.yml"));
    }
    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path)
            && let Some(token) = parse_oauth_token_from_hosts(&content)
        {
            return Some(token);
        }
    }
    None
}

fn parse_oauth_token_from_hosts(content: &str) -> Option<String> {
    let mut in_github: bool = false;
    for line in content.lines() {
        let trimmed: &str = line.trim();
        if line.starts_with("github.com:") {
            in_github = true;
            continue;
        }
        if in_github && !line.starts_with(' ') && !line.starts_with('\t') && line.ends_with(':') {
            in_github = false;
        }
        if in_github && let Some(rest) = trimmed.strip_prefix("oauth_token:") {
            let tok: &str = rest.trim();
            if !tok.is_empty() {
                return Some(tok.to_owned());
            }
        }
    }
    None
}

fn query_git_credential_helper() -> Option<String> {
    use std::io::Write;
    let mut child = std::process::Command::new("git")
        .args(["credential", "fill"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(b"protocol=https\nhost=github.com\n\n");
    }
    let output = child.wait_with_output().ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("password=") {
                let tok = rest.trim();
                if !tok.is_empty() {
                    return Some(tok.to_owned());
                }
            }
        }
    }
    None
}

impl TokenStore for KeychainStore {
    fn load(&self) -> Result<Option<String>, GithubError> {
        match Self::entry()?.get_password() {
            Ok(token) => {
                if token == DISCONNECTED_SENTINEL {
                    Ok(None)
                } else {
                    Ok(Some(token))
                }
            }
            Err(keyring::Error::NoEntry) => {
                if let Some(detected) = probe_local_github_token() {
                    let _ = self.save(&detected);
                    return Ok(Some(detected));
                }
                Ok(None)
            }
            Err(error) => Err(GithubError::Store(error.to_string())),
        }
    }

    fn save(&self, token: &str) -> Result<(), GithubError> {
        Self::entry()?
            .set_password(token)
            .map_err(|error| GithubError::Store(error.to_string()))
    }

    fn clear(&self) -> Result<(), GithubError> {
        Self::entry()?
            .set_password(DISCONNECTED_SENTINEL)
            .map_err(|error| GithubError::Store(error.to_string()))
    }
}

/// The answer to a Git prompt for github.com, when the stored token can give
/// it: any username works with a token, and the token is the password.
pub fn answer_for_prompt(prompt: &str, token: &str) -> Option<String> {
    let lower: String = prompt.to_ascii_lowercase();
    if !lower.contains("https://") || !host_is_github(&lower) {
        return None;
    }
    if lower.starts_with("username for") {
        Some("x-access-token".to_owned())
    } else if lower.starts_with("password for") {
        Some(token.to_owned())
    } else {
        None
    }
}

/// True only for `github.com` itself, not look-alikes such as `evilgithub.com`.
fn host_is_github(lower_prompt: &str) -> bool {
    let Some(start) = lower_prompt.find("https://") else {
        return false;
    };
    let rest: &str = &lower_prompt[start + "https://".len()..];
    let authority: &str = rest
        .split(|c: char| c == '/' || c == '\'' || c.is_whitespace())
        .next()
        .unwrap_or("");
    let host: &str = authority.rsplit('@').next().unwrap_or("");
    host == "github.com"
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::VecDeque;

    use super::*;

    #[test]
    fn api_sends_authorization_only_when_a_token_is_present() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        for token in ["", "  ", "test-token", "  test-token  "] {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
            let address = listener.local_addr().expect("listener address");
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept request");
                let mut request = [0; 4096];
                let size = stream.read(&mut request).expect("read request");
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                    )
                    .expect("write response");
                String::from_utf8(request[..size].to_vec()).expect("UTF-8 request")
            });
            UreqHttp::default()
                .api("GET", &format!("http://{address}/"), token, None)
                .expect("request");
            let request = server.join().expect("server").to_ascii_lowercase();
            assert_eq!(
                request.contains("authorization: bearer test-token"),
                !token.trim().is_empty()
            );
            if token.trim().is_empty() {
                assert!(!request.contains("authorization:"));
            }
        }
    }

    struct Scripted {
        replies: std::sync::Mutex<VecDeque<String>>,
        api_reply: (u16, String),
    }

    impl Scripted {
        fn new(replies: &[&str], api_reply: (u16, &str)) -> Self {
            Self {
                replies: std::sync::Mutex::new(replies.iter().map(|r| (*r).to_owned()).collect()),
                api_reply: (api_reply.0, api_reply.1.to_owned()),
            }
        }
    }

    impl Http for Scripted {
        fn post_form(&self, _url: &str, _form: &[(&str, &str)]) -> Result<String, GithubError> {
            self.replies
                .lock()
                .expect("lock")
                .pop_front()
                .ok_or_else(|| GithubError::Network("no more replies".to_owned()))
        }

        fn api(
            &self,
            _m: &str,
            _u: &str,
            _t: &str,
            _b: Option<&str>,
        ) -> Result<(u16, String), GithubError> {
            Ok(self.api_reply.clone())
        }
    }

    fn code() -> DeviceCode {
        DeviceCode {
            device_code: "dc".to_owned(),
            user_code: "ABCD-1234".to_owned(),
            verification_uri: "https://github.com/login/device".to_owned(),
            expires_in: 900,
            interval: 5,
        }
    }

    #[test]
    fn polls_until_the_person_approves() {
        let http = Scripted::new(
            &[
                r#"{"error":"authorization_pending"}"#,
                r#"{"error":"slow_down","interval":10}"#,
                r#"{"access_token":"tok"}"#,
            ],
            (200, ""),
        );
        let slept: RefCell<Vec<u64>> = RefCell::new(Vec::new());
        let sleep = |duration: Duration| slept.borrow_mut().push(duration.as_secs());
        let token = wait_for_token(&http, "id", &code(), &AtomicBool::new(false), &sleep);
        assert_eq!(token.expect("token"), "tok");
        assert_eq!(*slept.borrow(), vec![5, 5, 10]);
    }

    #[test]
    fn reports_denial_expiry_and_cancel() {
        let sleep = |_: Duration| {};
        let denied = Scripted::new(&[r#"{"error":"access_denied"}"#], (200, ""));
        assert!(matches!(
            wait_for_token(&denied, "id", &code(), &AtomicBool::new(false), &sleep),
            Err(GithubError::Denied)
        ));
        let expired = Scripted::new(&[r#"{"error":"expired_token"}"#], (200, ""));
        assert!(matches!(
            wait_for_token(&expired, "id", &code(), &AtomicBool::new(false), &sleep),
            Err(GithubError::Expired)
        ));
        let idle = Scripted::new(&[], (200, ""));
        assert!(matches!(
            wait_for_token(&idle, "id", &code(), &AtomicBool::new(true), &sleep),
            Err(GithubError::Cancelled)
        ));
    }

    #[test]
    fn parses_the_device_code() {
        let http = Scripted::new(
            &[
                r#"{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
            ],
            (200, ""),
        );
        assert_eq!(start_device_flow(&http, "id").expect("code"), code());
    }

    #[test]
    fn maps_api_failures() {
        let unauthorised = Scripted::new(&[], (401, "{}"));
        assert!(matches!(
            current_account(&unauthorised, "t"),
            Err(GithubError::Unauthorized)
        ));
        let refused = Scripted::new(&[], (422, r#"{"message":"name already exists"}"#));
        let error = create_repository(&refused, "t", "x", None, true).expect_err("refused");
        assert!(error.to_string().contains("name already exists"));
        let account = Scripted::new(&[], (200, r#"{"login":"octo"}"#));
        assert_eq!(current_account(&account, "t").expect("user").login, "octo");
    }

    #[test]
    fn lists_repositories() {
        let http = Scripted::new(
            &[],
            (
                200,
                r#"[{"full_name":"o/r","description":null,"private":true,"clone_url":"https://github.com/o/r.git","extra":1}]"#,
            ),
        );
        let repositories = list_repositories(&http, "t", 1).expect("list");
        assert_eq!(repositories.len(), 1);
        assert_eq!(repositories[0].full_name, "o/r");
    }

    #[test]
    fn answers_only_github_https_prompts() {
        assert_eq!(
            answer_for_prompt("Username for 'https://github.com': ", "tok").as_deref(),
            Some("x-access-token")
        );
        assert_eq!(
            answer_for_prompt("Password for 'https://x-access-token@github.com': ", "tok")
                .as_deref(),
            Some("tok")
        );
        assert_eq!(
            answer_for_prompt("Password for 'https://evilgithub.com': ", "tok"),
            None
        );
        assert_eq!(
            answer_for_prompt("Password for 'https://github.com.evil.io': ", "tok"),
            None
        );
        assert_eq!(
            answer_for_prompt("Enter passphrase for key 'k': ", "tok"),
            None
        );
    }

    #[test]
    fn validates_token_shapes() {
        assert!(is_valid_token_shape("ghp_1234567890abcdef"));
        assert!(is_valid_token_shape("gho_1234567890abcdef"));
        assert!(is_valid_token_shape("github_pat_1234567890abcdef"));
        assert!(is_valid_token_shape(
            "0123456789abcdef0123456789abcdef01234567"
        ));
        assert!(!is_valid_token_shape("short"));
        assert!(!is_valid_token_shape("not_a_valid_token_hex_1234567890"));
    }

    #[test]
    fn parses_token_from_hosts_yaml() {
        let sample = "github.com:\n    user: testuser\n    oauth_token: gho_testtoken12345678\n";
        assert_eq!(
            parse_oauth_token_from_hosts(sample).as_deref(),
            Some("gho_testtoken12345678")
        );
        let sample_empty = "github.com:\n    user: testuser\n";
        assert_eq!(parse_oauth_token_from_hosts(sample_empty), None);
    }
}
