/**
 * Database connection — libSQL / Turso.
 *
 * Uses @libsql/client which works in all environments:
 *   - Local dev:   file:./data/care-circle.db  (or :memory: for tests)
 *   - Vercel/prod: remote Turso URL + auth token via env vars
 *
 * Environment variables:
 *   TURSO_DATABASE_URL  — libsql://... (Turso) or file:./data/care-circle.db (local)
 *   TURSO_AUTH_TOKEN    — auth token (required for remote Turso; leave blank for local file)
 */
import { createClient, type Client } from '@libsql/client';

let _client: Client | null = null;

export function getDb(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL ?? 'file:./data/care-circle.db';
    const authToken = process.env.TURSO_AUTH_TOKEN ?? undefined;
    _client = createClient({ url, authToken });
  }
  return _client;
}

/** Reset the client (used in tests) */
export function closeDb(): void {
  if (_client) {
    _client.close();
    _client = null;
  }
}

/** Create a fresh in-memory client for testing */
export function createTestDb(): Client {
  return createClient({ url: ':memory:' });
}

/** Initialise schema — safe to call multiple times (CREATE IF NOT EXISTS) */
export async function initSchema(client: Client): Promise<void> {
  await client.executeMultiple(`
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
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS care_tasks (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id       INTEGER NOT NULL REFERENCES care_recipients(id),
      description        TEXT NOT NULL,
      due_date           TEXT,
      responsible_person TEXT,
      status             TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
      source_update      TEXT,
      created_by         TEXT NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS task_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL REFERENCES care_tasks(id),
      changed_by  TEXT NOT NULL,
      old_status  TEXT NOT NULL,
      new_status  TEXT NOT NULL,
      changed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      note        TEXT
    );

    CREATE TABLE IF NOT EXISTS handoffs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id INTEGER NOT NULL REFERENCES care_recipients(id),
      generated_by TEXT NOT NULL,
      handed_to    TEXT,
      content      TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}
