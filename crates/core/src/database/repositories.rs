use rusqlite::{OptionalExtension, Row, params};
use serde::Serialize;

use super::{Database, DatabaseError, DatabaseResult, unix_now};

/// A repository known to RustGit. Removing an entry never touches the files on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEntry {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub pinned: bool,
    pub added_at: i64,
    pub last_opened_at: Option<i64>,
}

const COLUMNS: &str = "id, path, name, pinned, added_at, last_opened_at";

fn from_row(row: &Row<'_>) -> rusqlite::Result<RepositoryEntry> {
    Ok(RepositoryEntry {
        id: row.get(0)?,
        path: row.get(1)?,
        name: row.get(2)?,
        pinned: row.get(3)?,
        added_at: row.get(4)?,
        last_opened_at: row.get(5)?,
    })
}

impl Database {
    /// Pinned first, then most recently opened, then by name.
    pub fn list_repositories(&self) -> DatabaseResult<Vec<RepositoryEntry>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM repositories \
             ORDER BY pinned DESC, last_opened_at IS NULL, last_opened_at DESC, name COLLATE NOCASE"
        ))?;
        let rows = statement.query_map([], from_row)?;
        rows.collect::<rusqlite::Result<Vec<RepositoryEntry>>>()
            .map_err(DatabaseError::from)
    }

    pub fn get_repository(&self, id: i64) -> DatabaseResult<RepositoryEntry> {
        let connection = self.lock()?;
        connection
            .query_row(
                &format!("SELECT {COLUMNS} FROM repositories WHERE id = ?1"),
                params![id],
                from_row,
            )
            .optional()?
            .ok_or(DatabaseError::RepositoryNotFound(id))
    }

    /// Registers a repository root (or returns the existing entry) and marks it opened.
    pub fn upsert_repository(&self, path: &str, name: &str) -> DatabaseResult<RepositoryEntry> {
        let now: i64 = unix_now();
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO repositories (path, name, added_at, last_opened_at) VALUES (?1, ?2, ?3, ?3) \
             ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at",
            params![path, name, now],
        )?;
        connection
            .query_row(
                &format!("SELECT {COLUMNS} FROM repositories WHERE path = ?1"),
                params![path],
                from_row,
            )
            .map_err(DatabaseError::from)
    }

    pub fn touch_repository(&self, id: i64) -> DatabaseResult<RepositoryEntry> {
        let changed: usize = self.lock()?.execute(
            "UPDATE repositories SET last_opened_at = ?2 WHERE id = ?1",
            params![id, unix_now()],
        )?;
        if changed == 0 {
            return Err(DatabaseError::RepositoryNotFound(id));
        }
        self.get_repository(id)
    }

    pub fn set_repository_pinned(&self, id: i64, pinned: bool) -> DatabaseResult<RepositoryEntry> {
        let changed: usize = self.lock()?.execute(
            "UPDATE repositories SET pinned = ?2 WHERE id = ?1",
            params![id, pinned],
        )?;
        if changed == 0 {
            return Err(DatabaseError::RepositoryNotFound(id));
        }
        self.get_repository(id)
    }

    /// Forgets a repository. The working tree on disk is not modified.
    pub fn remove_repository(&self, id: i64) -> DatabaseResult<()> {
        let changed: usize = self
            .lock()?
            .execute("DELETE FROM repositories WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(DatabaseError::RepositoryNotFound(id));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_is_idempotent_per_path() {
        let db: Database = Database::open_in_memory().expect("db");
        let first: RepositoryEntry = db.upsert_repository("/r/alpha", "alpha").expect("insert");
        let second: RepositoryEntry = db.upsert_repository("/r/alpha", "alpha").expect("upsert");
        assert_eq!(first.id, second.id);
        assert_eq!(db.list_repositories().expect("list").len(), 1);
    }

    #[test]
    fn pinned_repositories_sort_first() {
        let db: Database = Database::open_in_memory().expect("db");
        db.upsert_repository("/r/alpha", "alpha").expect("insert");
        let beta: RepositoryEntry = db.upsert_repository("/r/beta", "beta").expect("insert");
        db.upsert_repository("/r/gamma", "gamma").expect("insert");

        db.set_repository_pinned(beta.id, true).expect("pin");
        let names: Vec<String> = db
            .list_repositories()
            .expect("list")
            .into_iter()
            .map(|entry: RepositoryEntry| entry.name)
            .collect();
        assert_eq!(names.first().map(String::as_str), Some("beta"));
    }

    #[test]
    fn remove_and_missing_ids() {
        let db: Database = Database::open_in_memory().expect("db");
        let entry: RepositoryEntry = db.upsert_repository("/r/alpha", "alpha").expect("insert");
        db.remove_repository(entry.id).expect("remove");
        assert!(db.list_repositories().expect("list").is_empty());
        assert!(matches!(
            db.remove_repository(entry.id),
            Err(DatabaseError::RepositoryNotFound(_))
        ));
        assert!(matches!(
            db.set_repository_pinned(entry.id, true),
            Err(DatabaseError::RepositoryNotFound(_))
        ));
        assert!(matches!(
            db.get_repository(entry.id),
            Err(DatabaseError::RepositoryNotFound(_))
        ));
    }
}
