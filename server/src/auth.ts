import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getDB, type Role } from './db.js';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function secret(): string {
  return process.env.AUTH_SECRET || 'dev-secret-change-me';
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** 签名 Token：base64url(payload).base64url(hmac) */
export function signToken(user: AuthUser): string {
  const payload = b64url(JSON.stringify({ uid: user.id }));
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token: string): { uid: number } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.uid !== 'number') return null;
    return { uid: data.uid };
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export const COOKIE_NAME = 'tok';
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

export function setAuthCookie(res: Response, token: string) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ONE_WEEK / 1000}`,
  ];
  if ((process.env.COOKIE_SECURE || '').toLowerCase() === 'true') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearAuthCookie(res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** 解析当前登录用户（可选登录） */
export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) {
    const claims = verifyToken(token);
    if (claims) {
      const row = getDB()
        .prepare(`SELECT id, username, display_name, role FROM users WHERE id = ?`)
        .get(claims.uid) as
        | { id: number; username: string; display_name: string; role: Role }
        | undefined;
      if (row) {
        req.user = {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          role: row.role,
        };
      }
    }
  }
  next();
}

/** 要求已登录 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: '未登录或会话已失效，请先登录。' });
    return;
  }
  next();
}

/** 要求指定角色 */
export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: '未登录或会话已失效，请先登录。' });
      return;
    }
    if (req.user.role !== role) {
      const who = role === 'librarian' ? '馆员' : '校核人';
      res.status(403).json({ error: `无权限：该操作仅限${who}执行。` });
      return;
    }
    next();
  };
}
