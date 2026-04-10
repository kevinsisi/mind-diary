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

  const chatFolderCols = db.prepare("PRAGMA table_info(chat_folders)").all() as any[];
  if (!chatFolderCols.some((c: any) => c.name === "user_id")) {
    db.exec("ALTER TABLE chat_folders ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0 REFERENCES users(id)");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_folders_user_sort
      ON chat_folders(user_id, sort_order, created_at);
  `);

  const folderCols = db.prepare("PRAGMA table_info(folders)").all() as any[];
  if (!folderCols.some((c: any) => c.name === "user_id")) {
    db.exec("ALTER TABLE folders ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0 REFERENCES users(id)");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_folders_user_sort
      ON folders(user_id, sort_order, created_at);
  `);

  // Diary images (attached to diary entries)
  db.exec(`
    CREATE TABLE IF NOT EXISTS diary_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      diary_id INTEGER NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      size INTEGER NOT NULL,
      ai_description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add ai_agents, dispatch_reason, and image_url to chat_messages if they don't exist
  const chatMsgCols = db.prepare("PRAGMA table_info(chat_messages)").all() as any[];
  if (!chatMsgCols.some((c: any) => c.name === 'ai_agents')) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN ai_agents TEXT");
  }
  if (!chatMsgCols.some((c: any) => c.name === 'dispatch_reason')) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN dispatch_reason TEXT");
  }
  if (!chatMsgCols.some((c: any) => c.name === 'image_url')) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN image_url TEXT");
  }

  // ── Users table ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Add user_id to all content tables (DEFAULT 0 = legacy/guest) ─
  const tableUserIdPatches: Array<{ table: string; defaultVal?: number }> = [
    { table: "diary_entries" },
    { table: "files" },
    { table: "chat_sessions" },
    { table: "diary_images" },
  ];
  for (const { table } of tableUserIdPatches) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!cols.some((c: any) => c.name === "user_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0`);
    }
  }

  // chat_messages: add user_id derived from session owner (not independently set)
  const chatMsgColsCheck = db.prepare("PRAGMA table_info(chat_messages)").all() as any[];
  if (!chatMsgColsCheck.some((c: any) => c.name === "user_id")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0");
  }

  // Add nickname column to users if it doesn't exist
  const userCols = db.prepare("PRAGMA table_info(users)").all() as any[];
  if (!userCols.some((c: any) => c.name === "nickname")) {
    db.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
  }

  // Add custom_instructions column to users if it doesn't exist
  const userColsRefreshed = db.prepare("PRAGMA table_info(users)").all() as any[];
  if (!userColsRefreshed.some((c: any) => c.name === "custom_instructions")) {
    db.exec("ALTER TABLE users ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT ''");
  }

  const legacyChatFolders = db.prepare("SELECT id, name, icon, sort_order, created_at FROM chat_folders WHERE user_id = 0").all() as any[];
  const setChatFolderOwner = db.prepare("UPDATE chat_folders SET user_id = ? WHERE id = ?");
  const cloneChatFolder = db.prepare(
    `INSERT INTO chat_folders (name, icon, sort_order, created_at, user_id)
     VALUES (?, ?, ?, ?, ?)`
  );
  const moveChatSessionsToFolder = db.prepare("UPDATE chat_sessions SET folder_id = ? WHERE folder_id = ? AND user_id = ?");
  const chatFolderOwnersStmt = db.prepare(
    `SELECT DISTINCT user_id FROM chat_sessions WHERE folder_id = ? AND user_id != 0 ORDER BY user_id ASC`
  );

  for (const folder of legacyChatFolders) {
    const owners = chatFolderOwnersStmt.all(folder.id) as Array<{ user_id: number }>;
    if (owners.length === 0) continue;

    setChatFolderOwner.run(owners[0].user_id, folder.id);
    for (const owner of owners.slice(1)) {
      const clone = cloneChatFolder.run(folder.name, folder.icon, folder.sort_order, folder.created_at, owner.user_id);
      moveChatSessionsToFolder.run(clone.lastInsertRowid, folder.id, owner.user_id);
    }
  }

  const legacyFolders = db.prepare("SELECT id FROM folders WHERE user_id = 0").all() as Array<{ id: number }>;
  const setFolderOwner = db.prepare("UPDATE folders SET user_id = ? WHERE id = ?");
  const folderOwnersStmt = db.prepare(
    `SELECT DISTINCT user_id FROM diary_entries WHERE folder_id = ? AND user_id != 0 ORDER BY user_id ASC`
  );

  for (const folder of legacyFolders) {
    const owners = folderOwnersStmt.all(folder.id) as Array<{ user_id: number }>;
    if (owners.length === 1) {
      setFolderOwner.run(owners[0].user_id, folder.id);
    }
  }

  // ── User long-term memories ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_session_id INTEGER REFERENCES chat_sessions(id) ON DELETE SET NULL,
      source_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
      confidence INTEGER NOT NULL DEFAULT 50,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memories_user_kind_summary
      ON user_memories(user_id, kind, summary);

    CREATE INDEX IF NOT EXISTS idx_user_memories_user_updated_at
      ON user_memories(user_id, updated_at DESC);
  `);

  console.log("[migrate] All tables and FTS indexes created.");
}
