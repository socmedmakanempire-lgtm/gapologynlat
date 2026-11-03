CREATE TABLE IF NOT EXISTS app_state (
 id TEXT PRIMARY KEY CHECK (id = 'main'), revision INTEGER NOT NULL DEFAULT 0,
 data TEXT NOT NULL, updated_at TEXT NOT NULL, last_operation TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO app_state(id, revision, data, updated_at)
VALUES('main', 0, '{"catalog":[],"mediaLibrary":{"nextIndex":1,"assets":[]},"customTexts":{}}', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS edit_history (
 revision INTEGER PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, actor TEXT NOT NULL,
 action TEXT NOT NULL, created_at TEXT NOT NULL, summary TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS history_no_update BEFORE UPDATE ON edit_history BEGIN SELECT RAISE(ABORT,'History is append-only'); END;
CREATE TRIGGER IF NOT EXISTS history_no_delete BEFORE DELETE ON edit_history BEGIN SELECT RAISE(ABORT,'History is append-only'); END;
CREATE TABLE IF NOT EXISTS login_attempts (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
