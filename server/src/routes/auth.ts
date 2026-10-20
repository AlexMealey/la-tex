import { Router } from 'express';
import {
  changePassword,
  endSession,
  inviteInfo,
  login,
  recover,
  register,
  startSession,
  type SessionUser,
} from '../auth.js';
import { wipeBuild } from '../compile.js';
import { importLegacyProjects } from '../migrateLegacy.js';

export const authRouter = Router();

const publicUser = (u: SessionUser | undefined) => (u ? { id: u.id, username: u.username, isAdmin: u.isAdmin } : null);

authRouter.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.post('/login', async (req, res) => {
  const user = await login(req, req.body ?? {});
  startSession(req, res, user);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  const user = req.user;
  endSession(req, res);
  if (user) await wipeBuild(user.id);
  res.json({ ok: true });
});

authRouter.get('/invite', (req, res) => {
  res.json(inviteInfo(String(req.query.token ?? '')));
});

authRouter.post('/register', async (req, res) => {
  const { user, recoveryCode, firstUser } = await register(req, req.body ?? {});
  startSession(req, res, user);
  if (firstUser) {
    await importLegacyProjects(user).catch((err) => console.error('Importing pre-account projects failed:', err));
  }
  res.status(201).json({ user: publicUser(user), recoveryCode });
});

authRouter.post('/password', async (req, res) => {
  res.json({ recoveryCode: await changePassword(req, req.body ?? {}) });
});

authRouter.post('/recover', async (req, res) => {
  const { user, recoveryCode } = await recover(req, req.body ?? {});
  startSession(req, res, user);
  res.json({ user: publicUser(user), recoveryCode });
});
