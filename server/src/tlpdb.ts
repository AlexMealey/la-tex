import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';

export interface TlPackage {
  name: string;
  shortdesc: string;
  category: string;
  installable: boolean;
  /** Why a package cannot be installed at runtime. */
  reason?: string;
}

export type PackageStatus = 'base' | 'user' | 'available';
export interface PackageView extends TlPackage {
  status: PackageStatus;
}

interface RawPackage {
  name: string;
  shortdesc: string;
  category: string;
  depends: string[];
  runfiles: string[];
  hasBinfiles: boolean;
}

interface PackageIndex {
  packages: TlPackage[];
  byName: Map<string, TlPackage>;
  /** File basename → packages shipping it. */
  files: Map<string, string[]>;
}

/** Only files that typically show up as "not found" in a log are indexed. */
const INDEX_EXTS = new Set([
  'sty', 'cls', 'clo', 'tfm', 'vf', 'fd', 'def', 'cfg', 'ldf', 'bst', 'bbx', 'cbx', 'lbx', 'dbx',
  'tex', 'otf', 'ttf', 'pfb', 'map', 'enc', 'lua',
]);

/** Parse a texlive.tlpdb: blank-line separated stanzas of `key value`, file lists indented by a space. */
export function parseTlpdb(text: string, withFiles: boolean): RawPackage[] {
  const pkgs: RawPackage[] = [];
  let cur: RawPackage | null = null;
  let section: string | null = null;
  for (const line of text.split('\n')) {
    if (line === '') {
      if (cur) pkgs.push(cur);
      cur = null;
      continue;
    }
    if (line.startsWith(' ')) {
      if (cur && withFiles && section === 'runfiles') cur.runfiles.push(line.trim().split(' ')[0]);
      continue;
    }
    const sp = line.indexOf(' ');
    const key = sp < 0 ? line : line.slice(0, sp);
    const value = sp < 0 ? '' : line.slice(sp + 1);
    if (key === 'name') {
      if (cur) pkgs.push(cur);
      cur = { name: value, shortdesc: '', category: '', depends: [], runfiles: [], hasBinfiles: false };
      section = null;
      continue;
    }
    if (!cur) continue;
    section = key;
    if (key === 'shortdesc') cur.shortdesc = value;
    else if (key === 'category') cur.category = value;
    else if (key === 'depend') cur.depends.push(value);
    else if (key === 'binfiles') cur.hasBinfiles = true;
  }
  if (cur) pkgs.push(cur);
  return pkgs;
}

/** tlmgr --usermode only handles relocatable, executable-free packages. */
function installability(p: RawPackage): Pick<TlPackage, 'installable' | 'reason'> {
  const rebuild = 'add it to docker/tl-packages.txt and rebuild the image';
  if (p.category === 'Collection' || p.category === 'Scheme') {
    return { installable: false, reason: 'Collections are too large to install here; install the individual packages you need' };
  }
  if (p.category === 'TLCore') return { installable: false, reason: `Part of the TeX Live core — ${rebuild}` };
  if (p.name.startsWith('hyphen-')) return { installable: false, reason: `Hyphenation patterns need a system install — ${rebuild}` };
  if (p.hasBinfiles || p.depends.some((d) => d.endsWith('.ARCH'))) {
    return { installable: false, reason: `Contains programs — ${rebuild}` };
  }
  return { installable: true };
}

let indexPromise: Promise<PackageIndex> | null = null;

/** The remote package index, downloaded once per repository and cached on the host mount. */
export function getIndex(): Promise<PackageIndex> {
  indexPromise ??= loadIndex().catch((err) => {
    indexPromise = null;
    throw err;
  });
  return indexPromise;
}

async function loadIndex(): Promise<PackageIndex> {
  const hash = crypto.createHash('sha1').update(config.tlRepo).digest('hex').slice(0, 12);
  const cacheFile = path.join(config.texmfUserDir, 'cache', `tlpdb-${hash}.json`);
  type Cached = { packages: TlPackage[]; files: Record<string, string[]> };
  let data: Cached | null = await fs
    .readFile(cacheFile, 'utf8')
    .then((raw) => JSON.parse(raw) as Cached, () => null);

  if (!data) {
    const raw = parseTlpdb(await downloadTlpdb(), true).filter(
      (p) => !p.name.includes('.') && !p.name.startsWith('00texlive'),
    );
    const files: Record<string, string[]> = {};
    for (const p of raw) {
      for (const f of p.runfiles) {
        const base = f.slice(f.lastIndexOf('/') + 1);
        if (!INDEX_EXTS.has(base.slice(base.lastIndexOf('.') + 1).toLowerCase())) continue;
        const list = (files[base] ??= []);
        if (!list.includes(p.name)) list.push(p.name);
      }
    }
    data = {
      packages: raw.map((p) => ({ name: p.name, shortdesc: p.shortdesc, category: p.category, ...installability(p) })),
      files,
    };
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(data));
  }

  return {
    packages: data.packages,
    byName: new Map(data.packages.map((p) => [p.name, p])),
    files: new Map(Object.entries(data.files)),
  };
}

/**
 * `wget -qO- url | xz -dc`. Downloads with wget, as tlmgr does: the snapshot server's bot
 * protection answers other HTTP clients (including Node's fetch) with an HTML challenge page.
 */
async function downloadTlpdb(): Promise<string> {
  const url = `${config.tlRepo}/tlpkg/texlive.tlpdb.xz`;
  const wget = spawn('wget', ['-qO-', url], { stdio: ['ignore', 'pipe', 'inherit'] });
  const xz = spawn('xz', ['-dc'], { stdio: ['pipe', 'pipe', 'inherit'] });
  wget.stdout.pipe(xz.stdin);
  const chunks: Buffer[] = [];
  xz.stdout.on('data', (c: Buffer) => chunks.push(c));
  const exit = (child: ChildProcess) =>
    new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
  const [wgetCode, xzCode] = await Promise.all([exit(wget), exit(xz)]);
  if (wgetCode !== 0) throw new Error(`Could not download the package index from ${url} (wget exit ${wgetCode})`);
  if (xzCode !== 0) throw new Error(`The package index from ${url} is not a valid .xz file`);
  return Buffer.concat(chunks).toString('utf8');
}

let baseInstalled: Set<string> | null = null;

async function readTlpdbNames(file: string): Promise<RawPackage[]> {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  return parseTlpdb(text, false).filter((p) => !p.name.startsWith('00texlive'));
}

async function installedSets(): Promise<{ base: Set<string>; user: RawPackage[] }> {
  baseInstalled ??= new Set((await readTlpdbNames(path.join(config.tlRoot, 'tlpkg/texlive.tlpdb'))).map((p) => p.name));
  const user = await readTlpdbNames(path.join(config.texmfHome, 'tlpkg/texlive.tlpdb'));
  return { base: baseInstalled, user };
}

function withStatus(pkgs: TlPackage[], base: Set<string>, user: Set<string>): PackageView[] {
  return pkgs.map((p) => ({
    ...p,
    status: base.has(p.name) ? 'base' : user.has(p.name) ? 'user' : 'available',
  }));
}

export async function searchPackages(q: string, limit = 100): Promise<PackageView[]> {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const [idx, installed] = await Promise.all([getIndex(), installedSets()]);
  const scored: { p: TlPackage; score: number }[] = [];
  for (const p of idx.packages) {
    const name = p.name.toLowerCase();
    const score =
      name === query ? 0
      : name.startsWith(query) ? 1
      : name.includes(query) ? 2
      : p.shortdesc.toLowerCase().includes(query) ? 3
      : -1;
    if (score >= 0) scored.push({ p, score });
  }
  scored.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name));
  const userNames = new Set(installed.user.map((p) => p.name));
  return withStatus(scored.slice(0, limit).map((s) => s.p), installed.base, userNames);
}

/** Packages that ship a file the log reported as missing, e.g. `lipsum.sty`. */
export async function packagesForFile(file: string): Promise<PackageView[]> {
  const base = path.basename(file.trim());
  if (!base) return [];
  const [idx, installed] = await Promise.all([getIndex(), installedSets()]);
  let names = idx.files.get(base) ?? [];
  const nonDev = names.filter((n) => !n.endsWith('-dev'));
  if (nonDev.length) names = nonDev;
  const pkgs = names.map((n) => idx.byName.get(n)).filter((p): p is TlPackage => p !== undefined);
  return withStatus(pkgs, installed.base, new Set(installed.user.map((p) => p.name)));
}

/** Packages installed into the user tree on the host mount. */
export async function userPackages(): Promise<PackageView[]> {
  const { user } = await installedSets();
  return user
    .filter((p) => !p.name.includes('.'))
    .map((p) => ({ name: p.name, shortdesc: p.shortdesc, category: p.category, installable: true, status: 'user' as const }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Reject packages the index knows cannot be installed in user mode. */
export async function assertInstallable(names: string[]): Promise<void> {
  const idx = await getIndex();
  for (const name of names) {
    const p = idx.byName.get(name);
    if (!p) throw new HttpError(400, `Unknown package: ${name}`);
    if (!p.installable) throw new HttpError(400, `${name}: ${p.reason}`);
  }
}
