# Session Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the logged-in browser open after successful draft runs so newly added post folders can be refreshed and saved in the same session.

**Architecture:** `runPosts` will close the automation engine by default, but accept `closeOnSuccess: false` for the Electron UI flow. The IPC layer will preserve `activeAutomation` after a successful run and only clear/close it on stop, failure, or mismatched automation cleanup. Manual test folders 006, 007, and 008 will contain Korean-only content and avoid divider markers.

**Tech Stack:** TypeScript, Electron IPC, Playwright automation engine contract, Vitest, manual filesystem fixtures.

---

### Task 1: Keep Browser Open After Successful Runs

**Files:**
- Modify: `src/core/runOrchestrator.ts`
- Modify: `src/main/ipc.ts`
- Test: `tests/core/runOrchestrator.test.ts`
- Test: `tests/main/ipc.test.ts`

- [ ] Add a failing `runPosts` test proving `closeOnSuccess: false` does not call `engine.close()` after all pending posts are saved.
- [ ] Add a failing IPC test proving a successful run keeps the active automation available for the next run.
- [ ] Add `closeOnSuccess?: boolean` to `RunOptions` and only close in `finally` unless a successful run requested browser retention.
- [ ] Update `run:start` to pass `closeOnSuccess: false` and keep `activeAutomation` when `result.stopped === false`.
- [ ] Run `pnpm test tests/core/runOrchestrator.test.ts tests/main/ipc.test.ts`.

### Task 2: Korean Continuation Test Folders

**Files:**
- Create/replace: `manual-test-workspaces/stability-suite/006-session-continuation-basic/content.txt`
- Create/replace: `manual-test-workspaces/stability-suite/007-quote-image-continuation/content.txt`
- Create/replace: `manual-test-workspaces/stability-suite/008-multi-marker-continuation/content.txt`
- Create/copy: each folder `images/hero.png`

- [ ] Create 006 with Korean title and plain Korean body only.
- [ ] Create 007 with Korean title, Korean quote, image marker, and Korean text after image.
- [ ] Create 008 with Korean title, Korean quote, Korean image flow, and no `[HR]` marker.
- [ ] Do not create `_SUCCESS.done`, `status.json`, or `run-log.txt` in the new folders.

### Task 3: Verification

**Files:**
- Verify all modified production and test files.

- [ ] Run full `pnpm test`.
- [ ] Run `pnpm run main:build`.
- [ ] Confirm `manual-test-workspaces/` remains untracked unless the user explicitly asks to commit manual fixtures.
