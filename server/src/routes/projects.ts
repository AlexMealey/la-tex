import { Router } from 'express';
import multer from 'multer';
import { currentUser } from '../auth.js';
import { config } from '../config.js';
import { HttpError, downloadName, param } from '../http.js';
import {
  TEMPLATES,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
  type TemplateId,
} from '../projects.js';
import { ProjectStore } from '../storage.js';
import { detectMainFile, extractZip, writeProjectZip } from '../zip.js';

export const projectsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimitBytes } });

projectsRouter.get('/', async (req, res) => {
  res.json(await listProjects(currentUser(req)));
});

projectsRouter.post('/', async (req, res) => {
  const template = (req.body?.template ?? 'blank-a4') as TemplateId;
  if (!TEMPLATES.includes(template)) throw new HttpError(400, 'Unknown template');
  res.status(201).json(await createProject(currentUser(req), String(req.body?.name ?? ''), template));
});

projectsRouter.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No ZIP file uploaded');
  const user = currentUser(req);
  const meta = await createProject(user, String(req.body?.name || 'Imported project'));
  try {
    const store = await ProjectStore.open(user, meta.id);
    const files = await extractZip(req.file.buffer, store);
    res.status(201).json(await updateProject(user, meta.id, await detectMainFile(store, files)));
  } catch (err) {
    await deleteProject(user, meta.id);
    throw err;
  }
});

projectsRouter.get('/:id', async (req, res) => {
  res.json(await getProject(currentUser(req), param(req, 'id')));
});

projectsRouter.patch('/:id', async (req, res) => {
  const { name, engine, mainFile } = req.body ?? {};
  res.json(await updateProject(currentUser(req), param(req, 'id'), { name, engine, mainFile }));
});

projectsRouter.delete('/:id', async (req, res) => {
  await deleteProject(currentUser(req), param(req, 'id'));
  res.json({ ok: true });
});

projectsRouter.get('/:id/zip', async (req, res) => {
  const store = await ProjectStore.open(currentUser(req), param(req, 'id'));
  const meta = await store.meta();
  res.attachment(downloadName(meta.name, 'zip'));
  res.type('application/zip');
  await writeProjectZip(store, res);
});
