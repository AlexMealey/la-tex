import { Router } from 'express';
import fs from 'node:fs/promises';
import { currentUser } from '../auth.js';
import { buildOutput, compileProject, wipeBuild } from '../compile.js';
import { HttpError, downloadName, param } from '../http.js';
import { ProjectStore } from '../storage.js';

/** Mounted at /api/projects/:id */
export const compileRouter = Router({ mergeParams: true });

compileRouter.post('/compile', async (req, res) => {
  res.json(await compileProject(currentUser(req), param(req, 'id')));
});

/** "Clear cache": drop aux files so the next compile starts from scratch. */
compileRouter.delete('/build', async (req, res) => {
  const user = currentUser(req);
  const id = param(req, 'id');
  await ProjectStore.open(user, id);
  await wipeBuild(user.id, id);
  res.json({ ok: true });
});

compileRouter.get('/pdf', async (req, res) => {
  const user = currentUser(req);
  const id = param(req, 'id');
  const meta = await (await ProjectStore.open(user, id)).meta();
  const pdf = buildOutput(user.id, id, 'output.pdf');
  if (!pdf || !(await fs.stat(pdf).catch(() => null))) throw new HttpError(404, 'No PDF yet — compile the project first');
  res.set('Cache-Control', 'no-store');
  if (req.query.download) res.attachment(downloadName(meta.name, 'pdf'));
  res.sendFile(pdf);
});

compileRouter.get('/log', async (req, res) => {
  const user = currentUser(req);
  const id = param(req, 'id');
  await ProjectStore.open(user, id);
  const file = buildOutput(user.id, id, 'output.log');
  const log = file ? await fs.readFile(file, 'utf8').catch(() => '') : '';
  res.type('text/plain').send(log);
});
