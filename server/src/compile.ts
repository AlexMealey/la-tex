import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';
import { parseLog, type LogEntry } from './logParser.js';
import { safeJoin } from './paths.js';
import { buildDir, getProject, listFiles, projectDir, type Engine } from './projects.js';

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

const SYNC_MANIFEST = '.synced-files.json';
const running = new Set<string>();

export async function compileProject(id: string): Promise<CompileResult> {
  const meta = await getProject(id);
  if (running.has(id)) throw new HttpError(409, 'A compile is already running for this project');
  running.add(id);
  const started = Date.now();
  try {
    const build = buildDir(id);
    await fs.mkdir(build, { recursive: true });
    await syncProject(projectDir(id), build);

    const main = await fs.stat(safeJoin(build, meta.mainFile)).catch(() => null);
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
    const run = await runLatexmk(args, build, config.compileTimeoutMs);

    const log = await fs.readFile(path.join(build, 'output.log'), 'utf8').catch(() => run.output);
    const parsed = parseLog(log, build);
    if (!run.timedOut && run.code !== 0 && parsed.errors.length === 0) {
      parsed.errors.push({
        level: 'error',
        file: null,
        line: null,
        message: `latexmk exited with code ${run.code}\n${run.output.slice(-2000)}`,
      });
    }
    const pdf = await fs.stat(path.join(build, 'output.pdf')).then(() => true, () => false);
    return {
      status: run.timedOut ? 'timeout' : parsed.errors.length ? 'error' : 'success',
      durationMs: Date.now() - started,
      ...parsed,
      pdf,
      compiledAt: Date.now(),
    };
  } finally {
    running.delete(id);
  }
}

/**
 * Copy changed project files into the persistent build folder, keeping latexmk's aux files.
 * Files deleted from the project since the last sync are removed from the build folder too.
 */
async function syncProject(src: string, dst: string): Promise<void> {
  const files = (await listFiles(src)).filter((f) => f.type === 'file').map((f) => f.path);
  const previous: string[] = await fs
    .readFile(path.join(dst, SYNC_MANIFEST), 'utf8')
    .then((raw) => JSON.parse(raw), () => []);
  const current = new Set(files);
  for (const rel of previous) {
    if (!current.has(rel)) await fs.rm(safeJoin(dst, rel), { force: true });
  }
  for (const rel of files) {
    const from = path.join(src, rel);
    const to = path.join(dst, rel);
    const [a, b] = await Promise.all([fs.stat(from), fs.stat(to).catch(() => null)]);
    if (b && b.size === a.size && Math.trunc(b.mtimeMs) === Math.trunc(a.mtimeMs)) continue;
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    await fs.utimes(to, a.atime, a.mtime);
  }
  await fs.writeFile(path.join(dst, SYNC_MANIFEST), JSON.stringify(files));
}

interface RunResult {
  code: number | null;
  timedOut: boolean;
  output: string;
}

function runLatexmk(args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('latexmk', args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Stop TeX hard-wrapping log lines at 79 columns so messages parse cleanly.
      env: { ...process.env, max_print_line: '10000', error_line: '254', half_error_line: '238' },
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
