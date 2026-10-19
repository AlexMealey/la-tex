import { Router } from 'express';
import { config } from '../config.js';
import { HttpError, param } from '../http.js';
import { getJob, readManifest, startJob } from '../tlmgr.js';
import { assertInstallable, packagesForFile, searchPackages, userPackages } from '../tlpdb.js';

export const packagesRouter = Router();

packagesRouter.get('/', async (req, res) => {
  res.json(await searchPackages(String(req.query.q ?? '')));
});

packagesRouter.get('/state', async (_req, res) => {
  const installed = await userPackages();
  const installedNames = new Set(installed.map((p) => p.name));
  const manifest = await readManifest();
  res.json({
    tlYear: config.tlYear,
    repository: config.tlRepo,
    userTree: config.texmfHome,
    installed,
    // Asked for under an earlier TeX Live release (another year folder) but not installed in this one.
    missingFromManifest: manifest.filter((n) => !installedNames.has(n)),
  });
});

packagesRouter.get('/which', async (req, res) => {
  res.json(await packagesForFile(String(req.query.file ?? '')));
});

packagesRouter.post('/install', async (req, res) => {
  const names: unknown = req.body?.names;
  if (!Array.isArray(names) || !names.length) throw new HttpError(400, 'Expected { names: [...] }');
  const list = names.map(String);
  await assertInstallable(list);
  res.status(202).json(startJob('install', list));
});

packagesRouter.post('/remove', async (req, res) => {
  const name = String(req.body?.name ?? '');
  if (!name) throw new HttpError(400, 'Expected { name }');
  res.status(202).json(startJob('remove', [name]));
});

packagesRouter.get('/jobs/:jobId', (req, res) => {
  res.json(getJob(param(req, 'jobId')));
});
