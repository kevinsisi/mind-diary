import type Database from "better-sqlite3";
import bcrypt from "bcryptjs";

export function seedAdmin(db: Database.Database): void {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";

  const adminCount = (db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'").get() as any).n;

  if (adminCount === 0) {
    // No admin exists — create one and migrate existing data
    const hash = bcrypt.hashSync(password, 10);
    const result = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
      .run(username, hash);

    const adminId = result.lastInsertRowid as number;

    const tables = ["diary_entries", "files", "chat_sessions", "diary_images", "chat_messages"];
    for (const table of tables) {
      db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = 0`).run(adminId);
    }

    console.log(`[seedAdmin] Created admin user '${username}' (id=${adminId}), migrated existing data.`);
    return;
  }

  // Admin(s) exist — sync password for the target username
  const existing = db
    .prepare("SELECT id, password_hash FROM users WHERE username = ? AND role = 'admin'")
    .get(username) as { id: number; password_hash: string } | undefined;

  if (!existing) {
    // Env username doesn't match any admin — create a new admin with that username
    const hash = bcrypt.hashSync(password, 10);
    const result = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
      .run(username, hash);
    console.log(`[seedAdmin] Created new admin user '${username}' (id=${result.lastInsertRowid}) from env vars.`);
    return;
  }

  // Admin with this username exists — sync password if it changed
  if (!bcrypt.compareSync(password, existing.password_hash)) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, existing.id);
    console.log(`[seedAdmin] Updated password for admin user '${username}' (id=${existing.id}) from env vars.`);
  } else {
    console.log(`[seedAdmin] Admin user '${username}' password unchanged.`);
  }
}
