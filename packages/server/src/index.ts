import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sqlite } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { seedAdmin } from './db/seedAdmin.js';
import filesRouter from './routes/files.js';
import diaryRouter from './routes/diary.js';
import diaryImagesRouter, { IMAGES_DIR } from './routes/diaryImages.js';
import chatRouter from './routes/chat.js';
import searchRouter from './routes/search.js';
import settingsRouter from './routes/settings.js';
import foldersRouter from './routes/folders.js';
import tagsRouter from './routes/tags.js';
import authRouter, { ensureUserProfileColumns } from './routes/auth.js';
import { optionalAuth } from './middleware/auth.js';
import { safeSyncEnvKeys } from './ai/pool.js';

// ── Run migrations ─────────────────────────────────────────────────
runMigrations(sqlite);
safeSyncEnvKeys();
seedAdmin(sqlite);
ensureUserProfileColumns();

// ── Ensure data directories exist ─────────────────────────────────
const dataBase = process.env.DATABASE_PATH ? path.dirname(process.env.DATABASE_PATH) : './data';
fs.mkdirSync(path.resolve(dataBase, 'uploads'), { recursive: true });
fs.mkdirSync(path.resolve(dataBase, 'images'), { recursive: true });

// ── Express app ────────────────────────────────────────────────────
const app = express();
const PORT = Number(process.env.PORT) || 8823;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(optionalAuth);

// ── Serve uploaded images as static files ──────────────────────────
app.use('/images', express.static(IMAGES_DIR));

// ── API routes ─────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/files', filesRouter);
app.use('/api/diary', diaryRouter);
app.use('/api/diary/:id/images', diaryImagesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/search', searchRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/folders', foldersRouter);
app.use('/api/tags', tagsRouter);

// ── Serve frontend in production ───────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../../web/dist');
const webIndex = path.join(webDist, 'index.html');
if (fs.existsSync(webIndex)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(webIndex);
  });
}

// ── Start server ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[mind-diary] Server running on http://localhost:${PORT}`);
});
