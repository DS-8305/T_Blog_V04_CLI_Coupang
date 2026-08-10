import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleSheetsClient, SheetSourceRow } from "../../src/sheets/googleSheetsClient";
import { syncCompletedSheetPosts } from "../../src/sheets/sheetResultSync";
import { writeSheetSource, type SheetSource } from "../../src/sheets/sheetSource";
import { readPostStatus, writePostStatus } from "../../src/core/statusStore";
import type { PostStatus } from "../../src/shared/types";
import { readSheetCompletionCheckpoint } from "../../src/sheets/sheetCompletionCheckpoint";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("syncCompletedSheetPosts", () => {
  it("writes done for a matching draft_saved source", async () => {
    const { workspace, source } = await createLinkedPost("draft_saved");
    const client = fakeClient({ keyword: source.keyword, result: "", keywordColumn: 1, resultColumn: 2 });

    await expect(syncCompletedSheetPosts(workspace, client)).resolves.toEqual({
      synced: 1,
      alreadyDone: 0,
      pending: []
    });
    expect(client.writeDone).toHaveBeenCalledWith(
      source.spreadsheetId,
      source.sheetName,
      source.rowNumber,
      2
    );
    await expect(readSheetCompletionCheckpoint(path.join(workspace, "posts", "000034-keyword")))
      .resolves.toMatchObject({ state: "sheet_done", rowNumber: 34 });
  });

  it("treats an existing DONE value as synchronized", async () => {
    const { workspace, source } = await createLinkedPost("draft_saved");
    const client = fakeClient({ keyword: source.keyword, result: "DONE", keywordColumn: 1, resultColumn: 2 });

    await expect(syncCompletedSheetPosts(workspace, client)).resolves.toEqual({
      synced: 0,
      alreadyDone: 1,
      pending: []
    });
    expect(client.writeDone).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed", "needs_review"] as const)(
    "does not write a %s local result",
    async (status) => {
      const { workspace, postFolder } = await createLinkedPost(status);
      const client = fakeClient({ keyword: "unused", result: "", keywordColumn: 1, resultColumn: 2 });

      const summary = await syncCompletedSheetPosts(workspace, client);

      expect(client.readSourceRow).not.toHaveBeenCalled();
      expect(client.writeDone).not.toHaveBeenCalled();
      expect(summary.pending).toHaveLength(1);
      expect(summary.pending[0]?.postFolder).toBe(postFolder);
    }
  );

  it("rejects a changed remote keyword", async () => {
    const { workspace } = await createLinkedPost("draft_saved");
    const client = fakeClient({ keyword: "changed", result: "", keywordColumn: 1, resultColumn: 2 });

    await expect(syncCompletedSheetPosts(workspace, client))
      .rejects.toThrow("Sheet keyword changed at row 34");
    expect(client.writeDone).not.toHaveBeenCalled();
  });

  it("protects an externally owned result", async () => {
    const { workspace, source } = await createLinkedPost("draft_saved");
    const client = fakeClient({ keyword: source.keyword, result: "processing", keywordColumn: 1, resultColumn: 2 });

    await expect(syncCompletedSheetPosts(workspace, client))
      .rejects.toThrow("Sheet result is not blank or done at row 34");
    expect(client.writeDone).not.toHaveBeenCalled();
  });

  it("leaves local draft_saved state retryable when the write fails", async () => {
    const { workspace, postFolder, source } = await createLinkedPost("draft_saved");
    const client = fakeClient(
      { keyword: source.keyword, result: "", keywordColumn: 1, resultColumn: 2 },
      new Error("offline")
    );

    await expect(syncCompletedSheetPosts(workspace, client)).rejects.toThrow("offline");
    await expect(readPostStatus(postFolder)).resolves.toMatchObject({ status: "draft_saved" });
    await expect(readSheetCompletionCheckpoint(postFolder))
      .resolves.toMatchObject({ state: "awaiting_sheet_done", rowNumber: 34 });
  });

  it("does not finish synchronization when done cannot be read back", async () => {
    const { workspace, postFolder, source } = await createLinkedPost("draft_saved");
    const client = fakeClient(
      { keyword: source.keyword, result: "", keywordColumn: 1, resultColumn: 2 },
      undefined,
      { keyword: source.keyword, result: "", keywordColumn: 1, resultColumn: 2 }
    );

    await expect(syncCompletedSheetPosts(workspace, client))
      .rejects.toThrow("Sheet row 34 did not confirm done after write");
    await expect(readSheetCompletionCheckpoint(postFolder))
      .resolves.toMatchObject({ state: "awaiting_sheet_done", rowNumber: 34 });
  });
});

async function createLinkedPost(status: PostStatus) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "tistory-sheet-sync-"));
  temporaryRoots.push(workspace);
  const postFolder = path.join(workspace, "posts", "000034-keyword");
  const source: SheetSource = {
    version: 1,
    spreadsheetId: "spreadsheet-id",
    sheetName: "시트1",
    rowNumber: 34,
    keywordHeader: "keyword",
    resultHeader: "result",
    keyword: "selected keyword"
  };
  await writeSheetSource(postFolder, source);
  await writePostStatus(postFolder, { status, message: status });
  return { workspace, postFolder, source };
}

function fakeClient(row: SheetSourceRow, writeError?: Error, rowAfterWrite: SheetSourceRow = { ...row, result: "done" }): GoogleSheetsClient & {
  readSourceRow: ReturnType<typeof vi.fn>;
  writeDone: ReturnType<typeof vi.fn>;
} {
  let readCount = 0;
  return {
    readQueue: vi.fn(async () => ({ values: [], rowCount: 0 })),
    readSourceRow: vi.fn(async () => readCount++ === 0 ? row : rowAfterWrite),
    writeDone: vi.fn(async () => {
      if (writeError) throw writeError;
    })
  };
}
