import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from '../compile.js';
import { HttpError, downloadName, param } from '../http.js';
import { buildDir, getProject } from '../projects.js';

/** Mounted at /api/projects/:id */
export const compileRouter = Router({ mergeParams: true });

compileRouter.post('/compile', async (req, res) => {
  res.json(await compileProject(param(req, 'id')));
});

/** "Clear cache": drop aux files so the next compile starts from scratch. */
compileRouter.delete('/build', async (req, res) => {
  const id = param(req, 'id');
  await getProject(id);
  await fs.rm(buildDir(id), { recursive: true, force: true });
  res.json({ ok: true });
});

compileRouter.get('/pdf', async (req, res) => {
  const id = param(req, 'id');
  const meta = await getProject(id);
  const pdf = path.join(buildDir(id), 'output.pdf');
  if (!(await fs.stat(pdf).catch(() => null))) throw new HttpError(404, 'No PDF yet — compile the project first');
  res.set('Cache-Control', 'no-store');
  if (req.query.download) res.attachment(downloadName(meta.name, 'pdf'));
  res.sendFile(pdf);
});

compileRouter.get('/log', async (req, res) => {
  const id = param(req, 'id');
  await getProject(id);
  const log = await fs.readFile(path.join(buildDir(id), 'output.log'), 'utf8').catch(() => '');
  res.type('text/plain').send(log);
});
