import type Database from "better-sqlite3";
import bcrypt from "bcryptjs";

export function seedAdmin(db: Database.Database): void {
  const adminCount = (db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'").get() as any).n;
  if (adminCount > 0) return;

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const hash = bcrypt.hashSync(password, 10);

  const result = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
    .run(username, hash);

  const adminId = result.lastInsertRowid as number;

  // Migrate existing data to the first admin user
  const tables = ["diary_entries", "files", "chat_sessions", "diary_images", "chat_messages"];
  for (const table of tables) {
    db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = 0`).run(adminId);
  }

  console.log(`[seedAdmin] Created admin user '${username}' (id=${adminId}), migrated existing data.`);
}
