//! GitHub sign-in (OAuth device flow) and the few REST calls RustGit needs.
//!
//! The device flow needs only the application's public client id: nothing
//! secret ships in the binary. The access token is kept in the operating
//! system's credential store, never in the database or in logs, and is handed
//! to Git only through the credential prompt broker.

use std::io::Read;
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
    /// Authenticated request; returns `(status, body)`.
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
        let authorization: String = format!("Bearer {token}");
        let response = match (method, body) {
            ("POST", Some(body)) => self
                .agent
                .post(url)
                .header("Authorization", &authorization)
                .header("Accept", "application/vnd.github+json")
                .header("Content-Type", "application/json")
                .send(body),
            _ => self
                .agent
                .get(url)
                .header("Authorization", &authorization)
                .header("Accept", "application/vnd.github+json")
                .call(),
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
    private: bool,
) -> Result<GithubRepository, GithubError> {
    let body: String = serde_json::json!({ "name": name, "private": private }).to_string();
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

impl TokenStore for KeychainStore {
    fn load(&self) -> Result<Option<String>, GithubError> {
        match Self::entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(GithubError::Store(error.to_string())),
        }
    }

    fn save(&self, token: &str) -> Result<(), GithubError> {
        Self::entry()?
            .set_password(token)
            .map_err(|error| GithubError::Store(error.to_string()))
    }

    fn clear(&self) -> Result<(), GithubError> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(GithubError::Store(error.to_string())),
        }
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
        let error = create_repository(&refused, "t", "x", true).expect_err("refused");
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
}
