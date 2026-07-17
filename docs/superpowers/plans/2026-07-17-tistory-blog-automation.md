# Tistory Blog Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt `DS-8305/N_Blog_V06` into a Windows Electron application that safely drafts, immediately publishes, or schedules marker-based posts to one configured Tistory blog.

**Architecture:** Preserve the original Electron/React/TypeScript shell, parser/orchestrator boundaries, dedicated Chrome session, logs, and portable packaging. Replace Naver-specific types, selectors, session checks, and editor operations with Tistory adapters, and put a no-resubmit boundary around final publication actions.

**Tech Stack:** Electron 33, React 18, TypeScript 5.7, Playwright 1.49, Vite 6, Vitest 2, pnpm, electron-builder.

## Global Constraints

- Support one Kakao account and one configured `https://<name>.tistory.com` blog URL.
- Never request, enter, persist, or log Kakao credentials.
- Use a dedicated Chrome profile with a loopback-only CDP endpoint and manual login.
- Support `draft`, `public`, and `scheduled`; missing `[PUBLISH]` defaults to `draft`.
- Interpret schedules in `Asia/Seoul` and reject past scheduled times.
- Support `[TITLE]`, `[H2]`, `[BOLD]`, `[HR]`, and `[IMAGE:path]`; reject `[QUOTE]` with migration guidance.
- Require one pre-run confirmation after local and remote validation.
- Never automatically repeat an uncertain final save/publish/schedule action.
- Stop on the first unresolved post and default the run limit to one.
- Do not execute live public or scheduled publication in automated tests.
- Produce a Windows x64 portable `.exe`.

---

### Task 1: Import and Rebrand the Upstream Baseline

**Files:**
- Import: upstream tracked files at repository root
- Modify: `package.json`, `index.html`, `src/renderer/App.tsx`
- Test: `tests/main/viteConfig.test.ts`

**Interfaces:**
- Consumes: approved design in `docs/superpowers/specs/2026-07-17-tistory-blog-automation-design.md`
- Produces: buildable upstream baseline named `Tistory Blog Automation`

- [ ] **Step 1: Add the upstream repository and import its tracked tree**

```powershell
git remote add upstream https://github.com/DS-8305/N_Blog_V06.git
git fetch upstream main
git restore --source=upstream/main --staged --worktree .
```

- [ ] **Step 2: Run the untouched upstream test suite**

Run: `pnpm install --frozen-lockfile; pnpm test`
Expected: all imported baseline tests pass before Tistory changes.

- [ ] **Step 3: Rebrand package and shell strings**

Set `package.json` fields to:

```json
{
  "name": "tistory-blog-auto-v01",
  "description": "Tistory Blog draft, publish, and schedule automation desktop application",
  "build": {
    "appId": "com.ds8305.tistoryblogv01",
    "productName": "Tistory Blog Automation"
  }
}
```

Also change the page title and visible application heading from Naver to Tistory without changing behavior yet.

- [ ] **Step 4: Verify and commit the imported baseline**

Run: `pnpm test; pnpm run build`
Expected: tests and production build pass.

```powershell
git add .
git commit -m "chore: import and rebrand blog automation baseline"
```

### Task 2: Define Tistory Post Types and Marker Parser

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/core/parser.ts`
- Modify: `tests/core/parser.test.ts`

**Interfaces:**
- Produces: `PublicationMode`, `PostMetadata`, `EditorEvent`, `ParsedPost`, and `parseContent(content, postFolder, now?)`
- Consumes: local post folder path for image resolution

- [ ] **Step 1: Write failing parser tests**

Add tests asserting this input produces metadata and ordered H2/bold/divider/image events:

```ts
const parsed = parseContent(`[TITLE]제목[/TITLE]
[PUBLISH]scheduled[/PUBLISH]
[CATEGORY]여행[/CATEGORY]
[TAGS]서울, 맛집[/TAGS]
[SCHEDULE]2026-07-20 09:00[/SCHEDULE]
[H2]소제목[/H2]
본문
[BOLD]강조[/BOLD]
[HR]
[IMAGE:images/hero.png]`, postFolder, new Date("2026-07-17T00:00:00+09:00"));

expect(parsed.metadata).toEqual({
  publication: "scheduled",
  category: "여행",
  tags: ["서울", "맛집"],
  scheduledAt: "2026-07-20T09:00:00+09:00"
});
expect(parsed.events.map((event) => event.type)).toEqual([
  "setTitle", "typeHeading1", "typeText", "typeBold", "insertDivider", "insertImage"
]);
```

Add focused tests for default `draft`, missing scheduled time, past time, schedule on a non-scheduled post, malformed metadata, and `[QUOTE]` returning `unsupported_quote` with `[H2]` guidance.

- [ ] **Step 2: Run parser tests and verify RED**

Run: `pnpm vitest run tests/core/parser.test.ts`
Expected: FAIL because Tistory metadata and `typeHeading1` do not exist.

- [ ] **Step 3: Implement the minimal domain model and parser**

Define these exact shapes:

```ts
export type PublicationMode = "draft" | "public" | "scheduled";
export type PostMetadata = {
  publication: PublicationMode;
  category: string | null;
  tags: string[];
  scheduledAt: string | null;
};
export type EditorEvent =
  | { type: "setTitle"; text: string }
  | { type: "typeText"; text: string }
  | { type: "typeHeading1"; text: string }
  | { type: "typeBold"; text: string }
  | { type: "insertDivider" }
  | { type: "insertImage"; relativePath: string; absolutePath: string };
export type ParsedPost = {
  title: string;
  metadata: PostMetadata;
  events: EditorEvent[];
  errors: ValidationError[];
};
```

Parse metadata before body tokenization, remove metadata blocks from the body, normalize schedules to explicit `+09:00`, and preserve source event order.

- [ ] **Step 4: Run parser tests and commit**

Run: `pnpm vitest run tests/core/parser.test.ts`
Expected: PASS.

```powershell
git add src/shared/types.ts src/core/parser.ts tests/core/parser.test.ts
git commit -m "feat: parse Tistory publication metadata and headings"
```

### Task 3: Extend Post Loading, Status, and Review Resolution

**Files:**
- Modify: `src/core/postLoader.ts`, `src/core/statusStore.ts`, `src/shared/types.ts`
- Modify: `tests/core/postLoader.test.ts`, `tests/core/statusStore.test.ts`

**Interfaces:**
- Produces: terminal statuses `draft_saved | published | scheduled`, uncertain status `needs_review`, and `resolveReview(job, outcome)`
- Consumes: `ParsedPost.metadata` from Task 2

- [ ] **Step 1: Write failing status and loader tests**

```ts
expect(await loadPosts(workspace)).toEqual([
  expect.objectContaining({ id: "002-pending", status: "pending" })
]);
await resolveReview(job, "not_created");
expect(JSON.parse(await readFile(statusPath, "utf8"))).toMatchObject({ status: "pending" });
```

Cover exclusion of `draft_saved`, `published`, and `scheduled`; blocking of `needs_review`; `already_created` mapping to the requested terminal status; and append-only review audit messages.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run tests/core/postLoader.test.ts tests/core/statusStore.test.ts`
Expected: FAIL on missing statuses and review resolver.

- [ ] **Step 3: Implement status persistence and review resolution**

Add:

```ts
export type PostStatus = "pending" | "validation_error" | "running" |
  "draft_saved" | "published" | "scheduled" | "needs_review" | "failed" | "stopped";
export type ReviewOutcome = "already_created" | "not_created";
export async function resolveReview(job: PostJob, outcome: ReviewOutcome): Promise<void>;
```

Persist publication mode, timestamps, message, and optional confirmed URL/ID. Refuse review resolution unless the current persisted status is `needs_review`.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm vitest run tests/core/postLoader.test.ts tests/core/statusStore.test.ts`
Expected: PASS.

```powershell
git add src/core src/shared/types.ts tests/core
git commit -m "feat: add Tistory publication and review statuses"
```

### Task 4: Add Target Blog Configuration and IPC

**Files:**
- Create: `src/core/blogConfig.ts`, `tests/core/blogConfig.test.ts`
- Modify: `src/main/appPaths.ts`, `src/main/ipc.ts`, `src/main/preload.ts`, `src/renderer/global.d.ts`
- Modify: `tests/main/appPaths.test.ts`, `tests/main/ipc.test.ts`

**Interfaces:**
- Produces: `normalizeTistoryBlogUrl`, `readBlogConfig`, `writeBlogConfig`; IPC methods `getBlogConfig`, `saveBlogConfig`, `resolveReview`

- [ ] **Step 1: Write failing configuration tests**

```ts
expect(normalizeTistoryBlogUrl("sample.tistory.com/")).toBe("https://sample.tistory.com");
expect(() => normalizeTistoryBlogUrl("https://example.com")).toThrow(/tistory\.com/);
```

Test atomic JSON persistence and IPC argument validation.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run tests/core/blogConfig.test.ts tests/main/appPaths.test.ts tests/main/ipc.test.ts`
Expected: FAIL because blog configuration APIs do not exist.

- [ ] **Step 3: Implement configuration and bridge methods**

Use this public shape:

```ts
export type BlogConfig = { blogUrl: string };
export function normalizeTistoryBlogUrl(value: string): string;
export async function readBlogConfig(configPath: string): Promise<BlogConfig | null>;
export async function writeBlogConfig(configPath: string, config: BlogConfig): Promise<void>;
```

Accept only HTTPS root URLs whose hostname is exactly `tistory.com` or ends with `.tistory.com`; reject credentials, query strings, fragments, and non-root paths.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run tests/core/blogConfig.test.ts tests/main/appPaths.test.ts tests/main/ipc.test.ts`
Expected: PASS.

```powershell
git add src/core/blogConfig.ts src/main src/renderer/global.d.ts tests/core/blogConfig.test.ts tests/main
git commit -m "feat: persist one Tistory blog target"
```

### Task 5: Replace Naver Login Verification with Tistory Session Verification

**Files:**
- Rename: `src/main/LoginSessionCoordinator.ts` to `src/main/TistorySessionCoordinator.ts`
- Rename: `src/automation/NaverBlogAutomation.ts` to `src/automation/TistoryBlogAutomation.ts`
- Create: `src/automation/tistorySelectors.ts`
- Modify: `src/main/ManualChromeLoginLauncher.ts`, `src/main/ipc.ts`, `src/main/main.ts`
- Rename tests to matching Tistory names

**Interfaces:**
- Produces: `verifySession(blogUrl): Promise<SessionVerificationResult>` and attached Tistory automation factory

- [ ] **Step 1: Write failing session tests**

Test that verification opens `${blogUrl}/manage/newpost`, recognizes editor readiness, returns `missing` for a visible Kakao login surface, returns `security` for CAPTCHA/security evidence, and returns `profile_error` for inaccessible target blogs.

```ts
expect(await coordinator.verifyLogin()).toEqual(expect.objectContaining({
  ok: false,
  snapshot: expect.objectContaining({ state: "security_hold" })
}));
```

- [ ] **Step 2: Run session tests and verify RED**

Run: `pnpm vitest run tests/main/tistorySessionCoordinator.test.ts tests/main/manualChromeLoginLauncher.test.ts`
Expected: FAIL until renamed Tistory coordinator and selectors exist.

- [ ] **Step 3: Implement Tistory verification**

Keep the loopback CDP address, dedicated profile, manual login, attach-only reuse, and detach-without-closing behavior. Replace Naver URLs/cookies with visible Tistory/Kakao page evidence and target-blog write-access verification; do not infer login from a single cookie.

- [ ] **Step 4: Run session tests and commit**

Run: `pnpm vitest run tests/main/tistorySessionCoordinator.test.ts tests/main/manualChromeLoginLauncher.test.ts`
Expected: PASS.

```powershell
git add src/main src/automation tests/main
git commit -m "feat: verify dedicated Tistory login sessions"
```

### Task 6: Implement Tistory Basic-Editor Event Execution

**Files:**
- Modify: `src/automation/TistoryBlogAutomation.ts`, `src/automation/tistorySelectors.ts`
- Create: `tests/automation/tistoryBlogAutomation.test.ts`

**Interfaces:**
- Consumes: `PostJob.parsed.events`
- Produces: stable editor operations for title, paragraph, heading1, bold, divider, and image

- [ ] **Step 1: Write failing mocked-Playwright tests**

For each event, assert ordered editor calls. For H2, assert a separate block is typed and Tistory `제목1` is selected. For images, assert file input assignment and rendered-image readiness before continuing.

```ts
await automation.executeEvent({ type: "typeHeading1", text: "소제목" }, speed);
expect(actions).toEqual(["focus-body", "type:소제목", "select-format:제목1", "new-block"]);
```

- [ ] **Step 2: Run automation tests and verify RED**

Run: `pnpm vitest run tests/automation/tistoryBlogAutomation.test.ts`
Expected: FAIL on missing Tistory editor operations.

- [ ] **Step 3: Implement selector-isolated editor operations**

Keep selector arrays in `tistorySelectors.ts`; expose internal operations through testable methods, prefer roles/labels and stable attributes, and wait on semantic outcomes after toolbar actions. Ensure every block leaves the caret in a known next-body position.

- [ ] **Step 4: Run automation tests and commit**

Run: `pnpm vitest run tests/automation/tistoryBlogAutomation.test.ts`
Expected: PASS.

```powershell
git add src/automation tests/automation/tistoryBlogAutomation.test.ts
git commit -m "feat: enter marker events in Tistory editor"
```

### Task 7: Implement Categories, Tags, and Safe Final Actions

**Files:**
- Modify: `src/automation/TistoryBlogAutomation.ts`, `src/automation/tistorySelectors.ts`, `src/shared/types.ts`
- Modify: `tests/automation/tistoryBlogAutomation.test.ts`

**Interfaces:**
- Produces: `listCategories`, `applyMetadata`, `finalizePost`
- Returns: `{ outcome: "confirmed"; status; postUrl? } | { outcome: "uncertain"; message }`

- [ ] **Step 1: Write failing publication tests**

Cover default category, named category, comma-separated tags, draft save, immediate public publish, scheduled public publish, confirmed URL capture, and timeout after final click returning `uncertain` without a second click.

```ts
const result = await automation.finalizePost(job);
expect(result).toEqual({ outcome: "uncertain", message: expect.any(String) });
expect(finalButton.click).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run automation tests and verify RED**

Run: `pnpm vitest run tests/automation/tistoryBlogAutomation.test.ts`
Expected: FAIL on missing metadata and finalization methods.

- [ ] **Step 3: Implement metadata and publication outcome verification**

Define:

```ts
export type AutomationResult =
  | { outcome: "confirmed"; status: "draft_saved" | "published" | "scheduled"; postUrl?: string }
  | { outcome: "uncertain"; message: string };
```

Treat a click as an irreversible boundary. Verify via Tistory success UI, navigation, or post identifier; never call the final action again after the first successful dispatch.

- [ ] **Step 4: Run automation tests and commit**

Run: `pnpm vitest run tests/automation/tistoryBlogAutomation.test.ts`
Expected: PASS.

```powershell
git add src/automation src/shared/types.ts tests/automation
git commit -m "feat: finalize Tistory drafts publications and schedules"
```

### Task 8: Enforce Orchestration Safety and Remote Preflight

**Files:**
- Modify: `src/core/runOrchestrator.ts`, `src/main/ipc.ts`, `src/shared/types.ts`
- Modify: `tests/core/runOrchestrator.test.ts`, `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: configured blog URL, confirmed category set, and `AutomationResult`
- Produces: first-failure stop, `needs_review`, safe stop, and confirmation token invalidation

- [ ] **Step 1: Write failing orchestrator tests**

Test maximum-one default, category mismatch exclusion, bounded pre-final retries, no retry for `uncertain`, `needs_review` persistence, stop-before-next-post, and confirmation invalidation after workspace/config changes.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run tests/core/runOrchestrator.test.ts tests/main/ipc.test.ts`
Expected: FAIL on missing preflight and uncertain-result handling.

- [ ] **Step 3: Implement orchestration rules**

Use an opaque confirmation token derived from the validated workspace snapshot, blog URL, post IDs, metadata, and category list. `startRun` must reject missing or stale tokens. Persist `needs_review` immediately for uncertain results and return without processing another post.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm vitest run tests/core/runOrchestrator.test.ts tests/main/ipc.test.ts`
Expected: PASS.

```powershell
git add src/core/runOrchestrator.ts src/main/ipc.ts src/shared/types.ts tests/core/runOrchestrator.test.ts tests/main/ipc.test.ts
git commit -m "feat: guard Tistory runs and uncertain submissions"
```

### Task 9: Build the Tistory Control UI and Confirmation Dialog

**Files:**
- Modify: `src/renderer/App.tsx`, `src/renderer/styles.css`, `src/renderer/global.d.ts`, `src/main/preload.ts`
- Create: `tests/renderer/appState.test.ts`

**Interfaces:**
- Consumes: IPC configuration, login snapshot, remote preflight, post list, review resolution, and run log
- Produces: blog configuration UI, publication summary, explicit confirmation, and needs-review controls

- [ ] **Step 1: Write failing pure state tests**

Extract and test summary and gating functions:

```ts
expect(canStartRun({ login: "ready", validPosts: 1, confirmed: true, stale: false })).toBe(true);
expect(buildPublicationSummary(posts)).toMatchObject({ draft: 1, public: 1, scheduled: 1 });
```

- [ ] **Step 2: Run UI state tests and verify RED**

Run: `pnpm vitest run tests/renderer/appState.test.ts`
Expected: FAIL because the state helpers do not exist.

- [ ] **Step 3: Implement the UI**

Add one-time blog URL editing, Korean Tistory labels, publication/category/schedule columns, warning styling for public/scheduled rows, modal-like confirmation, default run limit `1`, stale-confirmation invalidation, and `already created` / `not created` controls visible only for `needs_review`.

- [ ] **Step 4: Run UI and full tests, then commit**

Run: `pnpm vitest run tests/renderer/appState.test.ts; pnpm test`
Expected: PASS.

```powershell
git add src/renderer src/main/preload.ts tests/renderer
git commit -m "feat: add Tistory publication controls and confirmation"
```

### Task 10: Documentation, Packaging, and Final Verification

**Files:**
- Modify: `package.json`, `run-dev.bat`, `docs/manual-test-checklist.md`, `docs/packaging-prep.md`
- Create: `README.md`
- Modify: relevant packaging tests

**Interfaces:**
- Produces: reproducible development instructions, manual safety checklist, and Windows portable artifact

- [ ] **Step 1: Update packaging assertions before configuration**

Assert `productName`, `appId`, and artifact name are Tistory-specific and no runtime/package string retains Naver branding.

- [ ] **Step 2: Run packaging tests and verify RED**

Run: `pnpm vitest run tests/main/viteConfig.test.ts`
Expected: FAIL until all packaging metadata and names are updated.

- [ ] **Step 3: Write operator documentation and packaging configuration**

Document installation, workspace layout, all markers, login flow, blog URL validation, confirmation, three publication modes, `needs_review` resolution, diagnostics, and the rule that live public/scheduled smoke tests require explicit approval.

Set the artifact pattern to:

```json
"artifactName": "Tistory-Blog-Automation-${version}-portable.${ext}"
```

- [ ] **Step 4: Run final automated verification**

Run: `pnpm test; pnpm run build; pnpm run dist:portable`
Expected: all tests pass, production build succeeds, and one x64 portable executable appears under `release/`.

- [ ] **Step 5: Inspect the final diff and commit**

Run: `git diff --check; rg -n "Naver|NAVER|naver" src tests package.json index.html README.md`
Expected: diff check passes and branding scan returns no unintended Naver runtime references.

```powershell
git add package.json run-dev.bat README.md docs tests
git commit -m "docs: package and document Tistory automation"
```

- [ ] **Step 6: Perform only the non-publishing manual smoke test**

Open the portable app, select a fixture workspace, save a valid Tistory URL, open the dedicated Chrome window, and verify that no public or scheduled submission occurs without a separate explicit user approval. Record live draft/public/scheduled checks as pending until the user authorizes them.
