import express, { type ErrorRequestHandler } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { config } from './config.js';
import { HttpError } from './http.js';
import { compileRouter } from './routes/compile.js';
import { filesRouter } from './routes/files.js';
import { packagesRouter } from './routes/packages.js';
import { projectsRouter } from './routes/projects.js';

await fs.mkdir(config.projectsDir, { recursive: true });
await fs.mkdir(config.buildsDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:id', filesRouter);
app.use('/api/projects/:id', compileRouter);
app.use('/api/packages', packagesRouter);
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
  res.status(status).json({ error: err?.message ?? 'Internal error' });
};
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`LaTeX editor listening on port ${config.port}`);
});
