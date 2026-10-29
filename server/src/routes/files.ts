import express, { Router, type Request } from 'express';
import path from 'node:path';
import multer from 'multer';
import { currentUser } from '../auth.js';
import { config } from '../config.js';
import { param } from '../http.js';
import { isEditable } from '../projects.js';
import { ProjectStore, cleanPath } from '../storage.js';

/** Mounted at /api/projects/:id */
export const filesRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimitBytes } });

function openStore(req: Request): Promise<ProjectStore> {
  return ProjectStore.open(currentUser(req), param(req, 'id'));
}

filesRouter.get('/files/*path', async (req, res) => {
  const store = await openStore(req);
  const rel = cleanPath(param(req, 'path'));
  const data = await store.read(rel);
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', 'sandbox');
  res.type(isEditable(rel) ? 'text/plain' : path.extname(rel) || 'application/octet-stream');
  res.send(data);
});

filesRouter.put('/files/*path', express.text({ type: () => true, limit: '20mb' }), async (req, res) => {
  const store = await openStore(req);
  const content = typeof req.body === 'string' ? req.body : '';
  const [rel] = await store.write(param(req, 'path'), Buffer.from(content, 'utf8'));
  res.json({ ok: true, path: rel });
});

filesRouter.delete('/files/*path', async (req, res) => {
  const store = await openStore(req);
  await store.remove(param(req, 'path'));
  res.json({ ok: true });
});

filesRouter.post('/folders', async (req, res) => {
  const store = await openStore(req);
  const rel = await store.mkdir(String(req.body?.path ?? ''));
  res.status(201).json({ ok: true, path: rel });
});

filesRouter.post('/rename', async (req, res) => {
  const store = await openStore(req);
  const to = await store.rename(String(req.body?.from ?? ''), String(req.body?.to ?? ''));
  res.json({ ok: true, path: to });
});

/** Multipart: `files[]` plus a JSON `paths` array of target paths (UTF-8 safe) and an optional `folder`. */
filesRouter.post('/upload', upload.array('files'), async (req, res) => {
  const store = await openStore(req);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const paths: unknown = JSON.parse(String(req.body?.paths ?? '[]'));
  const folder = String(req.body?.folder ?? '');
  const uploaded = await store.writeMany(
    files.map((file, i): [string, Buffer] => {
      const name = Array.isArray(paths) && typeof paths[i] === 'string' ? paths[i] : file.originalname;
      return [[folder, name].filter(Boolean).join('/'), file.buffer];
    }),
  );
  res.status(201).json({ uploaded });
});
