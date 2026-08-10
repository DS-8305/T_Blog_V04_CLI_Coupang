import fs from "node:fs/promises";
import path from "node:path";
import { createGoogleSheetsClient, type GoogleSheetsClient } from "../sheets/googleSheetsClient";
import { selectFirstPendingRow } from "../sheets/sheetQueue";
import { syncCompletedSheetPosts, type SheetSyncSummary } from "../sheets/sheetResultSync";
import { buildSheetPostId, writeSheetSource } from "../sheets/sheetSource";
import { parseSheetNextArgs } from "./sheetNextArgs";

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
    if (summary.pending.length > 0) {
      const existing = summary.pending[0]!;
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
    await writeSheetSource(postFolder, {
      version: 1,
      spreadsheetId: options.spreadsheetId,
      sheetName: options.sheetName,
      rowNumber: selected.rowNumber,
      keywordHeader: "keyword",
      resultHeader: "result",
      keyword: selected.keyword
    });
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
