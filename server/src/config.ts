import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  projectsDir: path.resolve(env.PROJECTS_DIR ?? '/data/projects'),
  buildsDir: path.resolve(env.BUILDS_DIR ?? '/var/lib/latex-editor/builds'),
  /** On the host mount: holds the year-scoped TEXMFHOME tree, package manifest and index cache. */
  texmfUserDir: path.resolve(env.TEXMF_USER_DIR ?? '/data/texmf'),
  texmfHome: path.resolve(env.TEXMFHOME ?? '/data/texmf/2026'),
  tlRoot: path.resolve(env.TL_ROOT ?? '/usr/local/texlive/2026'),
  tlYear: env.TL_YEAR ?? '2026',
  tlRepo: (env.TL_REPO ?? 'https://mirror.ctan.org/systems/texlive/tlnet').replace(/\/+$/, ''),
  compileTimeoutMs: Number(env.COMPILE_TIMEOUT_MS ?? 60_000),
  publicDir: path.resolve(env.PUBLIC_DIR ?? path.join(import.meta.dirname, '../public')),
  templatesDir: path.join(import.meta.dirname, '../templates'),
  uploadLimitBytes: 50 * 1024 * 1024,
};
