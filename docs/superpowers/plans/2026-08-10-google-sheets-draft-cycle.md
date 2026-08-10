# Google Sheets Draft Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import exactly one pending Google Sheets keyword into a local Codex content workspace, then mark that source row `done` only after the linked Tistory draft is confirmed.

**Architecture:** A small Sheets domain layer owns header/row selection, service-account REST access, local source manifests, and result synchronization. A new `sheet:next` CLI creates one local work item; the existing `draft:run` CLI performs pre/post synchronization without changing non-Sheet workflows.

**Tech Stack:** TypeScript, Node.js 22, `google-auth-library`, Google Sheets REST API v4, Vitest, existing Playwright Tistory automation

## Global Constraints

- One cycle imports exactly one new Sheet row.
- Google credentials come only from `GOOGLE_APPLICATION_CREDENTIALS` and are never logged or persisted in workspace files.
- The source spreadsheet is `105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g`, with default tab `시트1` and required headers `keyword` and `result`.
- Only a confirmed local `draft_saved` result may write `done`.
- Empty `result` means pending; case-insensitive `done` means complete; every other non-empty value is externally owned and must not be overwritten.
- Sheet-linked CLI publication remains draft-only.
- Existing non-Sheet `draft:run` behavior must remain unchanged.
- Automated tests must not write to the live Google Sheet or submit a live Tistory draft.

---

### Task 1: Sheet row selection and source manifest

**Files:**
- Create: `src/sheets/sheetQueue.ts`
- Create: `src/sheets/sheetSource.ts`
- Create: `tests/sheets/sheetQueue.test.ts`
- Create: `tests/sheets/sheetSource.test.ts`

**Interfaces:**
- Produces: `selectFirstPendingRow(values: string[][]): SheetQueueSelection`
- Produces: `SheetSource` with `version`, `spreadsheetId`, `sheetName`, `rowNumber`, `keywordHeader`, `resultHeader`, and `keyword`
- Produces: `readSheetSource(postFolder: string): Promise<SheetSource | null>`
- Produces: `writeSheetSource(postFolder: string, source: SheetSource): Promise<void>`
- Produces: `findSheetSources(workspacePath: string): Promise<Array<{ postFolder: string; source: SheetSource }>>`
- Produces: `buildSheetPostId(rowNumber: number, keyword: string): string`

- [ ] **Step 1: Write failing queue-selection tests**

```ts
it("selects the first non-empty keyword with a blank result", () => {
  expect(selectFirstPendingRow([
    ["keyword", "result"],
    ["done item", "done"],
    ["externally owned", "processing"],
    ["next keyword", "  "]
  ])).toEqual({
    rowNumber: 4,
    keyword: "next keyword",
    keywordColumn: 1,
    resultColumn: 2
  });
});

it("finds headers when columns move", () => {
  expect(selectFirstPendingRow([
    ["notes", "result", "keyword"],
    ["", "", "moved keyword"]
  ])).toMatchObject({ rowNumber: 2, keywordColumn: 3, resultColumn: 2 });
});

it.each([
  [["keyword"], "Missing required Sheet header: result"],
  [["keyword", "result", "keyword"], "Duplicate Sheet header: keyword"]
])("rejects invalid headers", (headers, message) => {
  expect(() => selectFirstPendingRow([headers])).toThrow(message);
});
```

- [ ] **Step 2: Run the queue tests and verify RED**

Run: `pnpm.cmd vitest run tests/sheets/sheetQueue.test.ts`

Expected: FAIL because `src/sheets/sheetQueue.ts` does not exist.

- [ ] **Step 3: Implement the queue selector minimally**

```ts
export type SheetQueueSelection = {
  rowNumber: number;
  keyword: string;
  keywordColumn: number;
  resultColumn: number;
} | null;

export function selectFirstPendingRow(values: string[][]): SheetQueueSelection {
  const headers = values[0] ?? [];
  const keywordColumn = requireUniqueHeader(headers, "keyword");
  const resultColumn = requireUniqueHeader(headers, "result");
  for (let index = 1; index < values.length; index += 1) {
    const keyword = values[index]?.[keywordColumn - 1]?.trim() ?? "";
    const result = values[index]?.[resultColumn - 1]?.trim() ?? "";
    if (keyword && !result) return { rowNumber: index + 1, keyword, keywordColumn, resultColumn };
  }
  return null;
}
```

- [ ] **Step 4: Run queue tests and verify GREEN**

Run: `pnpm.cmd vitest run tests/sheets/sheetQueue.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing manifest tests**

```ts
it("round-trips a versioned source manifest", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-source-"));
  const source = makeSource({ rowNumber: 34, keyword: "고지혈증 약" });
  await writeSheetSource(folder, source);
  await expect(readSheetSource(folder)).resolves.toEqual(source);
});

it("rejects a malformed existing source manifest", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-source-bad-"));
  await fs.writeFile(path.join(folder, "sheet-source.json"), "{}", "utf8");
  await expect(readSheetSource(folder)).rejects.toThrow("Invalid sheet-source.json");
});

it("creates a deterministic safe folder id", () => {
  expect(buildSheetPostId(34, "고지혈증 약, 평생 먹어야 하나요?")).toBe("000034-고지혈증-약-평생-먹어야-하나요");
});
```

- [ ] **Step 6: Run manifest tests and verify RED**

Run: `pnpm.cmd vitest run tests/sheets/sheetSource.test.ts`

Expected: FAIL because manifest functions do not exist.

- [ ] **Step 7: Implement strict manifest IO and workspace discovery**

Use `fs.writeFile` to a sibling `sheet-source.json.tmp`, then `fs.rename` for atomic replacement. `readSheetSource` returns `null` only for `ENOENT`; JSON or schema errors throw. `findSheetSources` searches `workspace/posts/*` when `posts` exists, otherwise `workspace/*`, and returns entries sorted by post folder name.

The slug keeps Korean letters, ASCII letters, and digits; converts other runs to `-`; trims dashes; and caps the slug at 48 characters. The six-digit row prefix is always retained.

- [ ] **Step 8: Run Task 1 tests and the full suite**

Run: `pnpm.cmd vitest run tests/sheets/sheetQueue.test.ts tests/sheets/sheetSource.test.ts`

Run: `pnpm.cmd test`

Expected: all tests PASS.

- [ ] **Step 9: Commit Task 1**

```powershell
git add src/sheets/sheetQueue.ts src/sheets/sheetSource.ts tests/sheets/sheetQueue.test.ts tests/sheets/sheetSource.test.ts
git commit -m "feat: model Google Sheets draft sources"
```

---

### Task 2: Service-account Sheets REST client

**Files:**
- Create: `src/sheets/sheetAuth.ts`
- Create: `src/sheets/googleSheetsClient.ts`
- Create: `tests/sheets/sheetAuth.test.ts`
- Create: `tests/sheets/googleSheetsClient.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `SheetQueueSelection` from Task 1
- Produces: `createSheetsAccessToken(credentialsPath?: string): Promise<string>`
- Produces: `GoogleSheetsClient` interface with `readQueue`, `readSourceRow`, and `writeDone`
- Produces: `createGoogleSheetsClient(options?: { fetch?: typeof fetch; getAccessToken?: () => Promise<string> }): GoogleSheetsClient`
- Produces: `parseSpreadsheetId(value: string): string`

- [ ] **Step 1: Add the official authentication dependency**

Run: `pnpm.cmd add google-auth-library@^10.3.0`

Expected: `package.json` and `pnpm-lock.yaml` include `google-auth-library`.

- [ ] **Step 2: Write failing authentication tests**

```ts
it("requires GOOGLE_APPLICATION_CREDENTIALS", async () => {
  await expect(createSheetsAccessToken(" ")).rejects.toThrow(
    "GOOGLE_APPLICATION_CREDENTIALS must point to a service account JSON file."
  );
});
```

Inject a `GoogleAuth` factory in tests so no real credential or network call occurs. Assert the scope is exactly `https://www.googleapis.com/auth/spreadsheets` and the returned client token string is used.

- [ ] **Step 3: Run authentication tests and verify RED**

Run: `pnpm.cmd vitest run tests/sheets/sheetAuth.test.ts`

Expected: FAIL because `sheetAuth.ts` does not exist.

- [ ] **Step 4: Implement service-account token acquisition**

Resolve the explicit argument or `process.env.GOOGLE_APPLICATION_CREDENTIALS`, reject missing paths, use `new GoogleAuth({ keyFile, scopes: [SHEETS_SCOPE] })`, call `getClient().getAccessToken()`, and reject an empty token. Do not include the path in error messages returned from Google.

- [ ] **Step 5: Write failing REST client tests**

```ts
it("reads metadata and a bounded A:Z queue range", async () => {
  const fetchMock = sequenceFetch(
    jsonResponse({ sheets: [{ properties: { title: "시트1", gridProperties: { rowCount: 1922 } } }] }),
    jsonResponse({ values: [["keyword", "result"], ["next", ""]] })
  );
  const client = createGoogleSheetsClient({ fetch: fetchMock, getAccessToken: async () => "token" });
  await expect(client.readQueue(SHEET_ID, "시트1")).resolves.toEqual({
    values: [["keyword", "result"], ["next", ""]],
    rowCount: 1922
  });
  expect(fetchMock.mock.calls[1]?.[0]).toContain(encodeURIComponent("시트1!A1:Z1922"));
});

it("writes done to the exact result cell", async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ updatedCells: 1 }));
  const client = createGoogleSheetsClient({ fetch: fetchMock, getAccessToken: async () => "token" });
  await client.writeDone(SHEET_ID, "시트1", 34, 2);
  expect(fetchMock.mock.calls[0]?.[0]).toContain(encodeURIComponent("시트1!B34"));
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ values: [["done"]] });
});
```

Add these explicit cases in the same test file:

```ts
expect(parseSpreadsheetId(SHEET_URL)).toBe(SHEET_ID);
expect(parseSpreadsheetId(SHEET_ID)).toBe(SHEET_ID);
await expect(client.readQueue(SHEET_ID, "missing")).rejects.toThrow("Sheet tab not found: missing");
await expect(wideClient.readQueue(SHEET_ID, "시트1")).rejects.toThrow("Sheet tables wider than Z are not supported.");
await expect(errorClient.readQueue(SHEET_ID, "시트1")).rejects.toThrow("Google Sheets API 403: permission denied");
await expect(noUpdateClient.writeDone(SHEET_ID, "시트1", 34, 2)).rejects.toThrow("Expected one updated Sheet cell, received 0.");
```

- [ ] **Step 6: Run REST client tests and verify RED**

Run: `pnpm.cmd vitest run tests/sheets/googleSheetsClient.test.ts`

Expected: FAIL because the client does not exist.

- [ ] **Step 7: Implement the minimal REST client**

Use Sheets v4 endpoints under `https://sheets.googleapis.com/v4/spreadsheets`. Metadata requests use `fields=sheets.properties(title,gridProperties(rowCount,columnCount))`. Value reads use encoded A1 ranges and `majorDimension=ROWS`. `writeDone` uses `PUT .../values/<range>?valueInputOption=RAW` with `{ values: [["done"]] }`.

Every request includes `Authorization: Bearer <token>`. API errors expose status and Google error message but never the token or credential path.

- [ ] **Step 8: Run Task 2 tests and the full suite**

Run: `pnpm.cmd vitest run tests/sheets/sheetAuth.test.ts tests/sheets/googleSheetsClient.test.ts`

Run: `pnpm.cmd test`

Expected: all tests PASS.

- [ ] **Step 9: Commit Task 2**

```powershell
git add package.json pnpm-lock.yaml src/sheets/sheetAuth.ts src/sheets/googleSheetsClient.ts tests/sheets/sheetAuth.test.ts tests/sheets/googleSheetsClient.test.ts
git commit -m "feat: add service-account Sheets client"
```

---

### Task 3: Idempotent result synchronization

**Files:**
- Create: `src/sheets/sheetResultSync.ts`
- Create: `tests/sheets/sheetResultSync.test.ts`

**Interfaces:**
- Consumes: `GoogleSheetsClient`, `SheetSource`, `findSheetSources`, and `readPostStatus`
- Produces: `syncCompletedSheetPosts(workspacePath: string, client: GoogleSheetsClient, onLog?: (message: string) => void): Promise<SheetSyncSummary>`
- Produces: `SheetSyncSummary = { synced: number; alreadyDone: number; pending: Array<{ postFolder: string; source: SheetSource }> }`

- [ ] **Step 1: Write failing synchronization tests**

```ts
it("writes done only for a matching draft_saved source", async () => {
  await createLinkedPost(workspace, source, { status: "draft_saved", message: "saved" });
  const client = fakeClient({ keyword: source.keyword, result: "" });
  await expect(syncCompletedSheetPosts(workspace, client)).resolves.toMatchObject({ synced: 1 });
  expect(client.writeDone).toHaveBeenCalledWith(source.spreadsheetId, source.sheetName, source.rowNumber, 2);
});

it("does not write for pending, failed, or needs_review", async () => {
  for (const status of ["pending", "failed", "needs_review"] as const) {
    const isolatedWorkspace = await createWorkspaceWithLinkedPost(source, status);
    const client = fakeClient({ keyword: source.keyword, result: "" });
    await syncCompletedSheetPosts(isolatedWorkspace, client);
    expect(client.writeDone).not.toHaveBeenCalled();
  }
});

it("rejects a changed remote keyword", async () => {
  await createLinkedPost(workspace, source, { status: "draft_saved", message: "saved" });
  const client = fakeClient({ keyword: "changed", result: "" });
  await expect(syncCompletedSheetPosts(workspace, client)).rejects.toThrow("Sheet keyword changed at row 34");
});
```

```ts
it("accepts DONE without another write", async () => {
  const client = fakeClient({ keyword: source.keyword, result: "DONE" });
  await expect(syncCompletedSheetPosts(workspace, client)).resolves.toMatchObject({ alreadyDone: 1 });
  expect(client.writeDone).not.toHaveBeenCalled();
});

it("protects an externally owned result", async () => {
  const client = fakeClient({ keyword: source.keyword, result: "processing" });
  await expect(syncCompletedSheetPosts(workspace, client)).rejects.toThrow("Sheet result is not blank or done at row 34");
});

it("leaves local draft_saved state retryable when the write fails", async () => {
  const client = fakeClient({ keyword: source.keyword, result: "", writeError: new Error("offline") });
  await expect(syncCompletedSheetPosts(workspace, client)).rejects.toThrow("offline");
  await expect(readPostStatus(postFolder)).resolves.toMatchObject({ status: "draft_saved" });
});
```

- [ ] **Step 2: Run synchronization tests and verify RED**

Run: `pnpm.cmd vitest run tests/sheets/sheetResultSync.test.ts`

Expected: FAIL because `sheetResultSync.ts` does not exist.

- [ ] **Step 3: Implement synchronization minimally**

For each manifest, read `status.json`. Only `draft_saved` enters the remote update path. Re-read the exact remote row and resolved keyword/result columns. Compare trimmed keywords exactly. Treat `done` case-insensitively as already synchronized. Write only over a blank result. Return every non-`done` linked item in `pending`, including items without a status file.

- [ ] **Step 4: Run synchronization tests and the full suite**

Run: `pnpm.cmd vitest run tests/sheets/sheetResultSync.test.ts`

Run: `pnpm.cmd test`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add src/sheets/sheetResultSync.ts tests/sheets/sheetResultSync.test.ts
git commit -m "feat: sync confirmed drafts to Sheets"
```

---

### Task 4: One-row `sheet:next` CLI

**Files:**
- Create: `src/cli/sheetNextArgs.ts`
- Create: `src/cli/sheetNextCli.ts`
- Create: `tests/cli/sheetNextArgs.test.ts`
- Create: `tests/cli/sheetNextCli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 queue/manifest functions, Task 2 client, Task 3 synchronization
- Produces: `parseSheetNextArgs(argv: string[]): { workspacePath: string; spreadsheetId: string; sheetName: string }`
- Produces: `sheetNextMain(argv: string[], overrides?: Partial<SheetNextDependencies>): Promise<number>`

- [ ] **Step 1: Write failing argument tests**

```ts
expect(parseSheetNextArgs([
  "--workspace", "C:\\blog-workspace",
  "--sheet-url", SHEET_URL
])).toEqual({
  workspacePath: "C:\\blog-workspace",
  spreadsheetId: SHEET_ID,
  sheetName: "시트1"
});
```

Also reject relative workspaces, non-Sheets URLs, unknown/duplicate options, and missing values; accept `--sheet-name` override.

- [ ] **Step 2: Run argument tests and verify RED**

Run: `pnpm.cmd vitest run tests/cli/sheetNextArgs.test.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement the argument parser**

Follow the strict pair-based option parser pattern in `src/cli/cliArgs.ts`. Default `sheetName` to `시트1` and require an absolute workspace.

- [ ] **Step 4: Write failing CLI behavior tests**

```ts
it("creates one linked folder for the first pending row", async () => {
  const code = await sheetNextMain(args, {
    createClient: () => fakeClientWithRows([["keyword", "result"], ["first", ""], ["second", ""]]),
    syncCompleted: vi.fn(async () => ({ synced: 0, alreadyDone: 0, pending: [] })),
    log
  });
  expect(code).toBe(0);
  expect(await readSheetSource(path.join(workspace, "posts", "000002-first"))).toMatchObject({ rowNumber: 2, keyword: "first" });
  expect(await fs.readdir(path.join(workspace, "posts"))).toHaveLength(1);
});
```

Add one test per remaining branch with these assertions:

```ts
expect(await runWithRows([["keyword", "result"], ["done", "done"]])).toMatchObject({ code: 0, logs: ["No pending sheet rows."] });
expect(await runWithExistingPending()).toMatchObject({ code: 0, createdFolders: 0, logs: [expect.stringContaining("Continue existing Sheet row")] });
expect(await runWithExistingSynchronized()).toMatchObject({ code: 0, createdFolders: 1, selectedRow: 3 });
expect(await runWithFolderCollision()).toMatchObject({ code: 1, errors: [expect.stringContaining("Post folder collision")] });
expect(await runWithClientError(new Error("permission denied"))).toMatchObject({ code: 1, createdFolders: 0, errors: ["permission denied"] });
```

- [ ] **Step 5: Run CLI tests and verify RED**

Run: `pnpm.cmd vitest run tests/cli/sheetNextCli.test.ts`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 6: Implement `sheetNextMain` and entry point**

Create the Sheets client, run synchronization first, and stop with the existing folder path when `summary.pending` is non-empty. Otherwise read and select one row, create only its post folder, atomically write `sheet-source.json`, and log the row, keyword, and absolute folder path. Do not create `content.txt`.

Add scripts:

```json
"sheet:build": "esbuild src/cli/sheetNextCli.ts --bundle --platform=node --format=esm --outfile=dist-cli/sheetNextCli.js",
"sheet:next": "pnpm run sheet:build && node dist-cli/sheetNextCli.js"
```

Add `pnpm run sheet:build` to `build`.

- [ ] **Step 7: Run Task 4 tests and the full suite**

Run: `pnpm.cmd vitest run tests/cli/sheetNextArgs.test.ts tests/cli/sheetNextCli.test.ts`

Run: `pnpm.cmd test`

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git add src/cli/sheetNextArgs.ts src/cli/sheetNextCli.ts tests/cli/sheetNextArgs.test.ts tests/cli/sheetNextCli.test.ts package.json
git commit -m "feat: import the next Sheet keyword"
```

---

### Task 5: Integrate pre/post sync with `draft:run`

**Files:**
- Modify: `src/cli/draftCli.ts`
- Modify: `tests/cli/draftCli.test.ts`

**Interfaces:**
- Consumes: `createGoogleSheetsClient` and `syncCompletedSheetPosts`
- Changes: `CliDependencies` gains `createSheetsClient` and `syncCompletedSheetPosts`
- Preserves: `main(argv, overrides): Promise<number>` and all existing commands

- [ ] **Step 1: Write failing draft CLI integration tests**

```ts
it("syncs linked results before and after a successful run", async () => {
  const sync = vi.fn()
    .mockResolvedValueOnce({ synced: 0, alreadyDone: 0, pending: [] })
    .mockResolvedValueOnce({ synced: 1, alreadyDone: 0, pending: [] });
  const code = await main(runArgs(), {
    loadPosts: vi.fn(async () => [createJob("pending")]),
    applyPolicy: vi.fn(async jobs => jobs),
    attachAutomation: () => createAutomation({ ok: true }),
    runPosts: vi.fn(async () => ({ stopped: false, message: "complete" })),
    syncCompletedSheetPosts: sync,
    createSheetsClient: () => fakeClient()
  });
  expect(code).toBe(0);
  expect(sync).toHaveBeenCalledTimes(2);
});

it("does not require Google credentials for a workspace without Sheet manifests", async () => {
  // Existing local-only run succeeds and createSheetsClient is not called.
});
```

```ts
it("reports a post-run sync failure without removing local draft success", async () => {
  const sync = vi.fn()
    .mockResolvedValueOnce({ synced: 0, alreadyDone: 0, pending: [] })
    .mockRejectedValueOnce(new Error("Sheets offline"));
  const code = await runLinkedDraft({ sync, runResult: { stopped: false, message: "complete" } });
  expect(code).toBe(1);
  await expect(readPostStatus(linkedPostFolder)).resolves.toMatchObject({ status: "draft_saved" });
});

it.each(["editor", "needs_review"] as const)("does not post-sync after %s stop", async (reason) => {
  const sync = vi.fn().mockResolvedValue({ synced: 0, alreadyDone: 0, pending: [] });
  await runLinkedDraft({ sync, runResult: { stopped: true, reason, message: "stopped" } });
  expect(sync).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run draft CLI tests and verify RED**

Run: `pnpm.cmd vitest run tests/cli/draftCli.test.ts`

Expected: FAIL because Sheet synchronization dependencies are not wired.

- [ ] **Step 3: Implement conditional pre/post synchronization**

Detect manifests with `findSheetSources(workspacePath)` before creating a Sheets client. For linked workspaces, pre-sync completed items before `loadPosts`. Run existing validation, login verification, and orchestration unchanged. After a non-stopped result, call synchronization again. Do not swallow sync errors; the local `draft_saved` status enables recovery on the next call.

- [ ] **Step 4: Run Task 5 tests and the full suite**

Run: `pnpm.cmd vitest run tests/cli/draftCli.test.ts tests/sheets/sheetResultSync.test.ts`

Run: `pnpm.cmd test`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 5**

```powershell
git add src/cli/draftCli.ts tests/cli/draftCli.test.ts
git commit -m "feat: complete Sheet rows after draft save"
```

---

### Task 6: Documentation and release verification

**Files:**
- Modify: `docs/tistory-v08-cli-workflow.md`
- Modify: `README.md`
- Modify: `.gitignore` only if a repository-local credential example pattern is documented

**Interfaces:**
- Documents the exact service-account and one-row cycle commands.

- [ ] **Step 1: Add the service-account setup procedure**

Document creating a Google Cloud service account with Sheets API access, downloading the JSON key outside the repository, and sharing the spreadsheet with the service-account email as Editor.

Use this PowerShell example:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\tistory-sheet-service-account.json"
```

- [ ] **Step 2: Document the exact cycle**

```powershell
pnpm.cmd run sheet:next -- --workspace C:\blog-workspace --sheet-url "https://docs.google.com/spreadsheets/d/105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g/edit"
pnpm.cmd run draft:login
pnpm.cmd run draft:verify -- --blog-url https://sample.tistory.com
pnpm.cmd run draft:run -- --workspace C:\blog-workspace --blog-url https://sample.tistory.com --max-posts 1
```

State that Codex creates `content.txt` and images between `sheet:next` and `draft:run`, and that the next `sheet:next` is allowed only after `done` synchronization.

- [ ] **Step 3: Verify documentation terms and secret exclusions**

Run: `rg -n "sheet:next|GOOGLE_APPLICATION_CREDENTIALS|result|done|max-posts 1" README.md docs/tistory-v08-cli-workflow.md`

Run: `git ls-files | Select-String -Pattern "service-account|credentials.*json"`

Expected: commands and safety language are present; no credential JSON file is tracked.

- [ ] **Step 4: Run fresh full verification**

Run: `pnpm.cmd install --frozen-lockfile`

Run: `pnpm.cmd test`

Expected: all test files and tests PASS with zero failures.

Run: `pnpm.cmd run build`

Expected: TypeScript checking, Electron main/preload build, Sheet CLI build, draft CLI build, and Vite renderer build all exit `0`.

Run: `git diff --check`

Expected: exit `0` with no whitespace errors.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md docs/tistory-v08-cli-workflow.md .gitignore
git commit -m "docs: explain the one-row Sheet draft cycle"
```

- [ ] **Step 6: Inspect final repository state**

Run: `git status --short --branch`

Run: `git log --oneline -8`

Expected: clean worktree on `codex/tistory-v08-cli`; implementation commits appear after the design and plan commits.
