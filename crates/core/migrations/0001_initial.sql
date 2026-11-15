CREATE TABLE repositories (
    id             INTEGER PRIMARY KEY,
    path           TEXT    NOT NULL UNIQUE,
    name           TEXT    NOT NULL,
    pinned         INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    added_at       INTEGER NOT NULL,
    last_opened_at INTEGER
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
