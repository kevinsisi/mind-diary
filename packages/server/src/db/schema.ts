import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const defaultNow = sql`(datetime('now'))`;

// ── Files ──────────────────────────────────────────────────────────
export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  mimetype: text("mimetype").notNull(),
  size: integer("size").notNull(),
  filepath: text("filepath").notNull(),
  content_text: text("content_text"),
  ai_summary: text("ai_summary"),
  created_at: text("created_at").notNull().default(defaultNow),
});

// ── Diary Entries ──────────────────────────────────────────────────
export const diaryEntries = sqliteTable("diary_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  mood: text("mood"),
  ai_reflection: text("ai_reflection"),
  created_at: text("created_at").notNull().default(defaultNow),
  updated_at: text("updated_at").notNull().default(defaultNow),
});

// ── Chat Sessions ──────────────────────────────────────────────────
export const chatSessions = sqliteTable("chat_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default("新對話"),
  created_at: text("created_at").notNull().default(defaultNow),
});

// ── Chat Messages ──────────────────────────────────────────────────
export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  session_id: integer("session_id")
    .notNull()
    .references(() => chatSessions.id),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  created_at: text("created_at").notNull().default(defaultNow),
});

// ── API Keys ───────────────────────────────────────────────────────
export const apiKeys = sqliteTable("api_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  source: text("source").notNull().default("db"),
  suffix: text("suffix").notNull(),
  is_blocked: integer("is_blocked").notNull().default(0),
  created_at: text("created_at").notNull().default(defaultNow),
});

// ── API Key Cooldowns ──────────────────────────────────────────────
export const apiKeyCooldowns = sqliteTable("api_key_cooldowns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key_id: integer("key_id")
    .notNull()
    .references(() => apiKeys.id),
  reason: text("reason").notNull(),
  cooldown_until: integer("cooldown_until").notNull(),
  created_at: text("created_at").notNull().default(defaultNow),
});

// ── API Key Usage ──────────────────────────────────────────────────
export const apiKeyUsage = sqliteTable("api_key_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key_id: integer("key_id")
    .notNull()
    .references(() => apiKeys.id),
  model: text("model").notNull(),
  tokens_in: integer("tokens_in").notNull().default(0),
  tokens_out: integer("tokens_out").notNull().default(0),
  call_type: text("call_type"),
  created_at: text("created_at").notNull().default(defaultNow),
});

// ── Settings ───────────────────────────────────────────────────────
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updated_at: text("updated_at").notNull().default(defaultNow),
});
