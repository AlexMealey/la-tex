import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

/** Schema changes, applied in order and tracked with PRAGMA user_version. */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kdf_salt BLOB NOT NULL,
    auth_verifier BLOB NOT NULL,
    wrapped_dek BLOB NOT NULL,
    wrapped_dek_recovery BLOB NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id_hash BLOB PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrapped_dek BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash BLOB NOT NULL UNIQUE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    used_by TEXT REFERENCES users(id) ON DELETE SET NULL
  );
  `,
];

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
fs.chmodSync(config.dbPath, 0o600);

const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
for (let v = version; v < MIGRATIONS.length; v++) {
  transaction(() => {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  });
}

/** Run `fn` atomically. node:sqlite is synchronous, so nothing else can interleave. */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface UserRow {
  id: string;
  username: string;
  kdf_salt: Uint8Array;
  auth_verifier: Uint8Array;
  wrapped_dek: Uint8Array;
  wrapped_dek_recovery: Uint8Array;
  is_admin: number;
  disabled: number;
  created_at: number;
}

export interface SessionRow {
  id_hash: Uint8Array;
  user_id: string;
  wrapped_dek: Uint8Array;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

export interface InviteRow {
  id: number;
  token_hash: Uint8Array;
  created_by: string | null;
  is_admin: number;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by: string | null;
}
