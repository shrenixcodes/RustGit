use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::{Database, DatabaseResult};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

impl ThemePreference {
    fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }
}

/// User preferences. Unknown or invalid stored values fall back to defaults.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: ThemePreference,
}

const THEME_KEY: &str = "theme";

impl Database {
    pub fn settings(&self) -> DatabaseResult<Settings> {
        let connection = self.lock()?;
        let theme: Option<String> = connection
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![THEME_KEY],
                |row| row.get(0),
            )
            .optional()?;
        Ok(Settings {
            theme: theme
                .as_deref()
                .and_then(ThemePreference::parse)
                .unwrap_or_default(),
        })
    }

    pub fn set_theme(&self, theme: ThemePreference) -> DatabaseResult<Settings> {
        self.lock()?.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![THEME_KEY, theme.as_str()],
        )?;
        self.settings()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_defaults_to_system_and_persists() {
        let db: Database = Database::open_in_memory().expect("db");
        assert_eq!(
            db.settings().expect("settings").theme,
            ThemePreference::System
        );
        db.set_theme(ThemePreference::Dark).expect("set");
        assert_eq!(
            db.settings().expect("settings").theme,
            ThemePreference::Dark
        );
    }

    #[test]
    fn invalid_stored_theme_falls_back_to_default() {
        let db: Database = Database::open_in_memory().expect("db");
        db.lock()
            .expect("lock")
            .execute(
                "INSERT INTO settings (key, value) VALUES ('theme', 'neon')",
                [],
            )
            .expect("insert");
        assert_eq!(
            db.settings().expect("settings").theme,
            ThemePreference::System
        );
    }
}
