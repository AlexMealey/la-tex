import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionUser } from './auth.js';
import { wipeBuild } from './compile.js';
import { config } from './config.js';
import { HttpError } from './http.js';
import { META_FILE } from './paths.js';
import { ProjectStore, cleanPath, listUserProjects, type Entry } from './storage.js';

export const ENGINES = ['pdflatex', 'xelatex', 'lualatex'] as const;
export type Engine = (typeof ENGINES)[number];

export const TEMPLATES = ['blank-a4', 'resume-a4'] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export interface ProjectMeta {
  id: string;
  name: string;
  engine: Engine;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileEntry {
  path: string;
  type: 'file' | 'dir';
  size: number;
  editable: boolean;
}

const TEXT_EXTENSIONS = new Set([
  'tex', 'ltx', 'sty', 'cls', 'clo', 'bib', 'bst', 'bbx', 'cbx', 'lbx', 'dbx', 'def', 'cfg', 'fd',
  'dtx', 'ins', 'bbl', 'tikz', 'pgf', 'lua', 'txt', 'md', 'csv', 'tsv', 'dat', 'json', 'xml',
  'yaml', 'yml', 'sh', 'py', 'r', 'gp', 'asy', 'mp', 'svg', 'latexmkrc',
]);
const TEXT_NAMES = new Set(['latexmkrc', '.latexmkrc', 'makefile', 'readme', 'license']);

export function isEditable(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  if (TEXT_NAMES.has(base)) return true;
  return TEXT_EXTENSIONS.has(path.extname(base).slice(1));
}

export function listProjects(user: SessionUser): Promise<ProjectMeta[]> {
  return listUserProjects(user);
}

export async function getProject(user: SessionUser, id: string): Promise<ProjectMeta & { files: FileEntry[] }> {
  const store = await ProjectStore.open(user, id);
  await store.gc();
  const { meta, entries } = await store.snapshot();
  return { ...meta, files: toFileEntries(entries) };
}

function toFileEntries(entries: [string, Entry][]): FileEntry[] {
  return entries.map(([p, e]) =>
    e.type === 'dir'
      ? { path: p, type: 'dir', size: 0, editable: false }
      : { path: p, type: 'file', size: e.size, editable: isEditable(p) },
  );
}

export async function createProject(user: SessionUser, name: string, template?: TemplateId): Promise<ProjectMeta> {
  const now = new Date().toISOString();
  const store = await ProjectStore.create(user, {
    name: name.trim() || 'Untitled',
    engine: 'pdflatex',
    mainFile: 'main.tex',
    createdAt: now,
    updatedAt: now,
  });
  if (template) await store.writeMany(readDiskFiles(path.join(config.templatesDir, template)));
  return store.meta();
}

export async function updateProject(
  user: SessionUser,
  id: string,
  patch: { name?: unknown; engine?: unknown; mainFile?: unknown },
): Promise<ProjectMeta> {
  const store = await ProjectStore.open(user, id);
  if (patch.engine !== undefined && !ENGINES.includes(patch.engine as Engine)) {
    throw new HttpError(400, 'Unknown engine');
  }
  const mainFile = patch.mainFile !== undefined ? cleanPath(String(patch.mainFile)) : undefined;
  return store.updateMeta((meta) => {
    if (patch.name !== undefined) meta.name = String(patch.name).trim() || meta.name;
    if (patch.engine !== undefined) meta.engine = patch.engine as Engine;
    if (mainFile !== undefined) meta.mainFile = mainFile;
  });
}

export async function deleteProject(user: SessionUser, id: string): Promise<void> {
  const store = await ProjectStore.open(user, id);
  await store.destroy();
  await wipeBuild(user.id, id);
}

/** Files under a folder on disk as [path, content] pairs, read one at a time. */
export async function* readDiskFiles(root: string): AsyncGenerator<[string, Buffer]> {
  for (const f of await listFiles(root)) {
    if (f.type === 'file') yield [f.path, await fs.readFile(path.join(root, f.path))];
  }
}

/** All files and folders under `root` on disk, as sorted relative paths. Symlinks are skipped. */
export async function listFiles(root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (p === META_FILE) continue;
      if (e.isDirectory()) {
        out.push({ path: p, type: 'dir', size: 0, editable: false });
        await walk(p);
      } else if (e.isFile()) {
        const st = await fs.stat(path.join(root, p));
        out.push({ path: p, type: 'file', size: st.size, editable: isEditable(p) });
      }
    }
  }
  await walk('');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
