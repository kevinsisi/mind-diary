import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import path from "node:path";
import fs from "node:fs";

const dbPath = process.env.DATABASE_PATH || "./data/mind-diary.db";

// Ensure the data directory exists
const dbDir = path.dirname(dbPath);
fs.mkdirSync(dbDir, { recursive: true });

// Create the raw better-sqlite3 connection
export const sqlite: DatabaseType = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
sqlite.pragma("journal_mode = WAL");

// Create the Drizzle ORM instance
export const db = drizzle(sqlite, { schema });
