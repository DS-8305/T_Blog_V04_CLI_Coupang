import { readPostStatus } from "../core/statusStore";
import { assertRowIdentity, type GoogleSheetsClient } from "./googleSheetsClient";
import { syncProfileResult, recordProfileError } from './profileResultSync';
import { findSheetSources, type LinkedSheetSource } from "./sheetSource";
import { writeSheetCompletionCheckpoint } from "./sheetCompletionCheckpoint";

export type SheetSyncSummary = {
  synced: number;
  alreadyDone: number;
  pending: LinkedSheetSource[];
};

export async function syncCompletedSheetPosts(
  workspacePath: string,
  client: GoogleSheetsClient,
  onLog?: (message: string) => void,
  options: { syncProfile?: typeof syncProfileResult } = {}
): Promise<SheetSyncSummary> {
  const linked = await findSheetSources(workspacePath);
  const summary: SheetSyncSummary = { synced: 0, alreadyDone: 0, pending: [] };

  for (const item of linked) {
    const { source } = item;
    const status = await readPostStatus(item.postFolder);
    // Older injected clients need no new methods; the live client checks remote control even for v1.
    const control = (source.version === 2 || client.writeProfileFields)
      ? await client.readSourceRow(source.spreadsheetId,source.sheetName,source.rowNumber) : undefined;
    if (control) {
      if (source.version === 2 && status?.status === 'draft_saved' && control.automationStatus === 'COMPLETE' && control.result.toLowerCase() === 'done') {
        assertRowIdentity(control,source,source.rowNumber);
        await writeSheetCompletionCheckpoint(item.postFolder,{version:1,state:'sheet_done',updatedAt:new Date().toISOString(),rowNumber:source.rowNumber});
        summary.alreadyDone += 1;
        continue;
      }
      const inactive = control.automationStatus !== undefined && control.automationStatus !== 'READY';
      if (inactive || (control.result.trim() && (status?.status !== 'draft_saved' || control.result.trim().toLowerCase() !== 'done'))) {
        onLog?.(`Skipping inactive Sheet row ${source.rowNumber}.`);
        continue;
      }
      assertRowIdentity(control, source, source.rowNumber);
    }
    if (status?.status !== "draft_saved") {
      summary.pending.push(item);
      continue;
    }

    await writeSheetCompletionCheckpoint(item.postFolder, {
      version: 1,
      state: "awaiting_sheet_done",
      updatedAt: new Date().toISOString(),
      rowNumber: source.rowNumber
    });
    const remote = control ?? await client.readSourceRow(
      source.spreadsheetId,
      source.sheetName,
      source.rowNumber
    );
    if (remote.keyword.trim() !== source.keyword.trim()) {
      throw new Error(`Sheet keyword changed at row ${source.rowNumber}`);
    }

    try {
    if (source.version === 2 && (!remote.result || remote.result.toLowerCase() === 'done')) {
      await (options.syncProfile ?? syncProfileResult)(item.postFolder, client, { allowDone: true });
    }

    const result = remote.result.trim();
    if (result.toLowerCase() === "done") {
      await completeProfile();
      await writeSheetCompletionCheckpoint(item.postFolder, {
        version: 1,
        state: "sheet_done",
        updatedAt: new Date().toISOString(),
        rowNumber: source.rowNumber
      });
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
      remote.resultColumn,
      ...(client.writeProfileFields ? [{...source,result:'',...(remote.automationStatus === undefined ? {} : {automationStatus:'READY'})}] : [])
    );
    const verified = await client.readSourceRow(
      source.spreadsheetId,
      source.sheetName,
      source.rowNumber
    );
    if (verified.result.trim().toLowerCase() !== "done") {
      throw new Error(`Sheet row ${source.rowNumber} did not confirm done after write`);
    }
    assertRowIdentity(verified, source, source.rowNumber);
    await completeProfile();
    await writeSheetCompletionCheckpoint(item.postFolder, {
      version: 1,
      state: "sheet_done",
      updatedAt: new Date().toISOString(),
      rowNumber: source.rowNumber
    });
    summary.synced += 1;
    onLog?.(`Sheet row ${source.rowNumber} marked done.`);
    } catch (error) {
      await recordProfileError(item.postFolder, client, error);
      throw error;
    }

    async function completeProfile() {
      if (source.version !== 2) return;
      if (!client.writeProfileFields) throw new Error('Sheets client does not support profile completion.');
      const current = await client.readSourceRow(source.spreadsheetId,source.sheetName,source.rowNumber);
      assertRowIdentity(current,source,source.rowNumber);
      if (current.result.toLowerCase() !== 'done') throw new Error('Profile completion requires verified done.');
      if (current.automationStatus === 'COMPLETE') return;
      await client.writeProfileFields(source.spreadsheetId,source.sheetName,source.rowNumber,{자동화상태:'COMPLETE'},
        {...source,automationStatus:'READY',result:current.result});
    }
  }

  return summary;
}
