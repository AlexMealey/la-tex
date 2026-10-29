import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionUser } from './auth.js';
import { config } from './config.js';
import { HttpError } from './http.js';
import { createLimiter } from './limit.js';
import { parseLog, type LogEntry } from './logParser.js';
import { safeJoin } from './paths.js';
import type { Engine } from './projects.js';
import { ProjectStore, type Entry } from './storage.js';

export interface CompileResult {
  status: 'success' | 'error' | 'timeout';
  durationMs: number;
  errors: LogEntry[];
  warnings: LogEntry[];
  missingFiles: string[];
  /** Whether output.pdf exists after this run (with -f it may exist despite errors). */
  pdf: boolean;
  compiledAt: number;
}

const ENGINE_FLAGS: Record<Engine, string> = {
  pdflatex: '-pdf',
  xelatex: '-xelatex',
  lualatex: '-lualatex',
};

/**
 * Decrypted sources, aux files and output.pdf for one project, in a randomly named folder under
 * BUILDS_DIR (a tmpfs in Docker, so plaintext never reaches the disk). Dropped on logout, on
 * "Clear cache", after an hour unused, and at startup.
 */
interface Build {
  dir: string;
  /** Project path → blob id last decrypted into `dir`. */
  synced: Map<string, string>;
  lastUsed: number;
}

const BUILD_IDLE_MS = 60 * 60_000;
const builds = new Map<string, Build>();
let sandboxed = false;
const running = new Set<string>();
const compileLimit = createLimiter(config.compileConcurrency);

const buildKey = (userId: string, projectId: string) => `${userId}/${projectId}`;

/** Empty BUILDS_DIR, then make it unlistable (write + search only) so a TeX run can't find other builds. */
export async function initBuildsDir(): Promise<void> {
  await fs.mkdir(config.buildsDir, { recursive: true });
  await fs.chmod(config.buildsDir, 0o700);
  for (const name of await fs.readdir(config.buildsDir)) {
    await fs.rm(path.join(config.buildsDir, name), { recursive: true, force: true });
  }
  await fs.chmod(config.buildsDir, 0o300);
}

// Landlock access rights, as named by util-linux setpriv.
const READ = 'execute,read-file,read-dir';
const WRITE = `${READ},write-file,remove-dir,remove-file,make-dir,make-reg,make-sym,refer,truncate`;

/**
 * A compile may read the system and TeX Live, write TeX's caches and its own build folder, and
 * nothing else: not app.db, not the encrypted projects, not other users' build folders. Enforced
 * by the kernel (Landlock) through setpriv. TeX's own openin_any setting no longer restricts
 * reading as of TeX Live 2026.
 */
function sandboxArgs(buildDir: string): string[] {
  const rules: [string, string | undefined][] = [
    [READ, '/usr'],
    [READ, '/etc'],
    [READ, config.tlRoot],
    [READ, config.texmfUserDir],
    [READ, config.texmfHome],
    [WRITE, process.env.TEXMFVAR],
    [WRITE, process.env.TEXMFCONFIG],
    ['read-file,write-file', '/dev'],
    [WRITE, buildDir],
  ];
  const args = ['--landlock-access', 'fs'];
  for (const [access, dir] of rules) {
    if (dir && existsSync(dir)) args.push('--landlock-rule', `path-beneath:${access}:${dir}`);
  }
  return [...args, '--'];
}

/** Use the sandbox when the kernel and setpriv support it, and say so either way. */
export async function initSandbox(): Promise<void> {
  sandboxed = await new Promise<boolean>((resolve) => {
    const child = spawn('setpriv', [...sandboxArgs(config.buildsDir), 'true'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
  if (sandboxed) {
    console.log('Compile sandbox: on (Landlock)');
  } else {
    console.warn(
      'WARNING: compile sandbox unavailable (needs a Linux kernel with Landlock and util-linux setpriv 2.40+). ' +
        'TeX documents can read any file this server can, including app.db.',
    );
  }
}

export function startBuildSweeper(): void {
  setInterval(() => {
    const cutoff = Date.now() - BUILD_IDLE_MS;
    for (const [key, build] of builds) {
      if (build.lastUsed >= cutoff || running.has(key)) continue;
      builds.delete(key);
      fs.rm(build.dir, { recursive: true, force: true }).catch((err) => console.error(err));
    }
  }, 5 * 60_000).unref();
}

/** Delete one project's build folder, or all of a user's. */
export async function wipeBuild(userId: string, projectId?: string): Promise<void> {
  const keys = projectId
    ? [buildKey(userId, projectId)]
    : [...builds.keys()].filter((k) => k.startsWith(`${userId}/`));
  await Promise.all(
    keys.map(async (key) => {
      const build = builds.get(key);
      builds.delete(key);
      if (build) await fs.rm(build.dir, { recursive: true, force: true });
    }),
  );
}

/** Path to output.pdf or output.log from the last compile, or null if there is no build. */
export function buildOutput(userId: string, projectId: string, file: 'output.pdf' | 'output.log'): string | null {
  const build = builds.get(buildKey(userId, projectId));
  if (!build) return null;
  build.lastUsed = Date.now();
  return path.join(build.dir, file);
}

export async function compileProject(user: SessionUser, id: string): Promise<CompileResult> {
  const store = await ProjectStore.open(user, id);
  const key = buildKey(user.id, id);
  if (running.has(key)) throw new HttpError(409, 'A compile is already running for this project');
  running.add(key);
  try {
    return await compileLimit(async () => {
      const started = Date.now();
      const { meta, entries } = await store.snapshot();
      let build = builds.get(key);
      if (!build) {
        build = { dir: path.join(config.buildsDir, crypto.randomBytes(16).toString('hex')), synced: new Map(), lastUsed: 0 };
        builds.set(key, build);
      }
      build.lastUsed = Date.now();
      await fs.mkdir(build.dir, { recursive: true, mode: 0o700 });
      await syncFromStore(store, entries, build);

      const main = await fs.stat(safeJoin(build.dir, meta.mainFile)).catch(() => null);
      if (!main?.isFile()) throw new HttpError(400, `Main file "${meta.mainFile}" does not exist`);

      // -norc: a project latexmkrc is Perl code, so it is never read.
      // -g: always run, even with unchanged sources (e.g. a just-installed package fixes a failed run).
      const args = [
        '-norc',
        ENGINE_FLAGS[meta.engine],
        '-g',
        '-f',
        '-interaction=nonstopmode',
        '-file-line-error',
        '-synctex=0',
        '-jobname=output',
        meta.mainFile,
      ];
      const run = await runLatexmk(args, build.dir, config.compileTimeoutMs, texEnv());
      build.lastUsed = Date.now();

      const log = await fs.readFile(path.join(build.dir, 'output.log'), 'utf8').catch(() => run.output);
      const parsed = parseLog(log, build.dir);
      if (!run.timedOut && run.code !== 0 && parsed.errors.length === 0) {
        parsed.errors.push({
          level: 'error',
          file: null,
          line: null,
          message: `latexmk exited with code ${run.code}\n${run.output.slice(-2000)}`,
        });
      }
      const pdf = await fs.stat(path.join(build.dir, 'output.pdf')).then(() => true, () => false);
      return {
        status: run.timedOut ? 'timeout' : parsed.errors.length ? 'error' : 'success',
        durationMs: Date.now() - started,
        ...parsed,
        pdf,
        compiledAt: Date.now(),
      };
    });
  } finally {
    running.delete(key);
  }
}

/**
 * Decrypt changed project files into the build folder, keeping latexmk's aux files.
 * Every write makes a new blob, so a changed blob id means changed content.
 * Files deleted from the project since the last sync are removed from the build folder too.
 */
async function syncFromStore(store: ProjectStore, entries: [string, Entry][], build: Build): Promise<void> {
  const current = new Map<string, string>();
  for (const [p, e] of entries) if (e.type === 'file') current.set(p, e.blob);
  for (const rel of [...build.synced.keys()]) {
    if (current.has(rel)) continue;
    await fs.rm(safeJoin(build.dir, rel), { force: true });
    build.synced.delete(rel);
  }
  for (const [rel, blob] of current) {
    if (build.synced.get(rel) === blob) continue;
    const to = safeJoin(build.dir, rel);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.writeFile(to, await store.read(rel));
    build.synced.set(rel, blob);
  }
}

// Only what TeX needs: nothing else from the server's environment reaches a document.
const ENV_KEEP = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TEXMFHOME', 'TEXMFVAR', 'TEXMFCONFIG', 'SOURCE_DATE_EPOCH'];

function texEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENV_KEEP) if (process.env[name] !== undefined) env[name] = process.env[name];
  return {
    ...env,
    // Stop TeX hard-wrapping log lines at 79 columns so messages parse cleanly.
    max_print_line: '10000',
    error_line: '254',
    half_error_line: '238',
    // No writing to absolute paths, ".." or dot files (reading is limited by the sandbox instead).
    openout_any: 'p',
  };
}

interface RunResult {
  code: number | null;
  timedOut: boolean;
  output: string;
}

function runLatexmk(args: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const [command, argv] = sandboxed ? ['setpriv', [...sandboxArgs(cwd), 'latexmk', ...args]] : ['latexmk', args];
    const child = spawn(command, argv, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let output = '';
    const append = (chunk: Buffer) => {
      if (output.length < 1_000_000) output += chunk.toString();
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      reject(missing ? new HttpError(500, 'latexmk not found — is TeX Live installed?') : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, output });
    });
  });
}
