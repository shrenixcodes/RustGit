//! Credential prompts for Git and ssh.
//!
//! Git processes run without a terminal, so a missing password or key
//! passphrase would just fail. Instead every Git process is started with
//! `GIT_ASKPASS` / `SSH_ASKPASS` pointing at this executable. In that mode
//! it connects to the broker below, over loopback and with a random token,
//! and prints whatever the user typed into the application. Answers pass
//! through memory only: they are never stored, logged or put in a command
//! line. Git credential helpers (Git Credential Manager) still run first.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

pub const ADDRESS_VARIABLE: &str = "RUSTGIT_ASKPASS_ADDR";
pub const TOKEN_VARIABLE: &str = "RUSTGIT_ASKPASS_TOKEN";

const MAX_LINE: u64 = 8 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Payload of the `credential-requested` event. The prompt has any
/// credentials embedded in URLs removed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRequest {
    pub request_id: String,
    pub prompt: String,
    /// The answer should be hidden while it is typed.
    pub secret: bool,
}

/// Prompts waiting for an answer from the user interface.
#[derive(Debug, Default)]
pub struct PendingPrompts {
    next: AtomicU64,
    waiting: Mutex<HashMap<String, Sender<Option<String>>>>,
}

impl PendingPrompts {
    /// Registers a prompt; the receiver yields the user's answer.
    pub fn register(&self) -> (String, Receiver<Option<String>>) {
        let id: String = format!("credential-{}", self.next.fetch_add(1, Ordering::Relaxed));
        let (sender, receiver) = mpsc::channel();
        if let Ok(mut waiting) = self.waiting.lock() {
            waiting.insert(id.clone(), sender);
        }
        (id, receiver)
    }

    /// Delivers an answer (`None` = declined). False if the prompt is gone.
    pub fn answer(&self, id: &str, answer: Option<String>) -> bool {
        let sender: Option<Sender<Option<String>>> = self
            .waiting
            .lock()
            .ok()
            .and_then(|mut waiting| waiting.remove(id));
        sender.is_some_and(|sender| sender.send(answer).is_ok())
    }

    pub fn forget(&self, id: &str) {
        if let Ok(mut waiting) = self.waiting.lock() {
            waiting.remove(id);
        }
    }
}

/// Answers one prompt; `None` means the user declined. May block for a long time.
pub type PromptHandler = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// Listens for prompts from helper processes started by Git.
#[derive(Debug, Clone)]
pub struct AskpassBroker {
    address: SocketAddr,
    token: String,
}

impl AskpassBroker {
    /// Starts the listener thread, which lives as long as the process.
    pub fn start(handler: PromptHandler) -> io::Result<Self> {
        let listener: TcpListener = TcpListener::bind(("127.0.0.1", 0))?;
        let address: SocketAddr = listener.local_addr()?;
        let token: String = random_token()?;
        let expected: String = token.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let handler: PromptHandler = Arc::clone(&handler);
                let expected: String = expected.clone();
                std::thread::spawn(move || {
                    if let Err(error) = serve(stream, &expected, &handler) {
                        tracing::debug!(%error, "askpass request failed");
                    }
                });
            }
        });
        Ok(Self { address, token })
    }

    /// Environment that makes Git and ssh use `helper` for prompts.
    pub fn environment(&self, helper: &Path) -> Vec<(OsString, OsString)> {
        vec![
            ("GIT_ASKPASS".into(), helper.as_os_str().to_owned()),
            ("SSH_ASKPASS".into(), helper.as_os_str().to_owned()),
            ("SSH_ASKPASS_REQUIRE".into(), "force".into()),
            (ADDRESS_VARIABLE.into(), self.address.to_string().into()),
            (TOKEN_VARIABLE.into(), self.token.clone().into()),
        ]
    }
}

fn random_token() -> io::Result<String> {
    let mut bytes: [u8; 16] = [0; 16];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn read_line(reader: &mut impl BufRead) -> io::Result<String> {
    let mut line: String = String::new();
    reader.by_ref().take(MAX_LINE).read_line(&mut line)?;
    Ok(line.trim_end_matches(['\r', '\n']).to_owned())
}

fn serve(stream: TcpStream, expected_token: &str, handler: &PromptHandler) -> io::Result<()> {
    stream.set_read_timeout(Some(REQUEST_TIMEOUT))?;
    let mut reader: BufReader<TcpStream> = BufReader::new(stream.try_clone()?);
    let token: String = read_line(&mut reader)?;
    let prompt: String = read_line(&mut reader)?;
    let mut stream: TcpStream = stream;
    if token != expected_token {
        return stream.write_all(b"CANCEL\n");
    }
    match handler(&prompt) {
        Some(answer) => {
            let answer: String = answer.replace(['\r', '\n'], "");
            stream.write_all(format!("OK\n{answer}\n").as_bytes())
        }
        None => stream.write_all(b"CANCEL\n"),
    }
}

/// Asks the broker at `address`; `Ok(None)` when the user declined.
pub fn ask(address: &str, token: &str, prompt: &str) -> io::Result<Option<String>> {
    let mut stream: TcpStream = TcpStream::connect(address)?;
    let prompt: String = prompt.replace(['\r', '\n'], " ");
    stream.write_all(format!("{token}\n{prompt}\n").as_bytes())?;
    let mut reader: BufReader<TcpStream> = BufReader::new(stream);
    if read_line(&mut reader)? != "OK" {
        return Ok(None);
    }
    Ok(Some(read_line(&mut reader)?))
}

/// Entry point for the helper mode of the executable. Returns `None` when
/// the process was not started as a prompt helper, otherwise its exit code.
pub fn run_helper(arguments: &[String]) -> Option<i32> {
    let address: String = std::env::var(ADDRESS_VARIABLE).ok()?;
    let token: String = std::env::var(TOKEN_VARIABLE).ok()?;
    let prompt: &str = arguments.get(1)?;
    match ask(&address, &token, prompt) {
        Ok(Some(answer)) => {
            let mut out = io::stdout().lock();
            if writeln!(out, "{answer}").and_then(|()| out.flush()).is_ok() {
                Some(0)
            } else {
                Some(1)
            }
        }
        _ => Some(1),
    }
}

/// Whether the answer to `prompt` should be hidden while typing.
pub fn is_secret_prompt(prompt: &str) -> bool {
    let lower: String = prompt.to_ascii_lowercase();
    lower.contains("password") || lower.contains("passphrase") || lower.contains("pin")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn broker(answer: Option<&'static str>) -> AskpassBroker {
        AskpassBroker::start(Arc::new(move |_prompt: &str| answer.map(str::to_owned)))
            .expect("broker starts")
    }

    #[test]
    fn answers_a_prompt_with_the_right_token() {
        let broker: AskpassBroker = broker(Some("hunter2"));
        let answer = ask(
            &broker.address.to_string(),
            &broker.token,
            "Password for 'x': ",
        );
        assert_eq!(answer.expect("asks"), Some("hunter2".to_owned()));
    }

    #[test]
    fn declining_gives_no_answer() {
        let broker: AskpassBroker = broker(None);
        let answer = ask(
            &broker.address.to_string(),
            &broker.token,
            "Username for 'x': ",
        );
        assert_eq!(answer.expect("asks"), None);
    }

    #[test]
    fn a_wrong_token_never_reaches_the_handler() {
        let broker: AskpassBroker = broker(Some("secret"));
        let answer = ask(&broker.address.to_string(), "not-the-token", "Password: ");
        assert_eq!(answer.expect("asks"), None);
    }

    #[test]
    fn newlines_in_answers_are_removed() {
        let broker: AskpassBroker = broker(Some("a\nb"));
        let answer = ask(&broker.address.to_string(), &broker.token, "Password: ");
        assert_eq!(answer.expect("asks"), Some("ab".to_owned()));
    }

    #[test]
    fn pending_prompts_deliver_one_answer() {
        let pending: PendingPrompts = PendingPrompts::default();
        let (id, receiver) = pending.register();
        assert!(pending.answer(&id, Some("typed".to_owned())));
        assert_eq!(receiver.recv().expect("answer"), Some("typed".to_owned()));
        assert!(!pending.answer(&id, None));
        assert!(!pending.answer("credential-unknown", None));
    }

    #[test]
    fn classifies_secret_prompts() {
        assert!(is_secret_prompt("Password for 'https://github.com': "));
        assert!(is_secret_prompt(
            "Enter passphrase for key '/home/me/.ssh/id_ed25519': "
        ));
        assert!(!is_secret_prompt("Username for 'https://github.com': "));
    }

    #[test]
    fn environment_names_the_helper_and_broker() {
        let broker: AskpassBroker = broker(None);
        let environment = broker.environment(Path::new("helper"));
        let names: Vec<String> = environment
            .iter()
            .map(|(name, _)| name.to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"GIT_ASKPASS".to_owned()));
        assert!(names.contains(&ADDRESS_VARIABLE.to_owned()));
    }
}
