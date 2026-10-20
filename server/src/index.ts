import express, { type ErrorRequestHandler } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { ensureBootstrapInvite, loadSession, requireAuth, sweepSessions } from './auth.js';
import { initBuildsDir, startBuildSweeper } from './compile.js';
import { config } from './config.js';
import { HttpError } from './http.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { compileRouter } from './routes/compile.js';
import { filesRouter } from './routes/files.js';
import { packagesRouter } from './routes/packages.js';
import { projectsRouter } from './routes/projects.js';
import { csrfGuard, securityHeaders } from './security.js';

await fs.mkdir(config.usersDir, { recursive: true, mode: 0o700 });
await initBuildsDir();
startBuildSweeper();
setInterval(sweepSessions, 10 * 60_000).unref();
ensureBootstrapInvite();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(securityHeaders);
app.use('/api', csrfGuard, loadSession);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/projects/:id', requireAuth, filesRouter);
app.use('/api/projects/:id', requireAuth, compileRouter);
app.use('/api/packages', requireAuth, packagesRouter);
app.use('/api', () => {
  throw new HttpError(404, 'Not found');
});

// The built React app, with index.html as the fallback for client-side routes.
app.use(express.static(config.publicDir));
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    err instanceof HttpError ? err.status
    : err instanceof multer.MulterError ? 400
    : typeof err?.status === 'number' ? err.status
    : 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return;
  // Unexpected errors can mention server paths; keep those details in the server log.
  const expose = err instanceof HttpError || status < 500;
  res.status(status).json({ error: (expose && err?.message) || 'Internal error' });
};
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`LaTeX editor listening on port ${config.port}`);
});
