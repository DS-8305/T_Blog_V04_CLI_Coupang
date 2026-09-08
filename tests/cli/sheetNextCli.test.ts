import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sheetNextMain } from "../../src/cli/sheetNextCli";
import type { GoogleSheetsClient } from "../../src/sheets/googleSheetsClient";
import { readSheetSource, writeSheetSource, type SheetSource } from "../../src/sheets/sheetSource";
import { headers, profileCells, promptValues } from '../sheets/profileFixtures';
import { mapProfileSheetRow } from '../../src/sheets/profileSheetRow';

const temporaryRoots: string[] = [];
const sheetId = "105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g";

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("sheetNextMain", () => {
  it('repairs missing profile artifacts when a READY v2 import resumes', async () => {
    const workspace=await makeWorkspace();const folder=path.join(workspace,'posts','000002-profile');
    const source={...makeSource(),version:2 as const,personId:'SP000001',promptType:'야구선수',keyword:'테스트선수 프로필'};
    await writeSheetSource(folder,source);
    const client=fakeClient(promptValues);
    client.readSourceRow=async()=>({keyword:source.keyword,result:'',keywordColumn:18,resultColumn:19,automationStatus:'READY',profile:mapProfileSheetRow(headers,profileCells())});
    const code=await sheetNextMain(args(workspace),{createClient:()=>client,syncCompleted:async()=>({synced:0,alreadyDone:0,pending:[{postFolder:folder,source}]}),log:vi.fn()});
    expect(code).toBe(0);
    expect(await fs.readFile(path.join(folder,'profile-prompt.txt'),'utf8')).toContain('COMMON RULE');
  });
  it('creates v2 profile artifacts using the prompt tab', async () => {
    const workspace = await makeWorkspace();
    const client = fakeClient([]);
    client.readQueue.mockImplementation(async (_id: string, tab: string) => ({ values:tab === '프롬프트_설정' ? promptValues : [headers,profileCells()],rowCount:50 }));
    const code = await sheetNextMain([...args(workspace),'--sheet-name','Codex_작업큐'], {
      createClient: () => client, syncCompleted: async () => ({ synced:0,alreadyDone:0,pending:[] }), log:vi.fn()
    });
    expect(code).toBe(0);
    const folder = path.join(workspace,'posts',(await fs.readdir(path.join(workspace,'posts')))[0]!);
    await expect(readSheetSource(folder)).resolves.toMatchObject({ version:2,personId:'SP000001' });
    expect(JSON.parse(await fs.readFile(path.join(folder,'profile-task.json'),'utf8'))).toMatchObject({ personId:'SP000001',row:{team:'테스트팀'},promptIds:['COMMON_BASE','ATHLETE_BASE','BASEBALL','DOC_OUTPUT'] });
    expect(await fs.readFile(path.join(folder,'profile-prompt.txt'),'utf8')).toContain('BASEBALL RULE');
    await expect(fs.stat(path.join(folder,'content.txt'))).rejects.toThrow();
  });
  it("creates one linked folder for the first pending row", async () => {
    const workspace = await makeWorkspace();
    const logs: string[] = [];
    const client = fakeClient([
      ["keyword", "result"],
      ["first keyword", ""],
      ["second keyword", ""]
    ]);

    const code = await sheetNextMain(args(workspace), {
      createClient: () => client,
      syncCompleted: vi.fn(async () => ({ synced: 0, alreadyDone: 0, pending: [] })),
      log: (message) => logs.push(message)
    });

    expect(code).toBe(0);
    const postFolders = await fs.readdir(path.join(workspace, "posts"));
    expect(postFolders).toEqual(["000002-first-keyword"]);
    await expect(readSheetSource(path.join(workspace, "posts", postFolders[0]!))).resolves.toMatchObject({
      spreadsheetId: sheetId,
      sheetName: "시트1",
      rowNumber: 2,
      keyword: "first keyword"
    });
    expect(logs.join("\n")).toContain("first keyword");
  });

  it("reports when no pending rows remain", async () => {
    const workspace = await makeWorkspace();
    const logs: string[] = [];

    const code = await sheetNextMain(args(workspace), {
      createClient: () => fakeClient([["keyword", "result"], ["complete", "done"]]),
      syncCompleted: vi.fn(async () => ({ synced: 0, alreadyDone: 0, pending: [] })),
      log: (message) => logs.push(message)
    });

    expect(code).toBe(0);
    expect(logs).toEqual(["No pending sheet rows."]);
  });

  it("continues an existing unfinished linked row instead of importing another", async () => {
    const workspace = await makeWorkspace();
    const postFolder = path.join(workspace, "posts", "000002-first-keyword");
    const source = makeSource();
    await writeSheetSource(postFolder, source);
    const logs: string[] = [];
    const client = fakeClient([["keyword", "result"], ["first keyword", ""], ["second", ""]]);

    const code = await sheetNextMain(args(workspace), {
      createClient: () => client,
      syncCompleted: vi.fn(async () => ({
        synced: 0,
        alreadyDone: 0,
        pending: [{ postFolder, source }]
      })),
      log: (message) => logs.push(message)
    });

    expect(code).toBe(0);
    expect(client.readQueue).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("Continue existing Sheet row 2");
  });

  it("fails without overwriting a colliding post folder", async () => {
    const workspace = await makeWorkspace();
    const collision = path.join(workspace, "posts", "000002-first-keyword");
    await fs.mkdir(collision, { recursive: true });
    await fs.writeFile(path.join(collision, "keep.txt"), "keep", "utf8");
    const errors: string[] = [];

    const code = await sheetNextMain(args(workspace), {
      createClient: () => fakeClient([["keyword", "result"], ["first keyword", ""]]),
      syncCompleted: vi.fn(async () => ({ synced: 0, alreadyDone: 0, pending: [] })),
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual([expect.stringContaining("Post folder collision")]);
    await expect(fs.readFile(path.join(collision, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("reports a client error without creating a post folder", async () => {
    const workspace = await makeWorkspace();
    const errors: string[] = [];
    const client = fakeClient([]);
    client.readQueue.mockRejectedValueOnce(new Error("permission denied"));

    const code = await sheetNextMain(args(workspace), {
      createClient: () => client,
      syncCompleted: vi.fn(async () => ({ synced: 0, alreadyDone: 0, pending: [] })),
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual(["permission denied"]);
    await expect(fs.readdir(path.join(workspace, "posts"))).rejects.toThrow();
  });
});

function fakeClient(values: string[][]): GoogleSheetsClient & {
  readQueue: ReturnType<typeof vi.fn>;
} {
  return {
    readQueue: vi.fn(async () => ({ values, rowCount: values.length })),
    readSourceRow: vi.fn(async () => ({ keyword: "", result: "", keywordColumn: 1, resultColumn: 2 })),
    writeDone: vi.fn(async () => undefined)
  };
}

function args(workspace: string): string[] {
  return ["--workspace", workspace, "--sheet-url", sheetId];
}

async function makeWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "tistory-sheet-next-"));
  temporaryRoots.push(workspace);
  return workspace;
}

function makeSource(): SheetSource {
  return {
    version: 1,
    spreadsheetId: sheetId,
    sheetName: "시트1",
    rowNumber: 2,
    keywordHeader: "keyword",
    resultHeader: "result",
    keyword: "first keyword"
  };
}
