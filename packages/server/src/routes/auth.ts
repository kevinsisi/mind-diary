import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { sqlite } from '../db/connection.js';
import { requireAdmin, signToken } from '../middleware/auth.js';

const router = Router();

export function ensureUserProfileColumns(): void {
  const userCols = sqlite.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;

  if (!userCols.some((col) => col.name === 'nickname')) {
    sqlite.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
  }

  const refreshedCols = sqlite.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!refreshedCols.some((col) => col.name === 'custom_instructions')) {
    sqlite.exec("ALTER TABLE users ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT ''");
  }
}

// POST /api/auth/login
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: '請輸入帳號和密碼' });
    return;
  }

  const user = sqlite.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: '帳號或密碼錯誤' });
    return;
  }

  const token = signToken(user.id, user.role);
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    nickname: user.nickname ?? '',
  });
});

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req: Request, res: Response) => {
  if (!req.userId || req.userId === 0) {
    res.status(401).json({ error: '未登入' });
    return;
  }
  const user = sqlite
    .prepare(
      'SELECT id, username, role, nickname, custom_instructions, created_at FROM users WHERE id = ?',
    )
    .get(req.userId) as any;
  if (!user) {
    res.status(401).json({ error: '使用者不存在' });
    return;
  }
  res.json(user);
});

// PATCH /api/auth/me — update own nickname (any logged-in user)
router.patch('/me', (req: Request, res: Response) => {
  if (!req.userId || req.userId === 0) {
    res.status(401).json({ error: '未登入' });
    return;
  }
  const { nickname, custom_instructions } = req.body as {
    nickname?: string;
    custom_instructions?: string;
  };

  const updates: string[] = [];
  const params: any[] = [];

  if (typeof nickname === 'string') {
    updates.push('nickname = ?');
    params.push(nickname.trim().slice(0, 30));
  }

  if (typeof custom_instructions === 'string') {
    updates.push('custom_instructions = ?');
    params.push(custom_instructions.trim().slice(0, 500));
  }

  if (updates.length === 0) {
    res.status(400).json({ error: '沒有可更新的欄位' });
    return;
  }

  params.push(req.userId);
  sqlite.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = sqlite
    .prepare(
      'SELECT id, username, role, nickname, custom_instructions, created_at FROM users WHERE id = ?',
    )
    .get(req.userId) as any;
  res.json(updated);
});

// POST /api/auth/reset-password — admin resets any user's password by username
router.post('/reset-password', requireAdmin, (req: Request, res: Response) => {
  const { username, newPassword } = req.body as {
    username?: string;
    newPassword?: string;
  };
  if (!username || !newPassword) {
    res.status(400).json({ error: '需要帳號和新密碼' });
    return;
  }
  if (newPassword.length < 4) {
    res.status(400).json({ error: '新密碼長度至少 4 個字元' });
    return;
  }
  const user = sqlite.prepare('SELECT id FROM users WHERE username = ?').get(username) as
    | { id: number }
    | undefined;
  if (!user) {
    res.status(404).json({ error: '使用者不存在' });
    return;
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  sqlite.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true, id: user.id, username });
});

// ── Admin: user CRUD ───────────────────────────────────────────────

// GET /api/auth/users
router.get('/users', requireAdmin, (_req: Request, res: Response) => {
  const users = sqlite
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY id')
    .all();
  res.json(users);
});

// POST /api/auth/users
router.post('/users', requireAdmin, (req: Request, res: Response) => {
  const {
    username,
    password,
    role = 'user',
  } = req.body as {
    username?: string;
    password?: string;
    role?: string;
  };
  if (!username || !password) {
    res.status(400).json({ error: '需要帳號和密碼' });
    return;
  }
  if (!['admin', 'user'].includes(role)) {
    res.status(400).json({ error: 'role 必須是 admin 或 user' });
    return;
  }
  const existing = sqlite.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: '帳號已存在' });
    return;
  }
  const hash = bcrypt.hashSync(password, 10);
  const result = sqlite
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, role);
  res.status(201).json({ id: result.lastInsertRowid, username, role });
});

// PATCH /api/auth/users/:id
router.patch('/users/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { username, password, role } = req.body as {
    username?: string;
    password?: string;
    role?: string;
  };

  const user = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!user) {
    res.status(404).json({ error: '使用者不存在' });
    return;
  }

  if (role && !['admin', 'user'].includes(role)) {
    res.status(400).json({ error: 'role 必須是 admin 或 user' });
    return;
  }

  if (username) {
    const existing = sqlite
      .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .get(username, id) as { id: number } | undefined;
    if (existing) {
      res.status(409).json({ error: '帳號已存在' });
      return;
    }
  }

  if (user.role === 'admin' && role === 'user') {
    const adminCount = sqlite
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
      .get() as { count: number };

    if (adminCount.count <= 1) {
      res.status(400).json({ error: '無法移除最後一個管理員帳號' });
      return;
    }
  }

  if (username) sqlite.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id);
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    sqlite.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }
  if (role) {
    sqlite.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  const updated = sqlite
    .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
    .get(id);
  res.json(updated);
});

// DELETE /api/auth/users/:id
router.delete('/users/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (req.userId === id) {
    res.status(400).json({ error: '不能刪除自己' });
    return;
  }

  const targetUser = sqlite.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as
    | { id: number; role: string }
    | undefined;
  if (!targetUser) {
    res.status(404).json({ error: '使用者不存在' });
    return;
  }

  if (targetUser.role === 'admin') {
    const adminCount = sqlite
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
      .get() as { count: number };

    if (adminCount.count <= 1) {
      res.status(400).json({ error: '無法刪除最後一個管理員帳號' });
      return;
    }
  }

  sqlite.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
