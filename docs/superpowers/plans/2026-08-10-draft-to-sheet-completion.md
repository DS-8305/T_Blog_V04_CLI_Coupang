# Draft-to-Sheet Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require confirmed Tistory draft save and confirmed Sheet `done` read-back before a linked CLI run reports success.

**Architecture:** Add a local Sheet completion checkpoint. The synchronization layer persists `awaiting_sheet_done`, performs an exact remote read-back after writing, then persists `sheet_done`; the CLI treats any remaining checkpoint as an incomplete run.

**Tech Stack:** TypeScript, Node.js filesystem promises, Vitest, Google Sheets REST client.

## Global Constraints

- Keep Chrome open using `closeEngine: false`.
- Treat the run as complete only after exact result-cell read-back equals `done` case-insensitively.
- Retrying a Sheet error must not recreate a confirmed Tistory draft.

---

### Task 1: Persist Sheet completion checkpoints

**Files:**
- Create: `src/sheets/sheetCompletionCheckpoint.ts`
- Create: `tests/sheets/sheetCompletionCheckpoint.test.ts`

**Interfaces:**
- Produces `readSheetCompletionCheckpoint(postFolder)` and `writeSheetCompletionCheckpoint(postFolder, checkpoint)`.
- Checkpoint shape: `{ version: 1; state: "awaiting_sheet_done" | "sheet_done"; updatedAt: string; rowNumber: number }`.

- [ ] **Step 1: Write the failing test**

```ts
it("persists and reloads a sheet_done checkpoint", async () => {
  await writeSheetCompletionCheckpoint(folder, { version: 1, state: "sheet_done", updatedAt: "2026-08-10T00:00:00.000Z", rowNumber: 49 });
  await expect(readSheetCompletionCheckpoint(folder)).resolves.toMatchObject({ state: "sheet_done", rowNumber: 49 });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd exec vitest run tests/sheets/sheetCompletionCheckpoint.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimally**

Write `sheet-completion.json` with `fs.writeFile`; return `undefined` only when its read fails with `ENOENT`, and reject malformed checkpoints.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm.cmd exec vitest run tests/sheets/sheetCompletionCheckpoint.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/sheets/sheetCompletionCheckpoint.ts tests/sheets/sheetCompletionCheckpoint.test.ts; git commit -m "feat: persist sheet completion checkpoints"`

### Task 2: Read back Sheet done before terminal checkpoint

**Files:**
- Modify: `src/sheets/sheetResultSync.ts`
- Modify: `tests/sheets/sheetResultSync.test.ts`

**Interfaces:**
- Consumes the checkpoint reader and writer from Task 1.
- Produces `sheet_done` only after `readSourceRow` returns result `done` after `writeDone`.

- [ ] **Step 1: Write the failing tests**

```ts
it("writes sheet_done only after reading back done", async () => {
  await syncCompletedSheetPosts(workspace, fakeClient({ before: "", after: "done" }));
  await expect(readSheetCompletionCheckpoint(postFolder)).resolves.toMatchObject({ state: "sheet_done" });
});

it("keeps awaiting_sheet_done when read-back is blank", async () => {
  await expect(syncCompletedSheetPosts(workspace, fakeClient({ before: "", after: "" }))).rejects.toThrow("did not confirm done");
  await expect(readSheetCompletionCheckpoint(postFolder)).resolves.toMatchObject({ state: "awaiting_sheet_done" });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd exec vitest run tests/sheets/sheetResultSync.test.ts`

Expected: FAIL because synchronization has no read-back or checkpoint.

- [ ] **Step 3: Implement minimally**

When `draft_saved` is found, write `awaiting_sheet_done`. After `writeDone`, call `readSourceRow` again and require `done`; write `sheet_done` only then. For a pre-existing `done`, write `sheet_done` directly. Throw `Sheet row <row> did not confirm done after write` when verification fails.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm.cmd exec vitest run tests/sheets/sheetResultSync.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/sheets/sheetResultSync.ts tests/sheets/sheetResultSync.test.ts src/sheets/sheetCompletionCheckpoint.ts; git commit -m "fix: verify sheet completion after draft save"`

### Task 3: Fail the CLI while linked Sheet completion is pending

**Files:**
- Modify: `src/cli/draftCli.ts`
- Modify: `tests/cli/draftCli.test.ts`

**Interfaces:**
- Consumes `syncCompletedSheetPosts(workspacePath, client, log)`.
- Produces exit code `1` when selected linked posts still await Sheet completion.

- [ ] **Step 1: Write the failing test**

```ts
it("returns failure when linked sheet completion remains pending", async () => {
  const code = await main(runArgs(workspace), {
    findSheetSources: async () => [linkedSource],
    syncCompletedSheetPosts: async () => ({ synced: 0, alreadyDone: 0, pending: [linkedSource] }),
    runPosts: async () => ({ stopped: false, message: "All eligible Tistory posts completed" })
  });
  expect(code).toBe(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd exec vitest run tests/cli/draftCli.test.ts`

Expected: FAIL because the current CLI returns `0` after the Tistory run.

- [ ] **Step 3: Implement minimally**

Inspect the second synchronization summary. If a linked post remains in `pending`, throw `Sheet completion pending for row <rowNumber>; retry this command to resume the done write.` Preserve `closeEngine: false`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm.cmd exec vitest run tests/cli/draftCli.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/cli/draftCli.ts tests/cli/draftCli.test.ts; git commit -m "fix: require sheet completion before cli success"`

### Task 4: Full verification

**Files:**
- Modify: none unless verification exposes a defect.

- [ ] **Step 1: Run all tests**

Run: `pnpm.cmd test`

Expected: exit code `0` with all Vitest files passing.

- [ ] **Step 2: Run production build**

Run: `pnpm.cmd run build`

Expected: exit code `0`.

- [ ] **Step 3: Inspect scope**

Run: `git diff --check; git status --short`

Expected: no whitespace errors and only scoped files plus the pre-existing `src/core/postLoader.ts` change.
