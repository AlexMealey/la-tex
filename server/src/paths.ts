import path from 'node:path';
import { HttpError } from './http.js';

/** Per-project metadata, kept inside the project folder but hidden from the editor. */
export const META_FILE = '.editor.json';

/** Resolve `rel` inside `root`, rejecting anything that escapes it. */
export function safeJoin(root: string, rel: string | string[]): string {
  const relPath = Array.isArray(rel) ? rel.join('/') : rel;
  if (relPath.includes('\0')) throw new HttpError(400, 'Invalid path');
  const base = path.resolve(root);
  const resolved = path.resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new HttpError(400, `Path escapes project: ${relPath}`);
  }
  return resolved;
}

/** Normalise a user-supplied project path to `a/b/c` form, rejecting the root and reserved names. */
export function cleanRelPath(root: string, rel: string | string[]): string {
  const abs = safeJoin(root, rel);
  const out = path.relative(path.resolve(root), abs).split(path.sep).join('/');
  if (!out) throw new HttpError(400, 'Path is empty');
  if (out === META_FILE) throw new HttpError(403, 'Reserved file name');
  return out;
}
