import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Resolve DB path from env or default
const dbPath = process.env.DB_PATH ?? './data/care-circle.db';
const resolvedPath = path.resolve(dbPath);

// Ensure data directory exists
const dir = path.dirname(resolvedPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(resolvedPath);
    // Enable WAL mode for better concurrency
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

/** Close and reset the DB instance (used in tests) */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Create a fresh in-memory DB for testing */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS care_recipients (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      relationship TEXT NOT NULL,
      demo_data   INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS caregivers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL UNIQUE,
      demo_data    INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS care_updates (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id   INTEGER NOT NULL REFERENCES care_recipients(id),
      caregiver_name TEXT NOT NULL,
      raw_text       TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS care_tasks (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id       INTEGER NOT NULL REFERENCES care_recipients(id),
      description        TEXT NOT NULL,
      due_date           TEXT,           -- ISO 8601, nullable
      responsible_person TEXT,           -- nullable if unassigned
      status             TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
      source_update      TEXT,           -- original update text for traceability
      created_by         TEXT NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL REFERENCES care_tasks(id),
      changed_by  TEXT NOT NULL,
      old_status  TEXT NOT NULL,
      new_status  TEXT NOT NULL,
      changed_at  TEXT NOT NULL DEFAULT (datetime('now')),
      note        TEXT
    );

    CREATE TABLE IF NOT EXISTS handoffs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id INTEGER NOT NULL REFERENCES care_recipients(id),
      generated_by TEXT NOT NULL,
      content      TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
