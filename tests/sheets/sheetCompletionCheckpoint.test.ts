import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readSheetCompletionCheckpoint,
  writeSheetCompletionCheckpoint
} from "../../src/sheets/sheetCompletionCheckpoint";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("sheet completion checkpoints", () => {
  it("persists and reloads a sheet_done checkpoint", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "tistory-sheet-checkpoint-"));
    roots.push(folder);

    await writeSheetCompletionCheckpoint(folder, {
      version: 1,
      state: "sheet_done",
      updatedAt: "2026-08-10T00:00:00.000Z",
      rowNumber: 49
    });

    await expect(readSheetCompletionCheckpoint(folder)).resolves.toEqual({
      version: 1,
      state: "sheet_done",
      updatedAt: "2026-08-10T00:00:00.000Z",
      rowNumber: 49
    });
  });
});
