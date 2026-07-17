# Naver Login Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate manual Naver login from Playwright automation, require one explicit session verification before drafting, persist a security hold, and remove automatic full-post retries.

**Architecture:** A normal installed Chrome process owns the dedicated profile during manual login. After that process exits, `LoginSessionCoordinator` performs one Playwright verification through `NaverBlogAutomation`, retains the verified context, and authorizes `run:start`; any captcha or security evidence creates a persisted hold. Renderer controls mirror this main-process state but never authorize execution themselves.

**Tech Stack:** Electron 33, TypeScript 5.7, Playwright 1.49, React 18, Vitest 2, Node.js 22

## Global Constraints

- Never automate credentials, captcha entry, or security-verification interaction.
- Normal Chrome and Playwright must never use the dedicated profile concurrently.
- Session verification performs at most one Naver Home navigation and never retries.
- A draft post receives exactly one `saveDraft` call.
- `security_hold` persists across application restarts and requires explicit user clearing.
- Live Naver login or draft execution is excluded from automated verification.
- Git is not installed in the current environment. Run the listed commit commands only after Git becomes available; do not block implementation verification on commits.

---

## File Structure

- Create `src/main/ManualChromeLoginLauncher.ts`: find installed Chrome, launch the dedicated profile, and track process exit.
- Create `src/main/LoginSessionCoordinator.ts`: own login state, Playwright handoff, and persisted security hold.
- Create `src/automation/sessionEvidence.ts`: classify collected Naver session evidence without browser dependencies.
- Modify `src/shared/types.ts`: define renderer-safe login state and result contracts.
- Modify `src/automation/AutomationEngine.ts`: replace manual login API with one-shot session verification.
- Modify `src/automation/NaverBlogAutomation.ts`: gather session evidence, retain verified context, and avoid pre-run login navigation.
- Modify `src/main/appPaths.ts`: expose the persisted security-hold path.
- Modify `src/main/ipc.ts`: wire login state commands and enforce `ready` in the main process.
- Modify `src/main/preload.ts` and `src/renderer/global.d.ts`: expose typed login commands.
- Modify `src/renderer/App.tsx`: show login state, split login and verification, default to one post, and gate Start.
- Modify `src/core/runOrchestrator.ts`: remove full-post retry loop.
- Create `tests/main/manualChromeLoginLauncher.test.ts`, `tests/main/loginSessionCoordinator.test.ts`, and `tests/automation/sessionEvidence.test.ts`.
- Modify `tests/main/ipc.test.ts`, `tests/core/runOrchestrator.test.ts`, and `tests/automation/naverBlogAutomation.test.ts`.

---

### Task 1: Shared Login Contract and Session Evidence Classifier

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/automation/sessionEvidence.ts`
- Create: `tests/automation/sessionEvidence.test.ts`

**Interfaces:**
- Produces: `LoginState`, `LoginStateSnapshot`, `LoginActionResult`, `SessionVerificationResult`.
- Produces: `classifySessionEvidence(evidence): "authenticated" | "missing" | "security"`.

- [ ] **Step 1: Write the failing evidence-classification tests**

```ts
import { describe, expect, it } from "vitest";
import { classifySessionEvidence } from "../../src/automation/sessionEvidence";

describe("classifySessionEvidence", () => {
  it("classifies complete cookies without login or security UI as authenticated", () => {
    expect(classifySessionEvidence({
      url: "https://www.naver.com/",
      hasRequiredCookies: true,
      loginFormVisible: false,
      securityRequirementVisible: false
    })).toBe("authenticated");
  });

  it("classifies an ordinary missing login as missing", () => {
    expect(classifySessionEvidence({
      url: "https://nid.naver.com/nidlogin.login",
      hasRequiredCookies: false,
      loginFormVisible: true,
      securityRequirementVisible: false
    })).toBe("missing");
  });

  it("gives security evidence priority over cookies and login UI", () => {
    expect(classifySessionEvidence({
      url: "https://nid.naver.com/nidlogin.login",
      hasRequiredCookies: true,
      loginFormVisible: true,
      securityRequirementVisible: true
    })).toBe("security");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test -- tests/automation/sessionEvidence.test.ts`

Expected: FAIL because `src/automation/sessionEvidence.ts` does not exist.

- [ ] **Step 3: Add shared types and the minimal classifier**

```ts
export type LoginState = "unverified" | "login_open" | "checking" | "ready" | "security_hold";

export type LoginStateSnapshot = {
  state: LoginState;
  message: string;
  manualChromeRunning: boolean;
};

export type LoginActionResult = {
  ok: boolean;
  snapshot: LoginStateSnapshot;
};

export type SessionVerificationResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "security" | "profile_error"; message: string };
```

```ts
export type SessionEvidence = {
  url: string;
  hasRequiredCookies: boolean;
  loginFormVisible: boolean;
  securityRequirementVisible: boolean;
};

export function classifySessionEvidence(evidence: SessionEvidence) {
  if (evidence.securityRequirementVisible) return "security" as const;
  if (
    !evidence.hasRequiredCookies
    || evidence.loginFormVisible
    || evidence.url.includes("nid.naver.com")
    || evidence.url.includes("nidlogin.login")
  ) return "missing" as const;
  return "authenticated" as const;
}
```

- [ ] **Step 4: Run the focused test and full type check**

Run: `pnpm test -- tests/automation/sessionEvidence.test.ts`

Expected: 3 tests PASS.

Run: `pnpm run build`

Expected: build succeeds.

- [ ] **Step 5: Commit when Git is available**

```powershell
git add src/shared/types.ts src/automation/sessionEvidence.ts tests/automation/sessionEvidence.test.ts
git commit -m "feat: classify naver login session evidence"
```

### Task 2: Normal Chrome Manual Login Launcher

**Files:**
- Create: `src/main/ManualChromeLoginLauncher.ts`
- Create: `tests/main/manualChromeLoginLauncher.test.ts`

**Interfaces:**
- Produces: `findChromeExecutable(env, canAccess): Promise<string>`.
- Produces: `ManualChromeLoginLauncher.open(profilePath): Promise<void>` and `isRunning(): boolean`.
- Consumes: dedicated profile path and `NAVER_HOME_URL`.

- [ ] **Step 1: Write failing tests for path resolution, arguments, and lifecycle**

```ts
it("prefers per-user installed Chrome and launches the dedicated profile", async () => {
  const spawn = vi.fn(() => fakeChild);
  const launcher = new ManualChromeLoginLauncher({
    env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
    canAccess: async (candidate) => candidate.includes("Local\\Google\\Chrome"),
    spawn
  });

  await launcher.open("C:\\profile");

  expect(spawn).toHaveBeenCalledWith(
    "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    ["--user-data-dir=C:\\profile", "--no-first-run", "--no-default-browser-check", NAVER_HOME_URL],
    expect.objectContaining({ stdio: "ignore", windowsHide: false })
  );
  expect(launcher.isRunning()).toBe(true);
});

it("clears running state when Chrome exits", async () => {
  await launcher.open("C:\\profile");
  fakeChild.emit("exit", 0);
  expect(launcher.isRunning()).toBe(false);
});

it("refuses to open a second manual Chrome process", async () => {
  await launcher.open("C:\\profile");
  await expect(launcher.open("C:\\profile")).rejects.toThrow("already open");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test -- tests/main/manualChromeLoginLauncher.test.ts`

Expected: FAIL because `ManualChromeLoginLauncher` does not exist.

- [ ] **Step 3: Implement Chrome resolution and tracked launch**

Use `node:child_process.spawn`, `node:fs/promises.access`, and these Windows candidates in order:

```ts
[
  path.join(env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe")
]
```

The launcher must retain the child reference, clear it on `exit` or `error`, and never call `kill()`.

- [ ] **Step 4: Run launcher tests**

Run: `pnpm test -- tests/main/manualChromeLoginLauncher.test.ts`

Expected: all launcher tests PASS and no real Chrome process starts.

- [ ] **Step 5: Commit when Git is available**

```powershell
git add src/main/ManualChromeLoginLauncher.ts tests/main/manualChromeLoginLauncher.test.ts
git commit -m "feat: open manual login in normal chrome"
```

### Task 3: Persisted Login Session Coordinator

**Files:**
- Modify: `src/main/appPaths.ts`
- Create: `src/main/LoginSessionCoordinator.ts`
- Create: `tests/main/loginSessionCoordinator.test.ts`
- Modify: `tests/main/appPaths.test.ts`

**Interfaces:**
- Consumes: `ManualChromeLoginLauncher`, a factory returning `Omit<AutomationEngine, "openLoginWindow"> & { verifySession(): Promise<SessionVerificationResult> }`, profile path, and hold-file path. This narrow structural contract keeps Task 3 compilable before Task 4 replaces `openLoginWindow` on `AutomationEngine`.
- Produces: `initialize()`, `getState()`, `openManualLogin()`, `verifySession()`, `requireReadyAutomation()`, `enterSecurityHold(message)`, `clearSecurityHold()`, and `close()`.

- [ ] **Step 1: Write failing coordinator tests**

Cover these exact behaviors:

```ts
it("blocks verification while manual Chrome is running", async () => {
  launcher.isRunning.mockReturnValue(true);
  const result = await coordinator.verifySession();
  expect(result.ok).toBe(false);
  expect(result.snapshot.state).toBe("login_open");
  expect(createAutomation).not.toHaveBeenCalled();
});

it("retains the verified automation and enters ready", async () => {
  automation.verifySession.mockResolvedValue({ ok: true });
  const result = await coordinator.verifySession();
  expect(result.snapshot.state).toBe("ready");
  expect(coordinator.requireReadyAutomation()).toBe(automation);
});

it("persists security hold and closes verification automation", async () => {
  automation.verifySession.mockResolvedValue({ ok: false, reason: "security", message: "Security verification required" });
  const result = await coordinator.verifySession();
  expect(result.snapshot.state).toBe("security_hold");
  expect(automation.close).toHaveBeenCalledOnce();
  await expect(fs.readFile(holdPath, "utf8")).resolves.toContain("Security verification required");
});

it("restores security hold on initialize and clears only explicitly", async () => {
  await fs.writeFile(holdPath, JSON.stringify({ heldAt: new Date().toISOString(), message: "held" }));
  await coordinator.initialize();
  expect(coordinator.getState().state).toBe("security_hold");
  await coordinator.clearSecurityHold();
  expect(coordinator.getState().state).toBe("unverified");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test -- tests/main/loginSessionCoordinator.test.ts tests/main/appPaths.test.ts`

Expected: FAIL because coordinator and `getSecurityHoldPath()` do not exist.

- [ ] **Step 3: Implement the coordinator state machine**

`verifySession()` must create at most one automation instance and invoke `automation.verifySession()` exactly once. Map results as follows:

```text
ok -> ready, retain automation
missing -> unverified, close automation
security -> security_hold, persist hold, close automation
profile_error -> unverified, close automation
```

`openManualLogin()` must reject `checking`, `ready`, and `security_hold`, close any stale inactive automation, call the launcher once, and return `login_open`.

Add to `appPaths.ts`:

```ts
export function getSecurityHoldPath(): string {
  return path.join(app.getPath("userData"), "security-hold.json");
}
```

- [ ] **Step 4: Run coordinator tests**

Run: `pnpm test -- tests/main/loginSessionCoordinator.test.ts tests/main/appPaths.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit when Git is available**

```powershell
git add src/main/appPaths.ts src/main/LoginSessionCoordinator.ts tests/main/appPaths.test.ts tests/main/loginSessionCoordinator.test.ts
git commit -m "feat: coordinate verified login sessions"
```

### Task 4: One-Shot Naver Session Verification and Fail-Closed Run

**Files:**
- Modify: `src/automation/AutomationEngine.ts`
- Modify: `src/automation/NaverBlogAutomation.ts`
- Modify: `tests/automation/naverBlogAutomation.test.ts`

**Interfaces:**
- Consumes: `classifySessionEvidence` from Task 1.
- Produces: `AutomationEngine.verifySession(): Promise<SessionVerificationResult>`.
- Produces: `AutomationFailureReason = "missing_session" | "security" | "profile_error" | "editor"` on every failed `AutomationResult`.
- Changes: `saveDraft()` requires an already verified retained context and does not navigate through Naver Home.

- [ ] **Step 1: Write failing adapter contract tests**

Replace static login-flow assertions with contract assertions:

```ts
it("exposes explicit session verification instead of manual login", () => {
  const engine: AutomationEngine = new NaverBlogAutomation("profile-path");
  expect(engine.verifySession).toBeInstanceOf(Function);
  expect("openLoginWindow" in engine).toBe(false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test -- tests/automation/naverBlogAutomation.test.ts`

Expected: FAIL because `verifySession` does not exist and `openLoginWindow` still does.

- [ ] **Step 3: Implement evidence gathering and verification**

Update the failure contract before changing the adapter:

```ts
export type AutomationFailureReason = "missing_session" | "security" | "profile_error" | "editor";

export type AutomationResult =
  | { ok: true }
  | { ok: false; retryable: boolean; reason: AutomationFailureReason; message: string };
```

`verifySession()` must:

1. Open the persistent context once.
2. Navigate to `NAVER_HOME_URL` once with `domcontentloaded`.
3. Gather required-cookie presence, login-form visibility, and security visibility.
4. Classify the evidence.
5. Return `{ ok: true }`, `{ reason: "missing" }`, or `{ reason: "security" }` without another navigation.

Track `private sessionVerified = false`. Set it only on authenticated evidence and clear it in `close()`.

At the beginning of `saveDraft()`, return `{ ok: false, retryable: false, reason: "missing_session", ... }` if `sessionVerified` is false. Remove `requireExistingSession()` and navigate directly to `NAVER_BLOG_WRITE_URL` using the retained page. If login or security appears after that navigation, return `{ ok: false, retryable: false, reason: "security", ... }`. Other editor failures use `reason: "editor"` and remain non-retryable.

- [ ] **Step 4: Run automation tests and build**

Run: `pnpm test -- tests/automation/naverBlogAutomation.test.ts tests/automation/sessionEvidence.test.ts`

Expected: all focused tests PASS.

Run: `pnpm run build`

Expected: build succeeds.

- [ ] **Step 5: Commit when Git is available**

```powershell
git add src/automation/AutomationEngine.ts src/automation/NaverBlogAutomation.ts tests/automation/naverBlogAutomation.test.ts
git commit -m "feat: verify naver session before drafting"
```

### Task 5: IPC Enforcement and Renderer Login Controls

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/global.d.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: `LoginSessionCoordinator` and shared login types.
- Produces IPC: `login:getState`, `login:openManual`, `login:verify`, `login:clearSecurityHold`.
- Enforces: `run:start` obtains its automation only through `requireReadyAutomation()`.

- [ ] **Step 1: Rewrite IPC tests first**

Add coordinator mocks and assert:

```ts
expect([...handlers.keys()].sort()).toEqual([
  "login:clearSecurityHold",
  "login:getState",
  "login:openManual",
  "login:verify",
  "posts:load",
  "run:start",
  "run:stop",
  "workspace:select"
]);

it("blocks run:start unless the coordinator is ready", async () => {
  coordinator.requireReadyAutomation.mockImplementation(() => {
    throw new Error("로그인 확인이 필요합니다.");
  });
  await expect(handlers.get("run:start")?.({}, "C:\\workspace", "normal", 1))
    .rejects.toThrow("로그인 확인이 필요합니다.");
  expect(runPosts).not.toHaveBeenCalled();
});
```

Also assert that `run:start` uses the retained automation and calls `coordinator.enterSecurityHold()` only when the run result has `reason: "security"`; it must not inspect message text.

- [ ] **Step 2: Run IPC tests and verify RED**

Run: `pnpm test -- tests/main/ipc.test.ts`

Expected: FAIL because old `naver:login` channels and active-automation ownership remain.

- [ ] **Step 3: Implement coordinator-backed IPC**

Make `registerIpcHandlers()` initialize one coordinator before registering handlers. Remove module-level `activeAutomation`; keep only `activeRunController`. `run:stop` aborts and asks the coordinator to close the retained automation, returning the state to `unverified`.

Expose preload methods:

```ts
getLoginState: () => ipcRenderer.invoke("login:getState"),
openManualLogin: () => ipcRenderer.invoke("login:openManual"),
verifyLogin: () => ipcRenderer.invoke("login:verify"),
clearSecurityHold: () => ipcRenderer.invoke("login:clearSecurityHold")
```

- [ ] **Step 4: Update the renderer**

In `App.tsx`:

- Initialize `runLimit` to `"1"`.
- Load login state on mount.
- Show Korean labels for all five states.
- Add separate `브라우저 열기 / 로그인`, `로그인 확인`, and conditional `보안 대기 해제` buttons.
- Disable Start unless `loginState.state === "ready"`, `summary.valid > 0`, and the app is idle.
- Refresh login state after every login action and after a run.
- Replace `Run count`/`All` with `실행 개수`/`전체`.

- [ ] **Step 5: Run IPC tests and build**

Run: `pnpm test -- tests/main/ipc.test.ts`

Expected: all IPC tests PASS.

Run: `pnpm run build`

Expected: TypeScript and renderer build succeed.

- [ ] **Step 6: Commit when Git is available**

```powershell
git add src/main/ipc.ts src/main/main.ts src/main/preload.ts src/renderer/global.d.ts src/renderer/App.tsx tests/main/ipc.test.ts
git commit -m "feat: gate draft runs on verified login"
```

### Task 6: Remove Full-Post Retry and Complete Offline Verification

**Files:**
- Modify: `src/core/runOrchestrator.ts`
- Modify: `tests/core/runOrchestrator.test.ts`
- Modify: `docs/stability-test-procedure.md`
- Modify: `docs/packaging-prep.md`

**Interfaces:**
- Changes: `runPosts()` invokes `engine.saveDraft()` once per pending post.
- Preserves: stop-on-first-failure, status/log writing, success marker behavior, and engine cleanup.

- [ ] **Step 1: Replace the three-attempt test with a one-attempt safety test**

```ts
it("does not retry a failed post", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-no-retry-"));
  let attempts = 0;
  const engine: AutomationEngine = {
    async verifySession() { return { ok: true }; },
    async saveDraft() {
      attempts += 1;
      return { ok: false, retryable: false, reason: "editor", message: "Editor failed" };
    },
    async close() {}
  };

  const result = await runPosts([makeJob(folder)], engine, { speed: "normal" });

  expect(attempts).toBe(1);
  expect(result).toEqual({ stopped: true, reason: "editor", message: "Editor failed" });
});
```

Update every test `AutomationEngine` stub to implement `verifySession()`.

- [ ] **Step 2: Run orchestrator tests and verify RED**

Run: `pnpm test -- tests/core/runOrchestrator.test.ts`

Expected: the new safety test FAILS with 3 attempts.

- [ ] **Step 3: Remove `saveWithRetry()`**

Extend `RunResult` with `reason?: AutomationFailureReason | "stopped"`. Call `saveDraftSafely(engine, job, options)` once from `runPosts()` and propagate the failed automation result's `reason`. Keep the existing failure status and immediate run stop behavior. Remove attempt log lines and the unreachable retry-loop result. User abort returns `reason: "stopped"`.

- [ ] **Step 4: Update manual documentation**

Document the new safe sequence:

```text
1. Open normal Chrome from the app.
2. Complete login manually and close that dedicated Chrome window.
3. Select Login Check once.
4. Start with run count 1 only when the state is Ready.
5. If Security Hold appears, do not clear it or test again on the same day after repeated captcha.
```

State explicitly that automated tests never contact Naver.

- [ ] **Step 5: Run complete offline verification**

Run: `pnpm test`

Expected: all test files PASS with zero failures.

Run: `pnpm run build`

Expected: TypeScript, Electron main/preload, and Vite renderer builds succeed.

Check: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'browser-profile|N_Blog_Auto_V05' }`

Expected: no Chrome process was launched by automated verification.

- [ ] **Step 6: Commit when Git is available**

```powershell
git add src/core/runOrchestrator.ts tests/core/runOrchestrator.test.ts docs/stability-test-procedure.md docs/packaging-prep.md
git commit -m "fix: stop automatic retries after draft failure"
```

## Final Manual Gate

Do not run this gate while Naver is repeatedly showing captcha. After the account has stabilized:

1. Start the app.
2. Confirm the initial state is `로그인 확인 필요` or the persisted `보안 대기` state.
3. Clear a hold only by explicit user choice.
4. Open normal Chrome from the app and confirm no Playwright-controlled draft browser is open.
5. Complete manual login, close Chrome, and select `로그인 확인` once.
6. Confirm the state becomes `로그인 준비 완료` without a second login navigation.
7. Select a clean run workspace and execute one simple draft.
8. If any security screen appears, confirm the run stops immediately and remains held after restarting the app.
