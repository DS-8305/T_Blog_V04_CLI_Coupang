import { readPostStatus } from "../core/statusStore";
import type { GoogleSheetsClient } from "./googleSheetsClient";
import { findSheetSources, type LinkedSheetSource } from "./sheetSource";

export type SheetSyncSummary = {
  synced: number;
  alreadyDone: number;
  pending: LinkedSheetSource[];
};

export async function syncCompletedSheetPosts(
  workspacePath: string,
  client: GoogleSheetsClient,
  onLog?: (message: string) => void
): Promise<SheetSyncSummary> {
  const linked = await findSheetSources(workspacePath);
  const summary: SheetSyncSummary = { synced: 0, alreadyDone: 0, pending: [] };

  for (const item of linked) {
    const status = await readPostStatus(item.postFolder);
    if (status?.status !== "draft_saved") {
      summary.pending.push(item);
      continue;
    }

    const { source } = item;
    const remote = await client.readSourceRow(
      source.spreadsheetId,
      source.sheetName,
      source.rowNumber
    );
    if (remote.keyword.trim() !== source.keyword.trim()) {
      throw new Error(`Sheet keyword changed at row ${source.rowNumber}`);
    }

    const result = remote.result.trim();
    if (result.toLowerCase() === "done") {
      summary.alreadyDone += 1;
      onLog?.(`Sheet row ${source.rowNumber} is already done.`);
      continue;
    }
    if (result) {
      throw new Error(`Sheet result is not blank or done at row ${source.rowNumber}`);
    }

    await client.writeDone(
      source.spreadsheetId,
      source.sheetName,
      source.rowNumber,
      remote.resultColumn
    );
    summary.synced += 1;
    onLog?.(`Sheet row ${source.rowNumber} marked done.`);
  }

  return summary;
}
