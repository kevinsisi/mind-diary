import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sqlite } from '../db/connection.js';

export const GUEST_USER_ID = 0;

const JWT_SECRET = process.env.JWT_SECRET || 'mind-diary-secret-change-in-production';

interface JwtPayload {
  userId: number;
  role: 'admin' | 'user';
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.token;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      const user = sqlite.prepare('SELECT id, role FROM users WHERE id = ?').get(payload.userId) as
        | { id: number; role: 'admin' | 'user' }
        | undefined;

      if (user) {
        req.userId = user.id;
        req.userRole = user.role;
      } else {
        req.userId = GUEST_USER_ID;
        req.userRole = 'guest';
      }
    } catch {
      req.userId = GUEST_USER_ID;
      req.userRole = 'guest';
    }
  } else {
    req.userId = GUEST_USER_ID;
    req.userRole = 'guest';
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  optionalAuth(req, res, () => {
    if (req.userId === GUEST_USER_ID) {
      res.status(401).json({ error: '需要登入' });
      return;
    }
    next();
  });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.userRole !== 'admin') {
      res.status(403).json({ error: '需要管理員權限' });
      return;
    }
    next();
  });
}

export function signToken(userId: number, role: 'admin' | 'user'): string {
  return jwt.sign({ userId, role } as JwtPayload, JWT_SECRET, { expiresIn: '7d' });
}
