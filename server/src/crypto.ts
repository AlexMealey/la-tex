import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { createLimiter } from './limit.js';

/**
 * Key hierarchy:
 *   password --scrypt--> 64 bytes --HKDF--> auth verifier (stored) and KEK (never stored)
 *   DEK (random, per user) is stored wrapped by the KEK, by the recovery key and by each session key.
 *   Each project's files are sealed with HKDF(DEK, projectId).
 */

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;

// OWASP's scrypt baseline. Each derivation uses 128 MiB, so only two run at once.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const scryptLimit = createLimiter(2);

export const PASSWORD_MIN = 10;
const PASSWORD_MAX = 1024;

export function checkPassword(password: unknown): string {
  if (typeof password !== 'string') throw new HttpError(400, 'Password is required');
  const normalised = password.normalize('NFKC');
  if (normalised.length < PASSWORD_MIN) throw new HttpError(400, `Password must be at least ${PASSWORD_MIN} characters`);
  if (normalised.length > PASSWORD_MAX) throw new HttpError(400, 'Password is too long');
  return normalised;
}

export function randomBytes(n: number): Buffer {
  return crypto.randomBytes(n);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(data: string | Buffer): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

export function hkdf(ikm: Buffer, salt: string | Buffer, info: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, KEY_BYTES));
}

/** Slow, salted password hash split into a stored verifier and a never-stored key-encryption key. */
export async function deriveFromPassword(password: string, salt: Buffer): Promise<{ verifier: Buffer; kek: Buffer }> {
  const out = await scryptLimit(
    () =>
      new Promise<Buffer>((resolve, reject) =>
        crypto.scrypt(password, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
      ),
  );
  return { verifier: hkdf(out, salt, 'auth-verifier'), kek: hkdf(out, salt, 'key-encryption-key') };
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** AES-256-GCM: [version][12-byte IV][ciphertext][16-byte tag]. `aad` binds the data to where it belongs. */
export function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]);
}

/** Throws if the data was tampered with, or the key or `aad` is wrong. */
export function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES || sealed[0] !== VERSION) throw new Error('Unsupported encrypted data');
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(1 + IV_BYTES, sealed.length - TAG_BYTES)), decipher.final()]);
}

export function projectKey(dek: Buffer, projectId: string): Buffer {
  return hkdf(dek, projectId, 'project');
}

// Recovery codes: 20 random bytes as Crockford base32 in groups of four, e.g. "7KQ2-…".
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_BYTES = 20;

export function newRecoveryCode(): { code: string; key: Buffer } {
  const bytes = crypto.randomBytes(RECOVERY_BYTES);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return { code: out.match(/.{1,4}/g)!.join('-'), key: recoveryKey(bytes) };
}

/** Accepts the code in any case, with or without dashes and spaces; returns null if it can't be one. */
export function recoveryKeyFrom(code: string): Buffer | null {
  const clean = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (clean.length !== (RECOVERY_BYTES * 8) / 5) return null;
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return recoveryKey(Buffer.from(bytes));
}

function recoveryKey(bytes: Buffer): Buffer {
  return hkdf(bytes, 'latex-editor', 'recovery-key');
}
