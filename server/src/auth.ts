import crypto from 'node:crypto';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { config } from './config.js';
import {
  KEY_BYTES,
  checkPassword,
  deriveFromPassword,
  hkdf,
  newRecoveryCode,
  open,
  randomBytes,
  randomToken,
  recoveryKeyFrom,
  safeEqual,
  seal,
  sha256,
} from './crypto.js';
import { db, transaction, type InviteRow, type SessionRow, type UserRow } from './db.js';
import { HttpError } from './http.js';

/** The logged-in user, with their data key unwrapped for this request only. */
export interface SessionUser {
  id: string;
  username: string;
  isAdmin: boolean;
  dek: Buffer;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionHash?: Buffer;
    }
  }
}

const COOKIE = config.cookieSecure ? '__Host-sid' : 'sid';
const COOKIE_OPTIONS: CookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' };
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const BAD_LOGIN = 'Invalid username or password';
const DUMMY_SALT = randomBytes(32);

/** A wrong password or recovery code: the only errors that count towards the lockout. */
class AuthFailure extends HttpError {}

const wrapAad = (userId: string, purpose: 'password' | 'recovery' | 'session') => `user:${userId}:${purpose}`;
const buf = (u8: Uint8Array) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);

// ---- Brute-force throttling ----------------------------------------------

class Throttle {
  private failures = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): void {
    const f = this.failures.get(key);
    if (f && f.resetAt > Date.now() && f.count >= this.max) {
      const minutes = Math.ceil((f.resetAt - Date.now()) / 60_000);
      throw new HttpError(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    }
  }

  fail(key: string): void {
    const now = Date.now();
    const f = this.failures.get(key);
    if (!f || f.resetAt <= now) this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
    else f.count++;
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  sweep(): void {
    const now = Date.now();
    for (const [key, f] of this.failures) if (f.resetAt <= now) this.failures.delete(key);
  }
}

const byIp = new Throttle(20, 15 * 60_000);
const byUsername = new Throttle(5, 15 * 60_000);

/** Run a password or recovery-code check, counting failures per client IP and per username. */
async function throttled<T>(req: Request, username: string, fn: () => Promise<T>): Promise<T> {
  const ip = `ip:${req.ip}`;
  const name = `user:${username.toLowerCase()}`;
  byIp.check(ip);
  byUsername.check(name);
  try {
    const result = await fn();
    byUsername.reset(name);
    return result;
  } catch (err) {
    if (err instanceof AuthFailure) {
      byIp.fail(ip);
      byUsername.fail(name);
    }
    throw err;
  }
}

// ---- Accounts ------------------------------------------------------------

const userByName = db.prepare('SELECT * FROM users WHERE username = ?');
const userById = db.prepare('SELECT * FROM users WHERE id = ?');

async function passwordKeys(userId: string, password: string, dek: Buffer) {
  const salt = randomBytes(32);
  const { verifier, kek } = await deriveFromPassword(password, salt);
  return { salt, verifier, wrapped: seal(kek, dek, wrapAad(userId, 'password')) };
}

function recoveryKeys(userId: string, dek: Buffer) {
  const { code, key } = newRecoveryCode();
  return { code, wrapped: seal(key, dek, wrapAad(userId, 'recovery')) };
}

/** Check a password against a user row and unwrap their data key. Unknown users take just as long. */
async function unlock(row: UserRow | undefined, password: string): Promise<Buffer> {
  const { verifier, kek } = await deriveFromPassword(password, row ? buf(row.kdf_salt) : DUMMY_SALT);
  if (!row || !safeEqual(verifier, buf(row.auth_verifier))) throw new AuthFailure(401, BAD_LOGIN);
  if (row.disabled) throw new HttpError(403, 'This account is disabled');
  return open(kek, buf(row.wrapped_dek), wrapAad(row.id, 'password'));
}

function toSessionUser(row: UserRow, dek: Buffer): SessionUser {
  return { id: row.id, username: row.username, isAdmin: !!row.is_admin, dek };
}

function findInvite(token: string): InviteRow | undefined {
  const row = db
    .prepare('SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
    .get(sha256(token), Date.now()) as InviteRow | undefined;
  return row;
}

export function inviteInfo(token: string): { valid: boolean; isAdmin: boolean } {
  const invite = findInvite(token);
  return { valid: !!invite, isAdmin: !!invite?.is_admin };
}

export async function register(
  req: Request,
  body: { invite?: unknown; username?: unknown; password?: unknown },
): Promise<{ user: SessionUser; recoveryCode: string; firstUser: boolean }> {
  const token = String(body.invite ?? '');
  const username = String(body.username ?? '').trim();
  const ip = `ip:${req.ip}`;
  byIp.check(ip);
  if (!findInvite(token)) {
    byIp.fail(ip);
    throw new HttpError(400, 'This invite link is invalid, used or expired');
  }
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, 'Usernames are 3–32 characters: letters, digits, dot, dash or underscore');
  }
  const password = checkPassword(body.password);
  if (userByName.get(username)) throw new HttpError(409, 'That username is taken');

  const id = crypto.randomUUID();
  const dek = randomBytes(KEY_BYTES);
  const pw = await passwordKeys(id, password, dek);
  const recovery = recoveryKeys(id, dek);

  return transaction(() => {
    // Checked again inside the transaction: the slow hash above lets requests interleave.
    const invite = findInvite(token);
    if (!invite) throw new HttpError(400, 'This invite link is invalid, used or expired');
    if (userByName.get(username)) throw new HttpError(409, 'That username is taken');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    const now = Date.now();
    db.prepare(
      `INSERT INTO users (id, username, kdf_salt, auth_verifier, wrapped_dek, wrapped_dek_recovery, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, username, pw.salt, pw.verifier, pw.wrapped, recovery.wrapped, invite.is_admin, now);
    db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?').run(now, id, invite.id);
    return {
      user: { id, username, isAdmin: !!invite.is_admin, dek },
      recoveryCode: recovery.code,
      firstUser: n === 0,
    };
  });
}

export async function login(req: Request, body: { username?: unknown; password?: unknown }): Promise<SessionUser> {
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '').normalize('NFKC');
  return throttled(req, username, async () => {
    const row = userByName.get(username) as UserRow | undefined;
    const dek = await unlock(row, password);
    return toSessionUser(row!, dek);
  });
}

/** New password, new recovery code; every other session of this user is logged out. */
export async function changePassword(
  req: Request,
  body: { currentPassword?: unknown; newPassword?: unknown },
): Promise<string> {
  const user = currentUser(req);
  const next = checkPassword(body.newPassword);
  return throttled(req, user.username, async () => {
    const row = userById.get(user.id) as UserRow | undefined;
    // Not 401: that would mean "logged out" to the client.
    const dek = await unlock(row, String(body.currentPassword ?? '').normalize('NFKC')).catch((err) => {
      throw err instanceof AuthFailure ? new AuthFailure(400, 'Current password is incorrect') : err;
    });
    const pw = await passwordKeys(user.id, next, dek);
    const recovery = recoveryKeys(user.id, dek);
    transaction(() => {
      db.prepare(
        'UPDATE users SET kdf_salt = ?, auth_verifier = ?, wrapped_dek = ?, wrapped_dek_recovery = ? WHERE id = ?',
      ).run(pw.salt, pw.verifier, pw.wrapped, recovery.wrapped, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(user.id, req.sessionHash ?? null);
    });
    return recovery.code;
  });
}

/** Set a new password with the recovery code. Logs out every session and issues a new code. */
export async function recover(
  req: Request,
  body: { username?: unknown; recoveryCode?: unknown; newPassword?: unknown },
): Promise<{ user: SessionUser; recoveryCode: string }> {
  const username = String(body.username ?? '').trim();
  const next = checkPassword(body.newPassword);
  return throttled(req, username, async () => {
    const row = userByName.get(username) as UserRow | undefined;
    const key = recoveryKeyFrom(String(body.recoveryCode ?? ''));
    let dek: Buffer;
    try {
      if (!row || !key) throw new Error();
      dek = open(key, buf(row.wrapped_dek_recovery), wrapAad(row.id, 'recovery'));
    } catch {
      throw new AuthFailure(401, 'Invalid username or recovery code');
    }
    if (row.disabled) throw new HttpError(403, 'This account is disabled');
    const pw = await passwordKeys(row.id, next, dek);
    const recovery = recoveryKeys(row.id, dek);
    transaction(() => {
      db.prepare(
        'UPDATE users SET kdf_salt = ?, auth_verifier = ?, wrapped_dek = ?, wrapped_dek_recovery = ? WHERE id = ?',
      ).run(pw.salt, pw.verifier, pw.wrapped, recovery.wrapped, row.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    });
    return { user: toSessionUser(row, dek), recoveryCode: recovery.code };
  });
}

// ---- Sessions ------------------------------------------------------------

// The cookie holds a random token. The database stores only its hash, plus the user's data key
// wrapped by a key derived from the token, so a copy of the database can't decrypt anything.
const sessionKey = (raw: Buffer) => hkdf(raw, 'session', 'session-key');

/** Log in on this browser, replacing any session it already had. */
export function startSession(req: Request, res: Response, user: SessionUser): void {
  if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(req.sessionHash);
  const raw = randomBytes(32);
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id_hash, user_id, wrapped_dek, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(sha256(raw), user.id, seal(sessionKey(raw), user.dek, wrapAad(user.id, 'session')), now, now, now + config.sessionMaxMs);
  res.cookie(COOKIE, raw.toString('base64url'), { ...COOKIE_OPTIONS, maxAge: config.sessionMaxMs });
}

export function endSession(req: Request, res: Response): void {
  if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(req.sessionHash);
  res.clearCookie(COOKIE, COOKIE_OPTIONS);
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

const sessionLookup = db.prepare(
  `SELECT s.*, u.username, u.is_admin, u.disabled FROM sessions s JOIN users u ON u.id = s.user_id
   WHERE s.id_hash = ?`,
);
const touchSession = db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?');

/** Sets `req.user` when the request carries a valid session cookie. Never rejects by itself. */
export const loadSession: RequestHandler = (req, _res, next) => {
  const token = readCookie(req, COOKIE);
  const raw = token ? Buffer.from(token, 'base64url') : null;
  if (raw?.length === 32) {
    const hash = sha256(raw);
    const row = sessionLookup.get(hash) as
      | (SessionRow & Pick<UserRow, 'username' | 'is_admin' | 'disabled'>)
      | undefined;
    const now = Date.now();
    if (row && !row.disabled && row.expires_at > now && row.last_seen_at + config.sessionIdleMs > now) {
      try {
        const dek = open(sessionKey(raw), buf(row.wrapped_dek), wrapAad(row.user_id, 'session'));
        req.user = { id: row.user_id, username: row.username, isAdmin: !!row.is_admin, dek };
        req.sessionHash = hash;
        if (now - row.last_seen_at > 60_000) touchSession.run(now, hash);
      } catch {
        // Wrong key for this session row: treat as logged out.
      }
    }
  }
  next();
};

export function currentUser(req: Request): SessionUser {
  if (!req.user) throw new HttpError(401, 'Please log in');
  return req.user;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  currentUser(req);
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!currentUser(req).isAdmin) throw new HttpError(403, 'Admins only');
  next();
};

/** Drop expired sessions and stale throttle entries. */
export function sweepSessions(): void {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?').run(now, now - config.sessionIdleMs);
  byIp.sweep();
  byUsername.sweep();
}

// ---- Invites and admin ---------------------------------------------------

const INVITE_TTL_MS = 7 * 24 * 3600_000;

export function createInvite(createdBy: string | null, isAdmin: boolean, ttlMs = INVITE_TTL_MS) {
  const token = randomToken();
  const now = Date.now();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO invites (token_hash, created_by, is_admin, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), createdBy, isAdmin ? 1 : 0, now, now + ttlMs);
  return { id: Number(lastInsertRowid), token, isAdmin, createdAt: now, expiresAt: now + ttlMs };
}

export function listInvites() {
  const rows = db
    .prepare(
      `SELECT i.id, i.is_admin, i.created_at, i.expires_at, u.username AS created_by FROM invites i
       LEFT JOIN users u ON u.id = i.created_by
       WHERE i.used_at IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC`,
    )
    .all(Date.now()) as { id: number; is_admin: number; created_at: number; expires_at: number; created_by: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    isAdmin: !!r.is_admin,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    createdBy: r.created_by,
  }));
}

export function revokeInvite(id: number): void {
  db.prepare('DELETE FROM invites WHERE id = ? AND used_at IS NULL').run(id);
}

export function listUsers() {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.is_admin, u.disabled, u.created_at, MAX(s.last_seen_at) AS last_seen_at
       FROM users u LEFT JOIN sessions s ON s.user_id = u.id GROUP BY u.id ORDER BY u.username`,
    )
    .all() as { id: string; username: string; is_admin: number; disabled: number; created_at: number; last_seen_at: number | null }[];
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    isAdmin: !!r.is_admin,
    disabled: !!r.disabled,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  }));
}

export function setUserDisabled(id: string, disabled: boolean): void {
  transaction(() => {
    const { changes } = db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
    if (!changes) throw new HttpError(404, 'User not found');
    if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  });
}

export function deleteUser(id: string): void {
  const { changes } = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (!changes) throw new HttpError(404, 'User not found');
}

/** With no accounts yet, print a one-time link for creating the first admin. */
export function ensureBootstrapInvite(): void {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n > 0) return;
  db.prepare('DELETE FROM invites WHERE created_by IS NULL AND used_at IS NULL').run();
  const { token } = createInvite(null, true, 24 * 3600_000);
  console.log(
    `First-run setup: open <editor URL>/#/register?invite=${token} to create the admin account ` +
      '(works once, expires in 24 hours; restart the server for a new link).',
  );
}
