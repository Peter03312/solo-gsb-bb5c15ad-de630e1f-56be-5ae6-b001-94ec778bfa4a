import { Router } from 'express';
import { getDB, verifyPassword, type Role } from './db.js';
import {
  clearAuthCookie,
  requireAuth,
  setAuthCookie,
  signToken,
  type AuthUser,
} from './auth.js';
import { badRequest, isString } from './http.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isString(body.username) || !isString(body.password)) {
    badRequest('请输入用户名和密码。');
  }
  const row = getDB()
    .prepare(`SELECT id, username, display_name, role, password_hash FROM users WHERE username = ?`)
    .get(body.username.trim()) as
    | {
        id: number;
        username: string;
        display_name: string;
        role: Role;
        password_hash: string;
      }
    | undefined;

  if (!row || !verifyPassword(body.password as string, row.password_hash)) {
    res.status(401).json({ error: '用户名或密码错误。' });
    return;
  }

  const user: AuthUser = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
  };
  setAuthCookie(res, signToken(user));
  res.json({ user });
});

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
