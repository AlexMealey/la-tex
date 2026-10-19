import express, { Router, type Request } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError, param } from '../http.js';
import { cleanRelPath, safeJoin } from '../paths.js';
import { getProject, isEditable, projectDir, touchProject, updateProject } from '../projects.js';

/** Mounted at /api/projects/:id */
export const filesRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimitBytes } });

async function target(req: Request) {
  const id = param(req, 'id');
  const meta = await getProject(id);
  const root = projectDir(id);
  const rel = cleanRelPath(root, param(req, 'path'));
  return { id, meta, root, rel, abs: safeJoin(root, rel) };
}

filesRouter.get('/files/*path', async (req, res) => {
  const { abs, rel } = await target(req);
  const st = await fs.stat(abs).catch(() => null);
  if (!st?.isFile()) throw new HttpError(404, 'File not found');
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', 'sandbox');
  if (isEditable(rel)) res.type('text/plain');
  res.sendFile(abs, { dotfiles: 'allow' });
});

filesRouter.put('/files/*path', express.text({ type: () => true, limit: '20mb' }), async (req, res) => {
  const { id, abs, rel } = await target(req);
  const st = await fs.stat(abs).catch(() => null);
  if (st?.isDirectory()) throw new HttpError(409, `${rel} is a folder`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, typeof req.body === 'string' ? req.body : '', 'utf8');
  await touchProject(id);
  res.json({ ok: true, path: rel });
});

filesRouter.delete('/files/*path', async (req, res) => {
  const { id, abs } = await target(req);
  await fs.rm(abs, { recursive: true });
  await touchProject(id);
  res.json({ ok: true });
});

filesRouter.post('/folders', async (req, res) => {
  const id = param(req, 'id');
  await getProject(id);
  const root = projectDir(id);
  const rel = cleanRelPath(root, String(req.body?.path ?? ''));
  await fs.mkdir(safeJoin(root, rel), { recursive: true });
  res.status(201).json({ ok: true, path: rel });
});

filesRouter.post('/rename', async (req, res) => {
  const id = param(req, 'id');
  const meta = await getProject(id);
  const root = projectDir(id);
  const from = cleanRelPath(root, String(req.body?.from ?? ''));
  const to = cleanRelPath(root, String(req.body?.to ?? ''));
  if (to === from) return void res.json({ ok: true, path: to });
  if (to.startsWith(`${from}/`)) throw new HttpError(400, 'Cannot move a folder into itself');
  if (await fs.stat(safeJoin(root, to)).catch(() => null)) throw new HttpError(409, `${to} already exists`);
  await fs.mkdir(path.dirname(safeJoin(root, to)), { recursive: true });
  await fs.rename(safeJoin(root, from), safeJoin(root, to));

  if (meta.mainFile === from || meta.mainFile.startsWith(`${from}/`)) {
    await updateProject(id, { mainFile: to + meta.mainFile.slice(from.length) });
  } else {
    await touchProject(id);
  }
  res.json({ ok: true, path: to });
});

/** Multipart: `files[]` plus a JSON `paths` array of target paths (UTF-8 safe) and an optional `folder`. */
filesRouter.post('/upload', upload.array('files'), async (req, res) => {
  const id = param(req, 'id');
  await getProject(id);
  const root = projectDir(id);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const paths: unknown = JSON.parse(String(req.body?.paths ?? '[]'));
  const folder = String(req.body?.folder ?? '');
  const uploaded: string[] = [];
  for (const [i, file] of files.entries()) {
    const name = Array.isArray(paths) && typeof paths[i] === 'string' ? paths[i] : file.originalname;
    const rel = cleanRelPath(root, [folder, name].filter(Boolean).join('/'));
    const abs = safeJoin(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, file.buffer);
    uploaded.push(rel);
  }
  await touchProject(id);
  res.status(201).json({ uploaded });
});
