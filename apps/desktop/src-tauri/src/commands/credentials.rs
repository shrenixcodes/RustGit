//! Answers to credential prompts raised by Git and ssh (see `rustgit_core::askpass`).

use tauri::State;

use crate::state::AppState;

/// Delivers the user's answer to a prompt announced by `credential-requested`;
/// `None` declines it. False if the prompt already ended (timeout or cancel).
#[tauri::command]
pub fn respond_credential(
    state: State<'_, AppState>,
    request_id: String,
    answer: Option<String>,
) -> bool {
    state.prompts.answer(&request_id, answer)
}
