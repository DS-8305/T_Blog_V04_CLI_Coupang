import fs from "node:fs/promises";
import path from "node:path";
import { assertRowIdentity, createGoogleSheetsClient, type GoogleSheetsClient } from "../sheets/googleSheetsClient";
import { selectFirstPendingRow } from "../sheets/sheetQueue";
import { syncCompletedSheetPosts, type SheetSyncSummary } from "../sheets/sheetResultSync";
import { buildSheetPostId, writeSheetSource } from "../sheets/sheetSource";
import { parseSheetNextArgs } from "./sheetNextArgs";
import { isProfileSheet, mapProfileSheetRow } from '../sheets/profileSheetRow';
import { writeProfileTask } from '../sheets/profileTask';
import type { SheetSource } from '../sheets/sheetSource';
import { recordProfileError } from '../sheets/profileResultSync';

export type SheetNextDependencies = {
  createClient: () => GoogleSheetsClient;
  syncCompleted: (
    workspacePath: string,
    client: GoogleSheetsClient,
    onLog?: (message: string) => void
  ) => Promise<SheetSyncSummary>;
  log: (message: string) => void;
  error: (message: string) => void;
};

export async function sheetNextMain(
  argv: string[],
  overrides: Partial<SheetNextDependencies> = {}
): Promise<number> {
  const createClient = overrides.createClient ?? createGoogleSheetsClient;
  const syncCompleted = overrides.syncCompleted ?? syncCompletedSheetPosts;
  const log = overrides.log ?? console.log;
  const logError = overrides.error ?? console.error;

  try {
    const options = parseSheetNextArgs(argv);
    const client = createClient();
    const summary = await syncCompleted(options.workspacePath, client, log);
    const existing = summary.pending.find(item => item.source.spreadsheetId === options.spreadsheetId && item.source.sheetName === options.sheetName);
    if (existing) {
      if (existing.source.version === 2 && (!(await pathExists(path.join(existing.postFolder,'profile-task.json'))) || !(await pathExists(path.join(existing.postFolder,'profile-prompt.txt'))))) {
        const source=existing.source;
        try {
          const remote=await client.readSourceRow(source.spreadsheetId,source.sheetName,source.rowNumber);
          assertRowIdentity(remote,{...source,automationStatus:'READY',result:''},source.rowNumber);
          if (!remote.profile) throw new Error('Missing profile row data.');
          await writeProfileTask(existing.postFolder,source,remote.profile,client);
        } catch (error) {
          await recordProfileError(existing.postFolder,client,error);
          throw error;
        }
      }
      log(`Continue existing Sheet row ${existing.source.rowNumber}: ${existing.source.keyword}\n${existing.postFolder}`);
      return 0;
    }

    const queue = await client.readQueue(options.spreadsheetId, options.sheetName);
    const selected = selectFirstPendingRow(queue.values);
    if (!selected) {
      log("No pending sheet rows.");
      return 0;
    }

    const postId = buildSheetPostId(selected.rowNumber, selected.keyword);
    const postFolder = path.join(options.workspacePath, "posts", postId);
    if (await pathExists(postFolder)) {
      throw new Error(`Post folder collision: ${postFolder}`);
    }
    const row = isProfileSheet(queue.values[0] ?? []) ? mapProfileSheetRow(queue.values[0]!, queue.values[selected.rowNumber - 1]!) : undefined;
    const source: SheetSource = {
      version: row ? 2 : 1,
      ...(row ? { personId: row.personId, promptType: row.promptType } : {}),
      spreadsheetId: options.spreadsheetId,
      sheetName: options.sheetName,
      rowNumber: selected.rowNumber,
      keywordHeader: "keyword",
      resultHeader: "result",
      keyword: selected.keyword
    };
    await writeSheetSource(postFolder, source);
    if (row) {
      try { await writeProfileTask(postFolder, source, row, client); }
      catch (error) { await recordProfileError(postFolder,client,error); throw error; }
    }
    log(`Imported Sheet row ${selected.rowNumber}: ${selected.keyword}\n${postFolder}`);
    return 0;
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.stat(candidate);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

if (process.argv[1]?.endsWith("sheetNextCli.js")) {
  void sheetNextMain(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
