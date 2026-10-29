import { Router } from 'express';
import fs from 'node:fs/promises';
import {
  createInvite,
  currentUser,
  deleteUser,
  listInvites,
  listUsers,
  requireAdmin,
  revokeInvite,
  setUserDisabled,
} from '../auth.js';
import { wipeBuild } from '../compile.js';
import { HttpError, param } from '../http.js';
import { userDir } from '../storage.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/users', (_req, res) => {
  res.json(listUsers());
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = param(req, 'id');
  if (id === currentUser(req).id) throw new HttpError(400, "You can't disable your own account");
  const disabled = Boolean(req.body?.disabled);
  setUserDisabled(id, disabled);
  if (disabled) await wipeBuild(id);
  res.json({ ok: true });
});

/** Deletes the account and all of its projects. */
adminRouter.delete('/users/:id', async (req, res) => {
  const id = param(req, 'id');
  if (id === currentUser(req).id) throw new HttpError(400, "You can't delete your own account");
  const dir = userDir(id);
  deleteUser(id);
  await wipeBuild(id);
  await fs.rm(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

adminRouter.get('/invites', (_req, res) => {
  res.json(listInvites());
});

adminRouter.post('/invites', (req, res) => {
  res.status(201).json(createInvite(currentUser(req).id, Boolean(req.body?.isAdmin)));
});

adminRouter.delete('/invites/:id', (req, res) => {
  revokeInvite(Number(param(req, 'id')));
  res.json({ ok: true });
});
