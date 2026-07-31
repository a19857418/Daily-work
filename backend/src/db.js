const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings_store (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    app_key     TEXT UNIQUE NOT NULL,
    data        TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL,
    updated_by  TEXT
  );

  CREATE TABLE IF NOT EXISTS settings_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    app_key     TEXT NOT NULL,
    data        TEXT NOT NULL,
    version     INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    created_by  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_history_app_key ON settings_history(app_key, version DESC);
`);

module.exports = db;
