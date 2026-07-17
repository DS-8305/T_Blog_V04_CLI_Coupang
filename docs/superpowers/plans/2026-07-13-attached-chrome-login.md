# Attached Chrome Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and run Naver draft automation through the dedicated Chrome window used for manual login, without closing or reopening that browser session.

**Architecture:** `ManualChromeLoginLauncher` starts the dedicated non-default Chrome profile with a loopback CDP port. `NaverBlogAutomation` gains an attached-browser mode that uses `chromium.connectOverCDP` and only detaches on cleanup. `LoginSessionCoordinator` permits verification while the launcher is running and keeps the Chrome window open through the run lifecycle.

**Tech Stack:** Electron 33, TypeScript, Playwright, Vitest, esbuild, Vite.

## Global Constraints

- Bind CDP only to `127.0.0.1:9222`; never expose it to the network.
- Keep the dedicated Chrome profile path; do not copy cookies or use the user's normal Chrome profile.
- Do not retry login, verification, or draft submission automatically after security failures.
- Closing or stopping automation must not close the manually opened Chrome window.
- Keep all new source and documentation ASCII except existing Korean UI strings.
- There is no Git repository in this workspace; omit commit commands.
- Do not use live Naver login or posting as automated verification.

---

### Task 1: Add CDP Endpoint Ownership to the Chrome Launcher

**Files:**
- Modify: `src/main/ManualChromeLoginLauncher.ts`
- Test: `tests/main/manualChromeLoginLauncher.test.ts`

**Interfaces:**
- Consumes: `findChromeExecutable`, `ChromeChildProcess`, `NAVER_HOME_URL`.
- Produces: `MANUAL_CHROME_CDP_ENDPOINT`, `getCdpEndpoint(): string | undefined`, and Chrome launch arguments containing `--remote-debugging-address=127.0.0.1` and `--remote-debugging-port=9222`.

- [ ] **Step 1: Write the failing test**

```ts
await launcher.open("C:\\profile");

expect(spawn).toHaveBeenCalledWith(
  expect.any(String),
  expect.arrayContaining([
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222"
  ]),
  expect.any(Object)
);
expect(launcher.getCdpEndpoint()).toBe("http://127.0.0.1:9222");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/main/manualChromeLoginLauncher.test.ts`

Expected: FAIL because the CDP arguments and endpoint accessor do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export const MANUAL_CHROME_CDP_ENDPOINT = "http://127.0.0.1:9222";

getCdpEndpoint(): string | undefined {
  return this.child ? MANUAL_CHROME_CDP_ENDPOINT : undefined;
}
```

Add the two loopback-only CDP arguments beside the existing `--user-data-dir` argument.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/main/manualChromeLoginLauncher.test.ts`

Expected: PASS.

### Task 2: Attach Automation to the Existing Chrome Context

**Files:**
- Modify: `src/automation/NaverBlogAutomation.ts`
- Test: `tests/automation/naverBlogAutomation.test.ts`

**Interfaces:**
- Consumes: a loopback endpoint from Task 1 and Playwright `chromium.connectOverCDP`.
- Produces: `NaverBlogAutomation.attach(cdpEndpoint)` which uses the existing default context and leaves Chrome open after `close()`.

- [ ] **Step 1: Write the failing tests**

```ts
const engine = NaverBlogAutomation.attach("http://127.0.0.1:9222");

await expect(engine.verifySession()).resolves.toEqual({ ok: true });
expect(playwrightMocks.connectOverCDP).toHaveBeenCalledWith(
  "http://127.0.0.1:9222",
  expect.objectContaining({ noDefaults: true })
);
expect(playwrightMocks.launchPersistentContext).not.toHaveBeenCalled();

await engine.close();
expect(context.close).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/automation/naverBlogAutomation.test.ts`

Expected: FAIL because `attach` and `connectOverCDP` are absent.

- [ ] **Step 3: Write minimal implementation**

```ts
static attach(cdpEndpoint: string): NaverBlogAutomation {
  return new NaverBlogAutomation({ mode: "attached", cdpEndpoint });
}
```

In attached mode, connect with `chromium.connectOverCDP`, select `browser.contexts()[0]`, and create no new context. Track attachment ownership separately from launched-context ownership so `close()` clears references and releases the connection without calling `BrowserContext.close()` or issuing a Chrome shutdown.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/automation/naverBlogAutomation.test.ts`

Expected: PASS.

### Task 3: Change Login Coordination to Require an Open Attached Chrome

**Files:**
- Modify: `src/main/LoginSessionCoordinator.ts`
- Modify: `src/main/ipc.ts`
- Test: `tests/main/loginSessionCoordinator.test.ts`
- Test: `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: `launcher.getCdpEndpoint()` from Task 1 and `NaverBlogAutomation.attach()` from Task 2.
- Produces: verification while Chrome is open, `ready` automation backed by the attached browser, and explicit failure when the Chrome process is absent.

- [ ] **Step 1: Write the failing tests**

```ts
launcher.isRunning.mockReturnValue(true);
launcher.getCdpEndpoint.mockReturnValue("http://127.0.0.1:9222");

const result = await coordinator.verifySession();

expect(result).toMatchObject({ ok: true, snapshot: { state: "ready" } });
expect(createAutomationFactory).toHaveBeenCalledWith("http://127.0.0.1:9222");
```

```ts
launcher.isRunning.mockReturnValue(false);

const result = await coordinator.verifySession();

expect(result.snapshot).toMatchObject({
  state: "unverified",
  message: expect.stringContaining("Chrome")
});
expect(createAutomationFactory).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/main/loginSessionCoordinator.test.ts tests/main/ipc.test.ts`

Expected: FAIL because the coordinator currently rejects an open manual Chrome and constructs automation from a profile path.

- [ ] **Step 3: Write minimal implementation**

```ts
if (!this.launcher.isRunning()) {
  this.state = "unverified";
  this.message = "로그인용 Chrome을 열어 둔 뒤 로그인 확인을 누르세요.";
  return this.failure();
}

const endpoint = this.launcher.getCdpEndpoint();
if (!endpoint) return this.failForUnavailableChrome();
automation = this.createAutomation(endpoint);
```

Update IPC construction to call `NaverBlogAutomation.attach(endpoint)`. Preserve security-hold and run gating behavior. Update messages so the renderer tells the user to keep Chrome open through verification and the run.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/main/loginSessionCoordinator.test.ts tests/main/ipc.test.ts`

Expected: PASS.

### Task 4: Update Renderer Copy and Operational Documentation

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `docs/stability-test-procedure.md`
- Modify: `docs/packaging-prep.md`
- Test: existing main and automation tests from Tasks 1-3.

**Interfaces:**
- Consumes: `manualChromeRunning` and attached-session state from the coordinator.
- Produces: UI text that tells the user to leave Chrome open and documentation matching the new workflow.

- [ ] **Step 1: Write the failing UI-state assertion where renderer coverage exists**

```ts
expect(snapshot.manualChromeRunning).toBe(true);
expect(snapshot.state).toBe("login_open");
```

Use the coordinator state test if the renderer has no isolated test harness; do not introduce a new UI test framework for this copy-only change.

- [ ] **Step 2: Run the relevant test to verify the old close-Chrome wording is still present**

Run: `pnpm test -- tests/main/loginSessionCoordinator.test.ts`

Expected: FAIL after asserting the new keep-Chrome-open message.

- [ ] **Step 3: Write minimal implementation**

Replace close-Chrome instructions with: open the dedicated Chrome, log in, leave it open, verify, start, and leave it open until the run completes. State that stop and app exit do not close the manually opened Chrome.

- [ ] **Step 4: Run the relevant test to verify it passes**

Run: `pnpm test -- tests/main/loginSessionCoordinator.test.ts`

Expected: PASS.

### Task 5: Complete Regression Verification

**Files:**
- Verify: `tests/**/*.test.ts`
- Verify: `dist-main/main.js`, `dist-renderer/index.html`

**Interfaces:**
- Consumes: all changes from Tasks 1-4.
- Produces: a passing local test suite and production build.

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected: all test files pass with no skipped new attached-Chrome coverage.

- [ ] **Step 2: Run the production build**

Run: `pnpm run build`

Expected: TypeScript, main-process bundling, and renderer build all exit with code `0`.

- [ ] **Step 3: Verify runtime boundaries**

Confirm from tests that no attached-mode cleanup calls `BrowserContext.close()` and no test initiates a live Naver login or submission.
