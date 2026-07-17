# V004 Stability Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the stable NAVER editor automation and browser-session patterns from `N_Blog_Automation_v004` into the Electron/TypeScript V05 app.

**Architecture:** Keep V05 as the source of truth and translate v004 behavior into existing TypeScript modules. Selector constants stay in `src/automation/selectors.ts`; browser/session/editor behavior stays in `src/automation/NaverBlogAutomation.ts`; profile path behavior stays in `src/main/appPaths.ts`.

**Tech Stack:** Electron, TypeScript, Playwright, Vitest.

---

### Task 1: Selector Coverage

**Files:**
- Modify: `src/automation/selectors.ts`
- Test: `tests/automation/naverBlogAutomation.test.ts`

- [ ] Add tests requiring v004-proven SmartEditor selectors for write-ready, title, body, popup close, save, strikethrough, image toolbar, file input, and inserted image markers.
- [ ] Run `pnpm test -- tests/automation/naverBlogAutomation.test.ts` and confirm the new selector expectations fail.
- [ ] Add the missing selector arrays to `src/automation/selectors.ts`.
- [ ] Run the same test and confirm it passes.

### Task 2: Browser Session Robustness

**Files:**
- Modify: `src/automation/NaverBlogAutomation.ts`
- Modify: `src/main/appPaths.ts`
- Test: `tests/automation/naverBlogAutomation.test.ts`
- Test: `tests/main/appPaths.test.ts`

- [ ] Add tests for normalized profile names and session-cookie constants `NID_AUT` / `NID_SES`.
- [ ] Run the tests and confirm they fail.
- [ ] Add profile-name normalization and login cookie constants.
- [ ] Configure persistent Chromium with Korean locale, a larger viewport, and startup args from v004.
- [ ] Run the tests and confirm they pass.

### Task 3: Editor Action Stability

**Files:**
- Modify: `src/automation/NaverBlogAutomation.ts`
- Test: `tests/automation/naverBlogAutomation.test.ts`

- [ ] Add tests documenting that the adapter exposes behavior needed to reset strikethrough, find file inputs, and wait for image insertion markers.
- [ ] Run the tests and confirm they fail.
- [ ] Add body formatting reset before typing body text.
- [ ] Prefer direct image file inputs before file chooser fallback, then wait for inserted-image markers.
- [ ] Add selector-based button clicking before accessible-name fallback for save/image actions.
- [ ] Run the tests and confirm they pass.

### Task 4: Verification

**Files:**
- No source changes expected.

- [ ] Run `pnpm test`.
- [ ] Run `pnpm run main:build`.
- [ ] Inspect `git status --short` and report only relevant changed files.
