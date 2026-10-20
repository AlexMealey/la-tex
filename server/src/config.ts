import path from 'node:path';

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR ?? '/data');

/** Express `trust proxy`: "true"/"false", a hop count, or names/subnets such as "loopback". */
function trustProxy(value: string | undefined): boolean | number | string {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

export const config = {
  port: Number(env.PORT ?? 8080),
  dataDir,
  /** Encrypted projects, one folder per user. */
  usersDir: path.join(dataDir, 'users'),
  dbPath: path.resolve(env.DB_PATH ?? path.join(dataDir, 'app.db')),
  /** Plaintext projects from before accounts existed; imported into the first admin's account. */
  legacyProjectsDir: path.resolve(env.PROJECTS_DIR ?? path.join(dataDir, 'projects')),
  buildsDir: path.resolve(env.BUILDS_DIR ?? '/var/lib/latex-editor/builds'),
  /** On the host mount: holds the year-scoped TEXMFHOME tree, package manifest and index cache. */
  texmfUserDir: path.resolve(env.TEXMF_USER_DIR ?? '/data/texmf'),
  texmfHome: path.resolve(env.TEXMFHOME ?? '/data/texmf/2026'),
  tlRoot: path.resolve(env.TL_ROOT ?? '/usr/local/texlive/2026'),
  tlYear: env.TL_YEAR ?? '2026',
  tlRepo: (env.TL_REPO ?? 'https://mirror.ctan.org/systems/texlive/tlnet').replace(/\/+$/, ''),
  compileTimeoutMs: Number(env.COMPILE_TIMEOUT_MS ?? 60_000),
  compileConcurrency: Math.max(1, Number(env.COMPILE_CONCURRENCY ?? 2)),
  publicDir: path.resolve(env.PUBLIC_DIR ?? path.join(import.meta.dirname, '../public')),
  templatesDir: path.join(import.meta.dirname, '../templates'),
  uploadLimitBytes: 50 * 1024 * 1024,
  /** Secure cookies need HTTPS (http://localhost also counts in Chrome and Firefox). */
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE !== 'false' : env.NODE_ENV === 'production',
  trustProxy: trustProxy(env.TRUST_PROXY),
  sessionIdleMs: Number(env.SESSION_IDLE_DAYS ?? 7) * 24 * 3600_000,
  sessionMaxMs: Number(env.SESSION_MAX_DAYS ?? 30) * 24 * 3600_000,
};
