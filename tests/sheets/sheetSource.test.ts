import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSheetPostId,
  findSheetSources,
  readSheetSource,
  writeSheetSource,
  type SheetSource
} from "../../src/sheets/sheetSource";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("sheet source manifests", () => {
  it("round-trips a versioned manifest", async () => {
    const folder = await makeTemporaryDirectory();
    const source = makeSource();

    await writeSheetSource(folder, source);

    await expect(readSheetSource(folder)).resolves.toEqual(source);
  });

  it("returns null only when the manifest does not exist", async () => {
    await expect(readSheetSource(await makeTemporaryDirectory())).resolves.toBeNull();
  });

  it("rejects an invalid existing manifest", async () => {
    const folder = await makeTemporaryDirectory();
    await fs.writeFile(path.join(folder, "sheet-source.json"), "{}", "utf8");

    await expect(readSheetSource(folder)).rejects.toThrow("Invalid sheet-source.json");
  });

  it("discovers linked post folders in stable folder-name order", async () => {
    const workspace = await makeTemporaryDirectory();
    const first = path.join(workspace, "posts", "000002-first");
    const second = path.join(workspace, "posts", "000010-second");
    await writeSheetSource(second, makeSource({ rowNumber: 10, keyword: "second" }));
    await writeSheetSource(first, makeSource({ rowNumber: 2, keyword: "first" }));

    await expect(findSheetSources(workspace)).resolves.toEqual([
      { postFolder: first, source: makeSource({ rowNumber: 2, keyword: "first" }) },
      { postFolder: second, source: makeSource({ rowNumber: 10, keyword: "second" }) }
    ]);
  });

  it("builds a deterministic Korean-safe post id", () => {
    expect(buildSheetPostId(34, "고지혈증 약, 평생 먹어야 하나요?"))
      .toBe("000034-고지혈증-약-평생-먹어야-하나요");
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tistory-sheet-source-"));
  temporaryRoots.push(root);
  return root;
}

function makeSource(overrides: Partial<SheetSource> = {}): SheetSource {
  return {
    version: 1,
    spreadsheetId: "spreadsheet-id",
    sheetName: "시트1",
    rowNumber: 34,
    keywordHeader: "keyword",
    resultHeader: "result",
    keyword: "고지혈증 약",
    ...overrides
  };
}
