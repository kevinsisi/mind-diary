import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { sqlite } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import filesRouter from "./routes/files.js";
import diaryRouter from "./routes/diary.js";
import chatRouter from "./routes/chat.js";
import searchRouter from "./routes/search.js";
import settingsRouter from "./routes/settings.js";

// ── Run migrations ─────────────────────────────────────────────────
runMigrations(sqlite);

// ── Ensure upload directory exists ─────────────────────────────────
const uploadDir = path.resolve(
  process.env.DATABASE_PATH
    ? path.dirname(process.env.DATABASE_PATH)
    : "./data",
  "uploads"
);
fs.mkdirSync(uploadDir, { recursive: true });

// ── Express app ────────────────────────────────────────────────────
const app = express();
const PORT = Number(process.env.PORT) || 8823;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ── API routes ─────────────────────────────────────────────────────
app.use("/api/files", filesRouter);
app.use("/api/diary", diaryRouter);
app.use("/api/chat", chatRouter);
app.use("/api/search", searchRouter);
app.use("/api/settings", settingsRouter);

// ── Serve frontend in production ───────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, "../../web/dist");
app.use(express.static(webDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

// ── Start server ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[mind-diary] Server running on http://localhost:${PORT}`);
});
