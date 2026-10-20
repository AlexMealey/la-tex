import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionUser } from './auth.js';
import { config } from './config.js';
import { open, projectKey, seal } from './crypto.js';
import { HttpError } from './http.js';
import { keyedMutex } from './limit.js';
import { cleanRelPath } from './paths.js';
import type { Engine } from './projects.js';

/**
 * Encrypted project storage. On disk a project is
 *   users/<userId>/<projectId>/manifest.enc   names, folders and metadata
 *   users/<userId>/<projectId>/blobs/<hex>    one encrypted blob per file version
 * so nothing about the project (names, paths, contents) is readable without the user's key.
 */

export interface StoredMeta {
  name: string;
  engine: Engine;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
}

export type Entry = { type: 'dir' } | { type: 'file'; blob: string; size: number; mtime: number };

interface Manifest {
  v: 1;
  meta: StoredMeta;
  entries: Record<string, Entry>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MANIFEST = 'manifest.enc';
const lock = keyedMutex();

/** Normalise a project path to `a/b/c`, rejecting escapes and the root. */
export function cleanPath(rel: string | string[]): string {
  return cleanRelPath('/project', rel);
}

export function userDir(userId: string): string {
  if (!UUID_RE.test(userId)) throw new HttpError(400, 'Invalid user');
  return path.join(config.usersDir, userId);
}

const parents = (rel: string) => rel.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'));
const isUnder = (p: string, folder: string) => p === folder || p.startsWith(`${folder}/`);

export class ProjectStore {
  private readonly key: Buffer;
  private readonly lockKey: string;

  private constructor(
    readonly userId: string,
    readonly id: string,
    dek: Buffer,
    readonly dir: string,
  ) {
    this.key = projectKey(dek, id);
    this.lockKey = `${userId}/${id}`;
  }

  private static at(user: SessionUser, id: string): ProjectStore {
    if (!UUID_RE.test(id)) throw new HttpError(404, 'Project not found');
    return new ProjectStore(user.id, id, user.dek, path.join(userDir(user.id), id));
  }

  static async create(user: SessionUser, meta: StoredMeta): Promise<ProjectStore> {
    const store = ProjectStore.at(user, crypto.randomUUID());
    await fs.mkdir(path.join(store.dir, 'blobs'), { recursive: true, mode: 0o700 });
    await store.save({ v: 1, meta, entries: {} });
    return store;
  }

  /** 404 unless the project exists in this user's own folder. */
  static async open(user: SessionUser, id: string): Promise<ProjectStore> {
    const store = ProjectStore.at(user, id);
    await store.load();
    return store;
  }

  // ---- Manifest ----------------------------------------------------------

  private async load(): Promise<Manifest> {
    let sealed: Buffer;
    try {
      sealed = await fs.readFile(path.join(this.dir, MANIFEST));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Project not found');
      throw err;
    }
    try {
      return JSON.parse(open(this.key, sealed, `${this.id}|manifest`).toString('utf8'));
    } catch {
      throw new HttpError(500, 'Project data could not be decrypted');
    }
  }

  /** Atomic replace: write a temporary file, flush it, then rename over the old manifest. */
  private async save(m: Manifest): Promise<void> {
    const target = path.join(this.dir, MANIFEST);
    const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await writeDurably(tmp, seal(this.key, Buffer.from(JSON.stringify(m)), `${this.id}|manifest`));
    await fs.rename(tmp, target);
  }

  /** Read-modify-write under the project lock; every change bumps `updatedAt` (`fn` may override it). */
  private async mutate<T>(fn: (m: Manifest, obsolete: string[]) => T | Promise<T>): Promise<T> {
    const obsolete: string[] = [];
    const result = await lock(this.lockKey, async () => {
      const m = await this.load();
      m.meta.updatedAt = new Date().toISOString();
      const r = await fn(m, obsolete);
      await this.save(m);
      return r;
    });
    // Old file versions go only after the new manifest is in place. A leftover is cleaned up by gc().
    await Promise.all(obsolete.map((b) => fs.rm(this.blobPath(b), { force: true }).catch(() => {})));
    return result;
  }

  async meta(): Promise<StoredMeta & { id: string }> {
    return { ...(await this.load()).meta, id: this.id };
  }

  /** Metadata plus every entry, sorted by path. */
  async snapshot(): Promise<{ meta: StoredMeta & { id: string }; entries: [string, Entry][] }> {
    const m = await this.load();
    const entries = Object.entries(m.entries).sort(([a], [b]) => a.localeCompare(b));
    return { meta: { ...m.meta, id: this.id }, entries };
  }

  updateMeta(fn: (meta: StoredMeta) => void): Promise<StoredMeta & { id: string }> {
    return this.mutate((m) => {
      fn(m.meta);
      return { ...m.meta, id: this.id };
    });
  }

  // ---- Files -------------------------------------------------------------

  private blobPath(blob: string): string {
    return path.join(this.dir, 'blobs', blob);
  }

  private async readBlob(blob: string): Promise<Buffer> {
    return open(this.key, await fs.readFile(this.blobPath(blob)), `${this.id}|blob|${blob}`);
  }

  private async writeBlob(data: Buffer): Promise<string> {
    const blob = crypto.randomBytes(16).toString('hex');
    await writeDurably(this.blobPath(blob), seal(this.key, data, `${this.id}|blob|${blob}`));
    return blob;
  }

  async read(relPath: string): Promise<Buffer> {
    const rel = cleanPath(relPath);
    for (let attempt = 0; ; attempt++) {
      const entry = (await this.load()).entries[rel];
      if (entry?.type !== 'file') throw new HttpError(404, 'File not found');
      try {
        return await this.readBlob(entry.blob);
      } catch (err) {
        // A concurrent write replaced the blob after we read the manifest: look again.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || attempt > 0) throw err;
      }
    }
  }

  write(relPath: string, data: Buffer): Promise<string[]> {
    return this.writeMany([[relPath, data]]);
  }

  /** Write several files with one manifest update. Returns the cleaned paths. */
  async writeMany(files: Iterable<[string, Buffer]> | AsyncIterable<[string, Buffer]>): Promise<string[]> {
    const created: string[] = [];
    try {
      return await this.mutate(async (m, obsolete) => {
        const written: string[] = [];
        for await (const [relPath, data] of files) {
          const rel = cleanPath(relPath);
          const existing = m.entries[rel];
          if (existing?.type === 'dir') throw new HttpError(409, `${rel} is a folder`);
          ensureParents(m, rel);
          const blob = await this.writeBlob(data);
          created.push(blob);
          if (existing?.type === 'file') obsolete.push(existing.blob);
          m.entries[rel] = { type: 'file', blob, size: data.length, mtime: Date.now() };
          written.push(rel);
        }
        return written;
      });
    } catch (err) {
      await Promise.all(created.map((b) => fs.rm(this.blobPath(b), { force: true })));
      throw err;
    }
  }

  mkdir(relPath: string): Promise<string> {
    const rel = cleanPath(relPath);
    return this.mutate((m) => {
      if (m.entries[rel]?.type === 'file') throw new HttpError(409, `${rel} is a file`);
      ensureParents(m, rel);
      m.entries[rel] = { type: 'dir' };
      return rel;
    });
  }

  /** Delete a file, or a folder and everything in it. */
  remove(relPath: string): Promise<void> {
    const rel = cleanPath(relPath);
    return this.mutate((m, obsolete) => {
      if (!m.entries[rel]) throw new HttpError(404, 'File not found');
      for (const [p, e] of Object.entries(m.entries)) {
        if (!isUnder(p, rel)) continue;
        if (e.type === 'file') obsolete.push(e.blob);
        delete m.entries[p];
      }
    });
  }

  /** Rename or move a file or folder; the main file follows if it moved. */
  rename(fromPath: string, toPath: string): Promise<string> {
    const from = cleanPath(fromPath);
    const to = cleanPath(toPath);
    return this.mutate((m) => {
      if (to === from) return to;
      if (to.startsWith(`${from}/`)) throw new HttpError(400, 'Cannot move a folder into itself');
      if (!m.entries[from]) throw new HttpError(404, `${from} not found`);
      if (m.entries[to]) throw new HttpError(409, `${to} already exists`);
      ensureParents(m, to);
      for (const [p, e] of Object.entries(m.entries)) {
        if (!isUnder(p, from)) continue;
        delete m.entries[p];
        m.entries[to + p.slice(from.length)] = e;
      }
      if (isUnder(m.meta.mainFile, from)) m.meta.mainFile = to + m.meta.mainFile.slice(from.length);
      return to;
    });
  }

  /** Remove blobs left behind by a crash between writing a blob and saving the manifest. */
  async gc(): Promise<void> {
    await lock(this.lockKey, async () => {
      const m = await this.load();
      const used = new Set(Object.values(m.entries).flatMap((e) => (e.type === 'file' ? [e.blob] : [])));
      const blobs = await fs.readdir(path.join(this.dir, 'blobs')).catch(() => []);
      await Promise.all(blobs.filter((b) => !used.has(b)).map((b) => fs.rm(this.blobPath(b), { force: true })));
      const leftovers = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.tmp'));
      await Promise.all(leftovers.map((f) => fs.rm(path.join(this.dir, f), { force: true })));
    });
  }

  async destroy(): Promise<void> {
    await lock(this.lockKey, () => fs.rm(this.dir, { recursive: true, force: true }));
  }
}

function ensureParents(m: Manifest, rel: string): void {
  for (const p of parents(rel)) {
    if (m.entries[p]?.type === 'file') throw new HttpError(409, `${p} is a file`);
    m.entries[p] = { type: 'dir' };
  }
}

async function writeDurably(file: string, data: Buffer): Promise<void> {
  const fh = await fs.open(file, 'wx', 0o600);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Every project in the user's own folder, newest first. Unreadable ones are skipped. */
export async function listUserProjects(user: SessionUser): Promise<(StoredMeta & { id: string })[]> {
  const entries = await fs.readdir(userDir(user.id), { withFileTypes: true }).catch(() => []);
  const metas = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && UUID_RE.test(e.name))
      .map((e) =>
        ProjectStore.open(user, e.name)
          .then((s) => s.meta())
          .catch((err) => {
            console.error(`Skipping project ${e.name}:`, (err as Error).message);
            return null;
          }),
      ),
  );
  return metas
    .filter((m) => m !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
