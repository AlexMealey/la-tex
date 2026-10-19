import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';
import { META_FILE, cleanRelPath } from './paths.js';

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

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function projectDir(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(404, 'Project not found');
  return path.join(config.projectsDir, id);
}

export function buildDir(id: string): string {
  projectDir(id);
  return path.join(config.buildsDir, id);
}

export async function getProject(id: string): Promise<ProjectMeta> {
  try {
    const raw = await fs.readFile(path.join(projectDir(id), META_FILE), 'utf8');
    return { ...JSON.parse(raw), id };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Project not found');
    throw err;
  }
}

async function writeMeta(meta: ProjectMeta): Promise<void> {
  const { id, ...rest } = meta;
  await fs.writeFile(path.join(projectDir(id), META_FILE), JSON.stringify(rest, null, 2));
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const entries = await fs.readdir(config.projectsDir, { withFileTypes: true });
  const metas = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && ID_RE.test(e.name))
      .map((e) => getProject(e.name).catch(() => null)),
  );
  return metas
    .filter((m): m is ProjectMeta => m !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function newId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'project'}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function createProject(name: string, template?: TemplateId): Promise<ProjectMeta> {
  const trimmed = name.trim() || 'Untitled';
  const id = newId(trimmed);
  const dir = projectDir(id);
  await fs.mkdir(dir, { recursive: true });
  if (template) await fs.cp(path.join(config.templatesDir, template), dir, { recursive: true });
  const now = new Date().toISOString();
  const meta: ProjectMeta = {
    id,
    name: trimmed,
    engine: 'pdflatex',
    mainFile: 'main.tex',
    createdAt: now,
    updatedAt: now,
  };
  await writeMeta(meta);
  return meta;
}

export async function updateProject(
  id: string,
  patch: { name?: unknown; engine?: unknown; mainFile?: unknown },
): Promise<ProjectMeta> {
  const meta = await getProject(id);
  if (patch.name !== undefined) meta.name = String(patch.name).trim() || meta.name;
  if (patch.engine !== undefined) {
    if (!ENGINES.includes(patch.engine as Engine)) throw new HttpError(400, 'Unknown engine');
    meta.engine = patch.engine as Engine;
  }
  if (patch.mainFile !== undefined) meta.mainFile = cleanRelPath(projectDir(id), String(patch.mainFile));
  meta.updatedAt = new Date().toISOString();
  await writeMeta(meta);
  return meta;
}

export async function touchProject(id: string): Promise<void> {
  const meta = await getProject(id);
  meta.updatedAt = new Date().toISOString();
  await writeMeta(meta);
}

export async function deleteProject(id: string): Promise<void> {
  await getProject(id);
  await fs.rm(projectDir(id), { recursive: true, force: true });
  await fs.rm(buildDir(id), { recursive: true, force: true });
}

/** All files and folders under `root`, as sorted project-relative paths. Symlinks are skipped. */
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
