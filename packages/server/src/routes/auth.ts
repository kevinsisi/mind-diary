import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { sqlite } from "../db/connection.js";
import { requireAdmin, requireAuth, signToken } from "../middleware/auth.js";

const router = Router();

// POST /api/auth/login
router.post("/login", (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "請輸入帳號和密碼" });
    return;
  }

  const user = sqlite
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as any;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: "帳號或密碼錯誤" });
    return;
  }

  const token = signToken(user.id, user.role);
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === "production",
  });
  res.json({ id: user.id, username: user.username, role: user.role, nickname: user.nickname ?? "" });
});

// POST /api/auth/logout
router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/me", (req: Request, res: Response) => {
  if (!req.userId || req.userId === 0) {
    res.status(401).json({ error: "未登入" });
    return;
  }
  const user = sqlite
    .prepare("SELECT id, username, role, nickname, created_at FROM users WHERE id = ?")
    .get(req.userId) as any;
  if (!user) {
    res.status(401).json({ error: "使用者不存在" });
    return;
  }
  res.json(user);
});

// PATCH /api/auth/me — update own nickname (any logged-in user)
router.patch("/me", (req: Request, res: Response) => {
  if (!req.userId || req.userId === 0) {
    res.status(401).json({ error: "未登入" });
    return;
  }
  const { nickname } = req.body as { nickname?: string };
  if (typeof nickname !== "string") {
    res.status(400).json({ error: "nickname 必須是字串" });
    return;
  }
  const trimmed = nickname.trim().slice(0, 30);
  sqlite.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(trimmed, req.userId);
  const updated = sqlite
    .prepare("SELECT id, username, role, nickname, created_at FROM users WHERE id = ?")
    .get(req.userId) as any;
  res.json(updated);
});

// ── Admin: user CRUD ───────────────────────────────────────────────

// GET /api/auth/users
router.get("/users", requireAdmin, (_req: Request, res: Response) => {
  const users = sqlite
    .prepare("SELECT id, username, role, created_at FROM users ORDER BY id")
    .all();
  res.json(users);
});

// POST /api/auth/users
router.post("/users", requireAdmin, (req: Request, res: Response) => {
  const { username, password, role = "user" } = req.body as {
    username?: string;
    password?: string;
    role?: string;
  };
  if (!username || !password) {
    res.status(400).json({ error: "需要帳號和密碼" });
    return;
  }
  if (!["admin", "user"].includes(role)) {
    res.status(400).json({ error: "role 必須是 admin 或 user" });
    return;
  }
  const existing = sqlite.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    res.status(409).json({ error: "帳號已存在" });
    return;
  }
  const hash = bcrypt.hashSync(password, 10);
  const result = sqlite
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(username, hash, role);
  res.status(201).json({ id: result.lastInsertRowid, username, role });
});

// PATCH /api/auth/users/:id
router.patch("/users/:id", requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { username, password, role } = req.body as {
    username?: string;
    password?: string;
    role?: string;
  };

  const user = sqlite.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
  if (!user) {
    res.status(404).json({ error: "使用者不存在" });
    return;
  }

  if (username) sqlite.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, id);
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    sqlite.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  }
  if (role && ["admin", "user"].includes(role)) {
    sqlite.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  }

  const updated = sqlite
    .prepare("SELECT id, username, role, created_at FROM users WHERE id = ?")
    .get(id);
  res.json(updated);
});

// DELETE /api/auth/users/:id
router.delete("/users/:id", requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (req.userId === id) {
    res.status(400).json({ error: "不能刪除自己" });
    return;
  }
  const result = sqlite.prepare("DELETE FROM users WHERE id = ?").run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: "使用者不存在" });
    return;
  }
  res.json({ ok: true });
});

export default router;
