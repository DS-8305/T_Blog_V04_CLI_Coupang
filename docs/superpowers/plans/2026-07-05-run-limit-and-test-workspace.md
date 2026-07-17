# Run Limit And Test Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users run only a selected number of eligible posts and split clean manual test templates from mutable run results.

**Architecture:** Add an optional `maxPosts` run option that limits pending jobs at the orchestrator boundary, expose it through Electron IPC, and add a compact run-count selector in the renderer. Add a local PowerShell utility to copy clean manual test templates into a run workspace while excluding `_SUCCESS.done`, `status.json`, `run-log.txt`, and diagnostics.

**Tech Stack:** TypeScript, Electron IPC, React, Vitest, PowerShell filesystem utility.

---

### Task 1: Run Count Limit

**Files:**
- Modify: `src/core/runOrchestrator.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/global.d.ts`
- Modify: `src/renderer/App.tsx`
- Test: `tests/core/runOrchestrator.test.ts`
- Test: `tests/main/ipc.test.ts`

- [ ] Add tests that `runPosts` processes only `maxPosts` pending jobs.
- [ ] Add IPC tests that `run:start` forwards `maxPosts`.
- [ ] Add renderer control for `전체`, `1개`, `3개`, `5개`.
- [ ] Verify targeted tests pass.

### Task 2: Manual Test Workspace Separation

**Files:**
- Create: `scripts/prepare-manual-test-workspace.ps1`
- Create/modify: `manual-test-workspaces/templates/stability-suite`
- Create/modify: `manual-test-workspaces/runs/stability-suite`
- Modify: `docs/stability-test-procedure.md`

- [ ] Add a script that copies template folders into a run workspace.
- [ ] Exclude runtime artifacts from copied templates and run preparation.
- [ ] Populate templates from the current stable 009-020 test cases.
- [ ] Document that the UI should select `manual-test-workspaces/runs/stability-suite`.

### Task 3: Verification

**Files:**
- Verify all modified files.

- [ ] Run `pnpm test`.
- [ ] Run `pnpm run build`.
- [ ] Report remaining untracked runtime folders separately.
