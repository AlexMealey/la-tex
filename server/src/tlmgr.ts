import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';

export interface Job {
  id: string;
  action: 'install' | 'remove';
  names: string[];
  status: 'queued' | 'running' | 'success' | 'error';
  log: string;
  createdAt: number;
  finishedAt?: number;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const MAX_JOBS = 20;
const MAX_LOG = 1_000_000;
const MANIFEST = path.join(config.texmfUserDir, 'packages.json');

const jobs = new Map<string, Job>();
let queue: Promise<void> = Promise.resolve();

/** Queue a tlmgr user-mode job. Jobs run one at a time; poll `getJob` for progress. */
export function startJob(action: Job['action'], names: string[]): Job {
  if (!names.length) throw new HttpError(400, 'No packages given');
  for (const n of names) if (!NAME_RE.test(n)) throw new HttpError(400, `Invalid package name: ${n}`);

  const job: Job = { id: crypto.randomUUID(), action, names, status: 'queued', log: '', createdAt: Date.now() };
  jobs.set(job.id, job);
  for (const old of [...jobs.keys()].slice(0, Math.max(0, jobs.size - MAX_JOBS))) jobs.delete(old);
  queue = queue.then(() => runJob(job));
  return job;
}

export function getJob(id: string): Job {
  const job = jobs.get(id);
  if (!job) throw new HttpError(404, 'Job not found');
  return job;
}

async function runJob(job: Job): Promise<void> {
  job.status = 'running';
  const append = (text: string) => {
    if (job.log.length < MAX_LOG) job.log += text;
  };
  try {
    if (!(await exists(path.join(config.texmfHome, 'tlpkg/texlive.tlpdb')))) {
      append(`$ tlmgr init-usertree\n`);
      if ((await tlmgr(['init-usertree'], append)) !== 0) throw new Error('Could not create the user package tree');
    }
    // In user mode tlmgr also runs updmap-user / mktexlsr for font packages.
    const args = ['--usermode', '--repository', config.tlRepo, job.action, ...job.names];
    append(`$ tlmgr ${args.join(' ')}\n`);
    const code = await tlmgr(args, append);
    if (code !== 0) throw new Error(`tlmgr exited with code ${code}`);
    await updateManifest(job.action, job.names);
    job.status = 'success';
  } catch (err) {
    append(`\n${(err as Error).message}\n`);
    job.status = 'error';
  } finally {
    job.finishedAt = Date.now();
  }
}

function tlmgr(args: string[], onOutput: (text: string) => void): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('tlmgr', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (c: Buffer) => onOutput(c.toString()));
    child.stderr.on('data', (c: Buffer) => onOutput(c.toString()));
    child.on('error', (err) => {
      onOutput(`${err.message}\n`);
      resolve(null);
    });
    child.on('close', resolve);
  });
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(() => true, () => false);
}

/** Packages the user asked for, kept across TeX Live releases so they can be reinstalled. */
export async function readManifest(): Promise<string[]> {
  return fs
    .readFile(MANIFEST, 'utf8')
    .then((raw) => (JSON.parse(raw) as { packages?: string[] }).packages ?? [], () => []);
}

async function updateManifest(action: Job['action'], names: string[]): Promise<void> {
  const current = new Set(await readManifest());
  for (const n of names) {
    if (action === 'install') current.add(n);
    else current.delete(n);
  }
  await fs.writeFile(MANIFEST, JSON.stringify({ packages: [...current].sort() }, null, 2));
}
