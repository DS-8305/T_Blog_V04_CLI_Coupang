# Tistory V08 CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the V08 three-command Codex-assisted CLI workflow to the existing Tistory repository while enforcing draft-only uploads and a five-marker input contract.

**Architecture:** Add a focused `src/cli` layer that reuses the existing Tistory parser, loader, orchestration, browser launcher constants, and Playwright automation. Keep the Electron parser unchanged; apply a CLI-only marker policy after loading and before attaching to Chrome, then force accepted jobs to draft metadata as defense in depth.

**Tech Stack:** Node.js, TypeScript, esbuild, Playwright CDP, Vitest, pnpm, existing Electron application modules.

## Global Constraints

- Commands are exactly `draft:login`, `draft:verify`, and `draft:run` and run from the source repository with `pnpm`.
- CLI publication is always a Tistory draft; public and scheduled publication are forbidden.
- CLI content permits only `[TITLE]`, `[H2]`, `[BOLD]`, `[HR]`, and `[IMAGE:path]` markers plus plain text.
- `verify` and `run` require an explicit root `https://*.tistory.com` `--blog-url`.
- The CLI shares `%APPDATA%/tistory-blog-auto-v01/browser-profile` with the Electron application.
- Chrome CDP binds only to `127.0.0.1:9222`.
- No OpenAI API call, credential storage, Naver selector, or portable-EXE CLI mode is added.
- All production changes follow test-driven development and preserve the existing Electron behavior.

---

### Task 1: CLI argument contract

**Files:**
- Create: `src/cli/cliArgs.ts`
- Create: `tests/cli/cliArgs.test.ts`

**Interfaces:**
- Consumes: `TypingSpeedName` and `normalizeTistoryBlogUrl`.
- Produces: `parseCliArgs(argv: string[]): CliCommand`.
- `CliCommand` is `{ command: "login" }`, `{ command: "verify"; blogUrl: string }`, or `{ command: "run"; workspacePath: string; blogUrl: string; speed: TypingSpeedName; maxPosts?: number }`.

- [ ] **Step 1: Write failing argument tests**

Cover login without options, required/normalized blog URL for verify, required absolute workspace for run, optional speed and maximum post count, a leading `--` separator, duplicate options, missing values, and unknown commands/options.

```ts
expect(parseCliArgs(["verify", "--blog-url", "sample.tistory.com"])).toEqual({
  command: "verify",
  blogUrl: "https://sample.tistory.com"
});
expect(() => parseCliArgs(["run", "--workspace", "relative", "--blog-url", "sample.tistory.com"]))
  .toThrow("--workspace must be an absolute path");
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm vitest run tests/cli/cliArgs.test.ts`

Expected: FAIL because `src/cli/cliArgs.ts` does not exist.

- [ ] **Step 3: Implement the dependency-free parser**

Parse option pairs after an optional leading `--`, reject duplicates and options outside each command's allowlist, normalize `--blog-url` with the existing Tistory URL function, validate `path.isAbsolute(workspacePath)`, and validate `fast|normal|slow` and positive integer maximum counts.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `pnpm vitest run tests/cli/cliArgs.test.ts`

Expected: all CLI argument tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/cli/cliArgs.ts tests/cli/cliArgs.test.ts
git commit -m "feat: define Tistory draft CLI arguments"
```

### Task 2: Shared Chrome profile and detached login command

**Files:**
- Create: `src/cli/cliPaths.ts`
- Create: `src/cli/cliChrome.ts`
- Create: `tests/cli/cliChrome.test.ts`

**Interfaces:**
- Consumes: `findChromeExecutable`, `TISTORY_HOME_URL`, and `MANUAL_CHROME_CDP_ENDPOINT`.
- Produces: `getCliProfilePath(env?: NodeJS.ProcessEnv, homeDir?: string): string`.
- Produces: `isCdpAvailable(endpoint?: string, fetchImpl?: typeof fetch): Promise<boolean>`.
- Produces: `launchCliChrome(profilePath: string, dependencies?): Promise<"launched" | "already_running">`.

- [ ] **Step 1: Write failing path and launcher tests**

```ts
expect(getCliProfilePath({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "unused"))
  .toBe(path.join("C:\\Users\\me\\AppData\\Roaming", "tistory-blog-auto-v01", "browser-profile"));
expect(spawn).toHaveBeenCalledWith(chromePath, expect.arrayContaining([
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9222",
  TISTORY_HOME_URL
]), expect.objectContaining({ detached: true, stdio: "ignore" }));
```

Also verify that a reachable CDP endpoint returns `already_running`, does not call `spawn`, and that a launched child is `unref()`ed.

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm vitest run tests/cli/cliChrome.test.ts`

Expected: FAIL because the CLI path and Chrome modules do not exist.

- [ ] **Step 3: Implement shared paths and Chrome launch**

Use `%APPDATA%` with an `os.homedir()` fallback. Probe `${endpoint}/json/version` with a short abort timeout. When unavailable, find Chrome, launch it detached with the shared absolute profile, loopback CDP flags, existing no-first-run flags, and Tistory home, then call `unref()`.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `pnpm vitest run tests/cli/cliChrome.test.ts`

Expected: all path and browser launch tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/cli/cliPaths.ts src/cli/cliChrome.ts tests/cli/cliChrome.test.ts
git commit -m "feat: launch shared Tistory CLI Chrome"
```

### Task 3: Five-marker draft-only policy

**Files:**
- Create: `src/cli/cliPostPolicy.ts`
- Create: `tests/cli/cliPostPolicy.test.ts`

**Interfaces:**
- Consumes: `PostJob[]` returned by `loadPosts` and each job's `contentPath`.
- Produces: `applyCliDraftPolicy(jobs: PostJob[]): Promise<PostJob[]>`.
- Adds `ValidationError` entries with code `cli_unsupported_marker` for desktop-only markers.

- [ ] **Step 1: Write failing policy tests**

Create temporary content files and jobs that demonstrate:

```ts
const accepted = "[TITLE]A[/TITLE]\n[H2]H[/H2]\n[BOLD]B[/BOLD]\n[HR]\n[IMAGE:images/a.png]";
expect(result.parsed.metadata).toEqual({ publication: "draft", category: null, tags: [], scheduledAt: null });
```

Test each forbidden marker family (`PUBLISH`, `CATEGORY`, `TAGS`, `SCHEDULE`, `QUOTE`), deduplicate repeated forbidden tags, preserve existing parser errors, change an otherwise runnable job to `validation_error`, and preserve `needs_review` when no new error exists.

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm vitest run tests/cli/cliPostPolicy.test.ts`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the policy**

Read each accessible content file as UTF-8, scan bracket markers for the five desktop-only tag names, append one readable error per unique forbidden name, force a new draft metadata object on every job, and return new job/parsed/error objects rather than mutating caller-owned values.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `pnpm vitest run tests/cli/cliPostPolicy.test.ts`

Expected: all marker policy tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/cli/cliPostPolicy.ts tests/cli/cliPostPolicy.test.ts
git commit -m "feat: enforce Tistory CLI draft policy"
```

### Task 4: CLI runner and package commands

**Files:**
- Create: `src/cli/draftCli.ts`
- Create: `tests/cli/draftCli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseCliArgs`, `getCliProfilePath`, `launchCliChrome`, `loadPosts`, `applyCliDraftPolicy`, `TistoryBlogAutomation.attach`, and `runPosts`.
- Produces: `main(argv: string[], dependencies?: CliDependencies): Promise<number>`.
- Adds scripts `cli:build`, `draft:login`, `draft:verify`, and `draft:run`.

- [ ] **Step 1: Write failing runner tests**

Inject dependencies and captured log functions. Cover:

- login launch and already-running messages;
- verify success and failed session exit code;
- run policy validation failure before `attachAutomation`;
- unresolved `needs_review` failure before editor input;
- successful `loadPosts` -> policy -> verify -> `runPosts` delegation with `closeEngine: false`;
- nonzero run result handling;
- attached automation cleanup in `finally`.

```ts
await expect(main(["run", "--workspace", workspace, "--blog-url", "sample.tistory.com"], deps))
  .resolves.toBe(0);
expect(runPosts).toHaveBeenCalledWith(jobs, automation, expect.objectContaining({
  speed: "normal",
  closeEngine: false
}));
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `pnpm vitest run tests/cli/draftCli.test.ts`

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement command dispatch**

For login, report `launched` or `already_running`. For run, load and apply policy before creating the automation attachment; format validation errors with post IDs and reject `needs_review`. For verify/run, attach with the normalized blog URL, require successful session verification, and always call `automation.close()` in `finally`. Return `0` on success and `1` with concise `console.error` output for expected failures.

- [ ] **Step 4: Add build and command scripts**

```json
"cli:build": "esbuild src/cli/draftCli.ts --bundle --platform=node --format=esm --external:playwright --outfile=dist-cli/draftCli.js",
"draft:login": "pnpm run cli:build && node dist-cli/draftCli.js login",
"draft:verify": "pnpm run cli:build && node dist-cli/draftCli.js verify",
"draft:run": "pnpm run cli:build && node dist-cli/draftCli.js run"
```

Include `pnpm run cli:build` in the main `build` script so CI and packaging compile the CLI entrypoint.

- [ ] **Step 5: Run focused tests and CLI build**

Run: `pnpm vitest run tests/cli/draftCli.test.ts tests/cli/cliArgs.test.ts tests/cli/cliChrome.test.ts tests/cli/cliPostPolicy.test.ts`

Run: `pnpm run cli:build`

Expected: focused tests pass and `dist-cli/draftCli.js` is produced.

- [ ] **Step 6: Commit**

```powershell
git add -- src/cli/draftCli.ts tests/cli/draftCli.test.ts package.json
git commit -m "feat: run Tistory drafts from CLI"
```

### Task 5: Tistory content prompt and workflow guide

**Files:**
- Create: `prompts/tistory-blog-content-template.md`
- Create: `docs/tistory-v08-cli-workflow.md`

**Interfaces:**
- Documents the workspace contract consumed by `loadPosts` and the commands produced in Task 4.

- [ ] **Step 1: Write the content prompt**

Require UTF-8 `content.txt`, natural Korean prose, one title, useful H2 sections, restrained bold text, optional HR placement, and one to five generated images. Explicitly prohibit every marker except the five confirmed forms and show a complete valid skeleton.

- [ ] **Step 2: Write the operational guide**

Document prerequisites, installation, workspace tree, the three exact commands, `--speed`, `--max-posts`, shared-profile concurrency, output status files, validation errors, `needs_review`, and manual Tistory draft review.

- [ ] **Step 3: Check marker and command consistency**

Run:

```powershell
rg -n "PUBLISH|CATEGORY|TAGS|SCHEDULE|QUOTE|draft:login|draft:verify|draft:run" prompts/tistory-blog-content-template.md docs/tistory-v08-cli-workflow.md
```

Expected: forbidden markers occur only in explicit prohibition text; all three commands use the package script names and required options from the implementation.

- [ ] **Step 4: Commit**

```powershell
git add -- prompts/tistory-blog-content-template.md docs/tistory-v08-cli-workflow.md
git commit -m "docs: add Tistory Codex CLI workflow"
```

### Task 6: Full verification and portable package

**Files:**
- Verify all modified files.
- Generate: `release/Tistory-Blog-Automation-0.1.0-portable.exe`

**Interfaces:**
- Confirms the feature is compatible with the entire application and produces the normal portable deliverable.

- [ ] **Step 1: Run fresh full verification**

Run:

```powershell
pnpm test
pnpm run build
git diff --check
```

Expected: every test file passes, TypeScript and both Electron/CLI bundles build, and whitespace validation exits `0`.

- [ ] **Step 2: Review the complete diff and commit state**

Run: `git status -sb`, `git log --oneline -8`, and `git diff origin/main...HEAD --stat`.

Expected: only approved CLI, prompt, documentation, tests, and design/plan changes are present.

- [ ] **Step 3: Confirm the portable app is not running**

Check Windows processes for `Tistory Blog Automation` and `Tistory-Blog-Automation-0.1.0-portable`. If running, wait for it to exit before packaging; do not terminate it automatically.

- [ ] **Step 4: Build and inspect the portable executable**

Run: `pnpm run dist:portable`, then inspect file length, modification time, and SHA-256 with `Get-Item` and `Get-FileHash`.

Expected: electron-builder exits `0` and a fresh portable executable exists.

- [ ] **Step 5: Final verification commit if required**

If verification itself produced no source changes, do not create an empty commit. Report branch, commit list, test count, build result, portable path/hash, and that no GitHub push occurred unless explicitly requested.
