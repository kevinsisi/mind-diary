import { sqlite } from "../db/connection.js";

interface LegacyOwnershipConflict {
  folderId: number;
  folderName: string;
  userIds: number[];
  linkedCount: number;
}

interface LegacyIsolationReport {
  chatFoldersWithoutOwner: number;
  diaryFoldersWithoutOwner: number;
  chatFoldersMultiOwner: LegacyOwnershipConflict[];
  diaryFoldersMultiOwner: LegacyOwnershipConflict[];
}

interface LegacyIsolationRepairResult {
  repairedChatFolders: number;
  clonedChatFolders: number;
  repairedDiaryFolders: number;
  report: LegacyIsolationReport;
}

function getChatFolderOwnerConflicts(): LegacyOwnershipConflict[] {
  const legacyFolders = sqlite
    .prepare("SELECT id, name FROM chat_folders WHERE user_id = 0 ORDER BY id ASC")
    .all() as Array<{ id: number; name: string }>;
  const ownersStmt = sqlite.prepare(
    `SELECT user_id, COUNT(*) as count
     FROM chat_sessions
     WHERE folder_id = ? AND user_id != 0
     GROUP BY user_id
     ORDER BY user_id ASC`
  );

  return legacyFolders
    .map((folder) => {
      const owners = ownersStmt.all(folder.id) as Array<{ user_id: number; count: number }>;
      return {
        folderId: folder.id,
        folderName: folder.name,
        userIds: owners.map((owner) => owner.user_id),
        linkedCount: owners.reduce((sum, owner) => sum + owner.count, 0),
      };
    })
    .filter((folder) => folder.userIds.length > 1);
}

function getDiaryFolderOwnerConflicts(): LegacyOwnershipConflict[] {
  const legacyFolders = sqlite
    .prepare("SELECT id, name FROM folders WHERE user_id = 0 ORDER BY id ASC")
    .all() as Array<{ id: number; name: string }>;
  const ownersStmt = sqlite.prepare(
    `SELECT user_id, COUNT(*) as count
     FROM diary_entries
     WHERE folder_id = ? AND user_id != 0
     GROUP BY user_id
     ORDER BY user_id ASC`
  );

  return legacyFolders
    .map((folder) => {
      const owners = ownersStmt.all(folder.id) as Array<{ user_id: number; count: number }>;
      return {
        folderId: folder.id,
        folderName: folder.name,
        userIds: owners.map((owner) => owner.user_id),
        linkedCount: owners.reduce((sum, owner) => sum + owner.count, 0),
      };
    })
    .filter((folder) => folder.userIds.length > 1);
}

export function getLegacyIsolationReport(): LegacyIsolationReport {
  const chatFoldersWithoutOwner = (sqlite
    .prepare("SELECT COUNT(*) as count FROM chat_folders WHERE user_id = 0")
    .get() as { count: number }).count;
  const diaryFoldersWithoutOwner = (sqlite
    .prepare("SELECT COUNT(*) as count FROM folders WHERE user_id = 0")
    .get() as { count: number }).count;

  return {
    chatFoldersWithoutOwner,
    diaryFoldersWithoutOwner,
    chatFoldersMultiOwner: getChatFolderOwnerConflicts(),
    diaryFoldersMultiOwner: getDiaryFolderOwnerConflicts(),
  };
}

export function repairLegacyIsolation(): LegacyIsolationRepairResult {
  const legacyChatFolders = sqlite
    .prepare("SELECT id, name, icon, sort_order, created_at FROM chat_folders WHERE user_id = 0 ORDER BY id ASC")
    .all() as Array<{ id: number; name: string; icon: string | null; sort_order: number; created_at: string }>;
  const setChatFolderOwner = sqlite.prepare("UPDATE chat_folders SET user_id = ? WHERE id = ?");
  const cloneChatFolder = sqlite.prepare(
    `INSERT INTO chat_folders (name, icon, sort_order, created_at, user_id)
     VALUES (?, ?, ?, ?, ?)`
  );
  const moveChatSessionsToFolder = sqlite.prepare("UPDATE chat_sessions SET folder_id = ? WHERE folder_id = ? AND user_id = ?");
  const chatFolderOwnersStmt = sqlite.prepare(
    `SELECT DISTINCT user_id FROM chat_sessions WHERE folder_id = ? AND user_id != 0 ORDER BY user_id ASC`
  );

  let repairedChatFolders = 0;
  let clonedChatFolders = 0;

  const legacyDiaryFolders = sqlite
    .prepare("SELECT id FROM folders WHERE user_id = 0 ORDER BY id ASC")
    .all() as Array<{ id: number }>;
  const setDiaryFolderOwner = sqlite.prepare("UPDATE folders SET user_id = ? WHERE id = ?");
  const diaryFolderOwnersStmt = sqlite.prepare(
    `SELECT DISTINCT user_id FROM diary_entries WHERE folder_id = ? AND user_id != 0 ORDER BY user_id ASC`
  );
  let repairedDiaryFolders = 0;

  const tx = sqlite.transaction(() => {
    for (const folder of legacyChatFolders) {
      const owners = chatFolderOwnersStmt.all(folder.id) as Array<{ user_id: number }>;
      if (owners.length === 0) continue;

      setChatFolderOwner.run(owners[0].user_id, folder.id);
      repairedChatFolders += 1;

      for (const owner of owners.slice(1)) {
        const clone = cloneChatFolder.run(folder.name, folder.icon || "💬", folder.sort_order, folder.created_at, owner.user_id);
        moveChatSessionsToFolder.run(clone.lastInsertRowid, folder.id, owner.user_id);
        clonedChatFolders += 1;
      }
    }

    for (const folder of legacyDiaryFolders) {
      const owners = diaryFolderOwnersStmt.all(folder.id) as Array<{ user_id: number }>;
      if (owners.length === 1) {
        setDiaryFolderOwner.run(owners[0].user_id, folder.id);
        repairedDiaryFolders += 1;
      }
    }
  });

  tx();

  return {
    repairedChatFolders,
    clonedChatFolders,
    repairedDiaryFolders,
    report: getLegacyIsolationReport(),
  };
}

export type { LegacyIsolationReport, LegacyIsolationRepairResult, LegacyOwnershipConflict };
