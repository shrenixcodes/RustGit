//! Local SQLite store for RustGit metadata (known repositories, preferences).
//!
//! Credentials are never stored here.

mod repositories;
mod settings;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

pub use repositories::{RepositoryEntry, owning_repository};
pub use settings::{Settings, ThemePreference};

/// Ordered schema migrations. The index + 1 is stored in `PRAGMA user_version`.
const MIGRATIONS: &[&str] = &[include_str!("../../migrations/0001_initial.sql")];

#[derive(Debug, thiserror::Error)]
pub enum DatabaseError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("database file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("the database connection is unavailable after an earlier failure")]
    Poisoned,
    #[error("repository {0} is not registered in RustGit")]
    RepositoryNotFound(i64),
    #[error("database schema version {found} is newer than this RustGit supports ({supported})")]
    UnsupportedSchema { found: i64, supported: i64 },
}

pub type DatabaseResult<T> = Result<T, DatabaseError>;

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    /// Opens (creating if necessary) the database file and applies migrations.
    pub fn open(path: &Path) -> DatabaseResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection: Connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "temp_store", "MEMORY")?;
        let _ = connection.pragma_update(None, "mmap_size", 33554432_i64);
        Self::from_connection(connection)
    }

    /// Opens a private in-memory database (used by tests).
    #[cfg(test)]
    pub fn open_in_memory() -> DatabaseResult<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(mut connection: Connection) -> DatabaseResult<Self> {
        connection.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&mut connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn lock(&self) -> DatabaseResult<MutexGuard<'_, Connection>> {
        self.connection.lock().map_err(|_| DatabaseError::Poisoned)
    }
}

fn migrate(connection: &mut Connection) -> DatabaseResult<()> {
    let current: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let supported: i64 = i64::try_from(MIGRATIONS.len()).unwrap_or(i64::MAX);
    if current > supported {
        return Err(DatabaseError::UnsupportedSchema {
            found: current,
            supported,
        });
    }
    for (index, sql) in MIGRATIONS
        .iter()
        .enumerate()
        .skip(usize::try_from(current).unwrap_or(0))
    {
        let transaction: rusqlite::Transaction<'_> = connection.transaction()?;
        transaction.execute_batch(sql)?;
        transaction.pragma_update(
            None,
            "user_version",
            i64::try_from(index + 1).unwrap_or(i64::MAX),
        )?;
        transaction.commit()?;
    }
    Ok(())
}

pub(crate) fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_applied_once() {
        let file: tempfile::NamedTempFile = tempfile::NamedTempFile::new().expect("temp file");
        Database::open(file.path()).expect("first open");
        let reopened: Database = Database::open(file.path()).expect("second open");
        let version: i64 = reopened
            .lock()
            .expect("lock")
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("version");
        assert_eq!(version, 1);
    }

    #[test]
    fn rejects_newer_schema() {
        let file: tempfile::NamedTempFile = tempfile::NamedTempFile::new().expect("temp file");
        {
            let connection: Connection = Connection::open(file.path()).expect("open");
            connection
                .pragma_update(None, "user_version", 99)
                .expect("set version");
        }
        assert!(matches!(
            Database::open(file.path()),
            Err(DatabaseError::UnsupportedSchema { found: 99, .. })
        ));
    }
}
