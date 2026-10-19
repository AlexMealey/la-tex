import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError, downloadName, param } from '../http.js';
import {
  TEMPLATES,
  createProject,
  deleteProject,
  getProject,
  listFiles,
  listProjects,
  projectDir,
  updateProject,
  type TemplateId,
} from '../projects.js';
import { detectMainFile, extractZip, writeProjectZip } from '../zip.js';

export const projectsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimitBytes } });

projectsRouter.get('/', async (_req, res) => {
  res.json(await listProjects());
});

projectsRouter.post('/', async (req, res) => {
  const template = (req.body?.template ?? 'blank-a4') as TemplateId;
  if (!TEMPLATES.includes(template)) throw new HttpError(400, 'Unknown template');
  res.status(201).json(await createProject(String(req.body?.name ?? ''), template));
});

projectsRouter.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No ZIP file uploaded');
  const meta = await createProject(String(req.body?.name || 'Imported project'));
  try {
    const dir = projectDir(meta.id);
    const files = await extractZip(req.file.buffer, dir);
    res.status(201).json(await updateProject(meta.id, await detectMainFile(dir, files)));
  } catch (err) {
    await deleteProject(meta.id);
    throw err;
  }
});

projectsRouter.get('/:id', async (req, res) => {
  const id = param(req, 'id');
  const meta = await getProject(id);
  res.json({ ...meta, files: await listFiles(projectDir(id)) });
});

projectsRouter.patch('/:id', async (req, res) => {
  const { name, engine, mainFile } = req.body ?? {};
  res.json(await updateProject(param(req, 'id'), { name, engine, mainFile }));
});

projectsRouter.delete('/:id', async (req, res) => {
  await deleteProject(param(req, 'id'));
  res.json({ ok: true });
});

projectsRouter.get('/:id/zip', async (req, res) => {
  const id = param(req, 'id');
  const meta = await getProject(id);
  res.attachment(downloadName(meta.name, 'zip'));
  res.type('application/zip');
  await writeProjectZip(projectDir(id), res);
});
