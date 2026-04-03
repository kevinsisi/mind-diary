import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Files
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      size INTEGER NOT NULL,
      filepath TEXT NOT NULL,
      content_text TEXT,
      ai_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Diary Entries
    CREATE TABLE IF NOT EXISTS diary_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      mood TEXT,
      ai_reflection TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Chat Sessions
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '新對話',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Chat Messages
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES chat_sessions(id),
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- API Keys
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'db',
      suffix TEXT NOT NULL,
      is_blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- API Key Cooldowns
    CREATE TABLE IF NOT EXISTS api_key_cooldowns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id INTEGER NOT NULL REFERENCES api_keys(id),
      reason TEXT NOT NULL,
      cooldown_until INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- API Key Usage
    CREATE TABLE IF NOT EXISTS api_key_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id INTEGER NOT NULL REFERENCES api_keys(id),
      model TEXT NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      call_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Settings
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- FTS5 virtual tables for full-text search (unicode61 tokenizer for Chinese support)
    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      content_text,
      filename,
      tokenize = 'unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS diary_fts USING fts5(
      title,
      content,
      tokenize = 'unicode61'
    );

    -- Tags (AI auto-generated + user-created)
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6366f1',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Diary-Tag junction
    CREATE TABLE IF NOT EXISTS diary_entry_tags (
      diary_id INTEGER NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (diary_id, tag_id)
    );

    -- Folders for diary organization
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES folders(id),
      icon TEXT DEFAULT '📁',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add folder_id column if it doesn't exist
  const columns = db.prepare("PRAGMA table_info(diary_entries)").all() as any[];
  if (!columns.some((c: any) => c.name === 'folder_id')) {
    db.exec("ALTER TABLE diary_entries ADD COLUMN folder_id INTEGER REFERENCES folders(id)");
  }

  if (!columns.some((c: any) => c.name === 'ai_agents')) {
    db.exec("ALTER TABLE diary_entries ADD COLUMN ai_agents TEXT");
  }

  // Add folder_id to chat_sessions if it doesn't exist
  const chatCols = db.prepare("PRAGMA table_info(chat_sessions)").all() as any[];
  if (!chatCols.some((c: any) => c.name === 'folder_id')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN folder_id INTEGER REFERENCES folders(id)");
  }

  // Create chat_folders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '💬',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log("[migrate] All tables and FTS indexes created.");
}
