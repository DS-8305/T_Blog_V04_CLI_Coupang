# Naver Blog Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop app that scans local post folders, parses explicit text markers, drives Naver Blog through Playwright using a persistent Chrome profile, and always saves posts as drafts.

**Architecture:** Use Electron for the desktop shell, TypeScript for shared app logic, Vitest for local tests, and Playwright for browser automation. Keep parser, post loading, run orchestration, and Naver-specific automation in separate modules so most behavior can be tested without opening Naver.

**Tech Stack:** Electron, Vite, React, TypeScript, Playwright, Vitest, Node.js `fs/promises`, Electron IPC.

---

## File Structure

Create this structure:

```text
package.json
tsconfig.json
vite.config.ts
vitest.config.ts
index.html
src/
  main/
    main.ts
    ipc.ts
    appPaths.ts
  renderer/
    App.tsx
    main.tsx
    styles.css
  shared/
    types.ts
  core/
    parser.ts
    postLoader.ts
    statusStore.ts
    runOrchestrator.ts
    typingSpeed.ts
  automation/
    AutomationEngine.ts
    NaverBlogAutomation.ts
    selectors.ts
tests/
  fixtures/
    valid-workspace/
      posts/
        001-first-post/
          content.txt
          images/
            hero.png
    invalid-workspace/
      posts/
        001-missing-title/
          content.txt
  core/
    parser.test.ts
    postLoader.test.ts
    statusStore.test.ts
    runOrchestrator.test.ts
docs/
  manual-test-checklist.md
```

Responsibilities:

- `src/core/parser.ts`: convert `content.txt` to ordered editor events and validation errors.
- `src/core/postLoader.ts`: scan `posts/*/content.txt`, parse each post, resolve image paths, and return post jobs.
- `src/core/statusStore.ts`: write `status.json` and append `run-log.txt`.
- `src/core/runOrchestrator.ts`: process posts sequentially, retry transient failures, stop on hard failures.
- `src/automation/AutomationEngine.ts`: interface used by orchestrator.
- `src/automation/NaverBlogAutomation.ts`: Playwright implementation for Naver Blog.
- `src/main/*`: Electron main process, app paths, IPC bridge.
- `src/renderer/*`: desktop UI.

---

### Task 1: Scaffold Electron TypeScript App

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/styles.css`
- Create: `src/main/main.ts`

- [ ] **Step 1: Create package scripts and dependencies**

Write `package.json`:

```json
{
  "name": "n-blog-auto-vnext",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-main/main.js",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "electron:dev": "concurrently \"npm run dev\" \"wait-on http://127.0.0.1:5173 && electron .\"",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "electron": "^33.2.1",
    "playwright": "^1.49.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "concurrently": "^9.1.0",
    "typescript": "^5.7.2",
    "vite": "^6.0.3",
    "vitest": "^2.1.8",
    "wait-on": "^8.0.1"
  }
}
```

- [ ] **Step 2: Add TypeScript and Vite config**

Write `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist-main",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

Write `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  build: {
    outDir: "dist-renderer"
  }
});
```

Write `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

- [ ] **Step 3: Add a minimal renderer and main process**

Write `index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Naver Blog Automation</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

Write `src/renderer/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Write `src/renderer/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <header>
        <h1>Naver Blog Automation</h1>
        <p>작업 폴더를 선택하고 블로그 초안을 임시저장합니다.</p>
      </header>
    </main>
  );
}
```

Write `src/renderer/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Segoe UI", system-ui, sans-serif;
  background: #f7f8fa;
  color: #20242a;
}

.app-shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px;
}
```

Write `src/main/main.ts`:

```ts
import { app, BrowserWindow } from "electron";
import path from "node:path";

async function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(path.join(app.getAppPath(), "dist-renderer", "index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 4: Install and verify**

Run: `npm install`

Expected: dependencies install and `package-lock.json` is created.

Run: `npm test`

Expected: Vitest starts and reports no tests found or zero test files without TypeScript compile errors.

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts index.html src
git commit -m "chore: scaffold electron app"
```

Expected: commit succeeds. If `git` is not installed on this machine, record that in the final handoff and continue without committing.

---

### Task 2: Add Shared Types and Typing Speed Presets

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/core/typingSpeed.ts`
- Test: `tests/core/typingSpeed.test.ts`

- [ ] **Step 1: Write failing typing speed tests**

Write `tests/core/typingSpeed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getTypingSpeedProfile } from "../../src/core/typingSpeed";

describe("getTypingSpeedProfile", () => {
  it("returns the normal profile by default", () => {
    expect(getTypingSpeedProfile("normal")).toEqual({
      keyDelayMs: 45,
      linePauseMs: 220,
      blockPauseMs: 450
    });
  });

  it("rejects an unknown profile name", () => {
    expect(() => getTypingSpeedProfile("turbo" as never)).toThrow("Unknown typing speed: turbo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/typingSpeed.test.ts`

Expected: FAIL because `src/core/typingSpeed.ts` does not exist.

- [ ] **Step 3: Add shared types and implementation**

Write `src/shared/types.ts`:

```ts
export type TypingSpeedName = "fast" | "normal" | "slow";

export type TypingSpeedProfile = {
  keyDelayMs: number;
  linePauseMs: number;
  blockPauseMs: number;
};

export type EditorEvent =
  | { type: "setTitle"; text: string }
  | { type: "typeText"; text: string }
  | { type: "typeBold"; text: string }
  | { type: "insertQuote"; text: string }
  | { type: "insertDivider" }
  | { type: "insertImage"; relativePath: string; absolutePath: string };

export type ValidationError = {
  code: string;
  message: string;
};

export type ParsedPost = {
  title: string;
  events: EditorEvent[];
  errors: ValidationError[];
};

export type PostStatus = "pending" | "validation_error" | "running" | "draft_saved" | "failed" | "stopped";

export type PostJob = {
  id: string;
  folderPath: string;
  contentPath: string;
  status: PostStatus;
  parsed: ParsedPost;
};
```

Write `src/core/typingSpeed.ts`:

```ts
import type { TypingSpeedName, TypingSpeedProfile } from "../shared/types";

const profiles: Record<TypingSpeedName, TypingSpeedProfile> = {
  fast: { keyDelayMs: 20, linePauseMs: 120, blockPauseMs: 260 },
  normal: { keyDelayMs: 45, linePauseMs: 220, blockPauseMs: 450 },
  slow: { keyDelayMs: 85, linePauseMs: 420, blockPauseMs: 800 }
};

export function getTypingSpeedProfile(name: TypingSpeedName): TypingSpeedProfile {
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`Unknown typing speed: ${String(name)}`);
  }
  return profile;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core/typingSpeed.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/shared/types.ts src/core/typingSpeed.ts tests/core/typingSpeed.test.ts
git commit -m "feat: add shared post types and typing speeds"
```

---

### Task 3: Implement Content Parser

**Files:**
- Create: `src/core/parser.ts`
- Test: `tests/core/parser.test.ts`

- [ ] **Step 1: Write parser tests**

Write `tests/core/parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseContent } from "../../src/core/parser";

const postFolder = path.resolve("tests/fixtures/valid-workspace/posts/001-first-post");

describe("parseContent", () => {
  it("parses title and supported editor events", () => {
    const input = `[TITLE]First post title[/TITLE]

Normal paragraph text.

[BOLD]Bold sentence.[/BOLD]

[QUOTE]
Quoted text.
Multiple lines are allowed.
[/QUOTE]

[HR]

[IMAGE:images/hero.png]

Text after image.`;

    const result = parseContent(input, postFolder);

    expect(result.errors).toEqual([]);
    expect(result.title).toBe("First post title");
    expect(result.events).toEqual([
      { type: "setTitle", text: "First post title" },
      { type: "typeText", text: "Normal paragraph text." },
      { type: "typeBold", text: "Bold sentence." },
      { type: "insertQuote", text: "Quoted text.\nMultiple lines are allowed." },
      { type: "insertDivider" },
      {
        type: "insertImage",
        relativePath: "images/hero.png",
        absolutePath: path.join(postFolder, "images/hero.png")
      },
      { type: "typeText", text: "Text after image." }
    ]);
  });

  it("reports missing title", () => {
    const result = parseContent("Body only", postFolder);
    expect(result.errors).toContainEqual({
      code: "missing_title",
      message: "content.txt must include [TITLE]...[/TITLE]."
    });
  });

  it("reports unsupported tags", () => {
    const result = parseContent("[TITLE]A[/TITLE]\n[COLOR:red]bad[/COLOR]", postFolder);
    expect(result.errors).toContainEqual({
      code: "unsupported_tag",
      message: "Unsupported tag: COLOR"
    });
  });

  it("reports unclosed paired tags", () => {
    const result = parseContent("[TITLE]A[/TITLE]\n[BOLD]open", postFolder);
    expect(result.errors).toContainEqual({
      code: "unclosed_tag",
      message: "Missing closing tag: [/BOLD]"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/parser.test.ts`

Expected: FAIL because `parseContent` is missing.

- [ ] **Step 3: Implement parser**

Write `src/core/parser.ts`:

```ts
import path from "node:path";
import type { EditorEvent, ParsedPost, ValidationError } from "../shared/types";

const pairedTags = ["TITLE", "BOLD", "QUOTE"] as const;
const supportedTags = new Set(["TITLE", "BOLD", "QUOTE", "HR", "IMAGE"]);

export function parseContent(content: string, postFolder: string): ParsedPost {
  const errors: ValidationError[] = [];
  const events: EditorEvent[] = [];
  const titleMatch = content.match(/\[TITLE\]([\s\S]*?)\[\/TITLE\]/);
  const title = titleMatch?.[1].trim() ?? "";

  if (!title) {
    errors.push({
      code: "missing_title",
      message: "content.txt must include [TITLE]...[/TITLE]."
    });
  }

  for (const tag of pairedTags) {
    const openCount = countMatches(content, new RegExp(`\\[${tag}\\]`, "g"));
    const closeCount = countMatches(content, new RegExp(`\\[\\/${tag}\\]`, "g"));
    if (openCount > closeCount) {
      errors.push({
        code: "unclosed_tag",
        message: `Missing closing tag: [/${tag}]`
      });
    }
  }

  for (const match of content.matchAll(/\[\/?([A-Z]+)(?::[^\]]+)?\]/g)) {
    const tag = match[1];
    if (!supportedTags.has(tag)) {
      errors.push({
        code: "unsupported_tag",
        message: `Unsupported tag: ${tag}`
      });
    }
  }

  if (title) {
    events.push({ type: "setTitle", text: title });
  }

  const body = content.replace(/\[TITLE\][\s\S]*?\[\/TITLE\]/, "").trim();
  const tokenPattern = /\[BOLD\]([\s\S]*?)\[\/BOLD\]|\[QUOTE\]([\s\S]*?)\[\/QUOTE\]|\[HR\]|\[IMAGE:([^\]]+)\]/g;
  let cursor = 0;

  for (const match of body.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    pushTextEvent(events, body.slice(cursor, index));

    if (match[1] !== undefined) {
      events.push({ type: "typeBold", text: match[1].trim() });
    } else if (match[2] !== undefined) {
      events.push({ type: "insertQuote", text: match[2].trim() });
    } else if (match[0] === "[HR]") {
      events.push({ type: "insertDivider" });
    } else if (match[3] !== undefined) {
      const relativePath = match[3].trim();
      events.push({
        type: "insertImage",
        relativePath,
        absolutePath: path.join(postFolder, relativePath)
      });
    }

    cursor = index + match[0].length;
  }

  pushTextEvent(events, body.slice(cursor));
  return { title, events, errors };
}

function pushTextEvent(events: EditorEvent[], text: string) {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
  if (normalized) {
    events.push({ type: "typeText", text: normalized });
  }
}

function countMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length;
}
```

- [ ] **Step 4: Run parser tests**

Run: `npm test -- tests/core/parser.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/parser.ts tests/core/parser.test.ts
git commit -m "feat: parse marked blog content"
```

---

### Task 4: Implement Post Loader and Fixtures

**Files:**
- Create: `tests/fixtures/valid-workspace/posts/001-first-post/content.txt`
- Create: `tests/fixtures/valid-workspace/posts/001-first-post/images/hero.png`
- Create: `tests/fixtures/invalid-workspace/posts/001-missing-title/content.txt`
- Create: `src/core/postLoader.ts`
- Test: `tests/core/postLoader.test.ts`

- [ ] **Step 1: Create test fixtures**

Write `tests/fixtures/valid-workspace/posts/001-first-post/content.txt`:

```text
[TITLE]First post title[/TITLE]

Normal paragraph text.

[IMAGE:images/hero.png]
```

Create an empty image fixture:

Run: `New-Item -ItemType File -Force 'tests\fixtures\valid-workspace\posts\001-first-post\images\hero.png'`

Write `tests/fixtures/invalid-workspace/posts/001-missing-title/content.txt`:

```text
This post has no title marker.
```

- [ ] **Step 2: Write loader tests**

Write `tests/core/postLoader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadPosts } from "../../src/core/postLoader";

describe("loadPosts", () => {
  it("loads valid post folders under posts", async () => {
    const workspace = path.resolve("tests/fixtures/valid-workspace");
    const posts = await loadPosts(workspace);

    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe("001-first-post");
    expect(posts[0].status).toBe("pending");
    expect(posts[0].parsed.title).toBe("First post title");
    expect(posts[0].parsed.errors).toEqual([]);
  });

  it("marks posts with parser errors as validation_error", async () => {
    const workspace = path.resolve("tests/fixtures/invalid-workspace");
    const posts = await loadPosts(workspace);

    expect(posts).toHaveLength(1);
    expect(posts[0].status).toBe("validation_error");
    expect(posts[0].parsed.errors[0].code).toBe("missing_title");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/core/postLoader.test.ts`

Expected: FAIL because `loadPosts` is missing.

- [ ] **Step 4: Implement post loader**

Write `src/core/postLoader.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { parseContent } from "./parser";
import type { PostJob, ValidationError } from "../shared/types";

export async function loadPosts(workspacePath: string): Promise<PostJob[]> {
  const postsRoot = path.join(workspacePath, "posts");
  const entries = await fs.readdir(postsRoot, { withFileTypes: true });
  const folderNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const jobs: PostJob[] = [];

  for (const id of folderNames) {
    const folderPath = path.join(postsRoot, id);
    const contentPath = path.join(folderPath, "content.txt");
    const content = await fs.readFile(contentPath, "utf8");
    const parsed = parseContent(content, folderPath);
    const imageErrors = await validateImages(parsed.events);
    parsed.errors.push(...imageErrors);

    jobs.push({
      id,
      folderPath,
      contentPath,
      parsed,
      status: parsed.errors.length > 0 ? "validation_error" : "pending"
    });
  }

  return jobs;
}

async function validateImages(events: PostJob["parsed"]["events"]): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  for (const event of events) {
    if (event.type !== "insertImage") continue;
    try {
      await fs.access(event.absolutePath);
    } catch {
      errors.push({
        code: "missing_image",
        message: `Image file does not exist: ${event.relativePath}`
      });
    }
  }
  return errors;
}
```

- [ ] **Step 5: Run loader tests**

Run: `npm test -- tests/core/postLoader.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/core/postLoader.ts tests/core/postLoader.test.ts tests/fixtures
git commit -m "feat: load post folders from workspace"
```

---

### Task 5: Implement Status Store

**Files:**
- Create: `src/core/statusStore.ts`
- Test: `tests/core/statusStore.test.ts`

- [ ] **Step 1: Write status tests**

Write `tests/core/statusStore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendPostLog, writePostStatus } from "../../src/core/statusStore";

describe("statusStore", () => {
  it("writes status.json", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "post-status-"));

    await writePostStatus(folder, {
      status: "draft_saved",
      startedAt: "2026-06-28T10:00:00+09:00",
      finishedAt: "2026-06-28T10:02:00+09:00",
      message: "Draft saved successfully"
    });

    const raw = await fs.readFile(path.join(folder, "status.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      status: "draft_saved",
      message: "Draft saved successfully"
    });
  });

  it("appends readable log entries", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "post-log-"));

    await appendPostLog(folder, "Started");
    await appendPostLog(folder, "Saved draft");

    const raw = await fs.readFile(path.join(folder, "run-log.txt"), "utf8");
    expect(raw).toContain("Started");
    expect(raw).toContain("Saved draft");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/statusStore.test.ts`

Expected: FAIL because `statusStore.ts` is missing.

- [ ] **Step 3: Implement status store**

Write `src/core/statusStore.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { PostStatus } from "../shared/types";

export type StatusRecord = {
  status: PostStatus;
  startedAt?: string;
  finishedAt?: string;
  message: string;
};

export async function writePostStatus(postFolder: string, record: StatusRecord): Promise<void> {
  const statusPath = path.join(postFolder, "status.json");
  await fs.writeFile(statusPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function appendPostLog(postFolder: string, message: string): Promise<void> {
  const logPath = path.join(postFolder, "run-log.txt");
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.appendFile(logPath, line, "utf8");
}
```

- [ ] **Step 4: Run status tests**

Run: `npm test -- tests/core/statusStore.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/statusStore.ts tests/core/statusStore.test.ts
git commit -m "feat: record post status and logs"
```

---

### Task 6: Implement Run Orchestrator With Mock Automation

**Files:**
- Create: `src/automation/AutomationEngine.ts`
- Create: `src/core/runOrchestrator.ts`
- Test: `tests/core/runOrchestrator.test.ts`

- [ ] **Step 1: Write orchestrator tests**

Write `tests/core/runOrchestrator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AutomationEngine } from "../../src/automation/AutomationEngine";
import { runPosts } from "../../src/core/runOrchestrator";
import type { PostJob } from "../../src/shared/types";

function makeJob(folderPath: string): PostJob {
  return {
    id: path.basename(folderPath),
    folderPath,
    contentPath: path.join(folderPath, "content.txt"),
    status: "pending",
    parsed: {
      title: "Title",
      errors: [],
      events: [{ type: "setTitle", text: "Title" }, { type: "typeText", text: "Body" }]
    }
  };
}

describe("runPosts", () => {
  it("processes pending posts sequentially and records draft_saved", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-post-"));
    const calls: string[] = [];
    const engine: AutomationEngine = {
      async openLoginWindow() {},
      async saveDraft(job) {
        calls.push(job.id);
        return { ok: true };
      },
      async close() {}
    };

    const result = await runPosts([makeJob(folder)], engine, { speed: "normal" });

    expect(calls).toEqual([path.basename(folder)]);
    expect(result.stopped).toBe(false);
    const status = JSON.parse(await fs.readFile(path.join(folder, "status.json"), "utf8"));
    expect(status.status).toBe("draft_saved");
  });

  it("retries transient failure and then succeeds", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-retry-"));
    let attempts = 0;
    const engine: AutomationEngine = {
      async openLoginWindow() {},
      async saveDraft() {
        attempts += 1;
        return attempts === 1
          ? { ok: false, retryable: true, message: "Temporary click failure" }
          : { ok: true };
      },
      async close() {}
    };

    const result = await runPosts([makeJob(folder)], engine, { speed: "normal" });

    expect(attempts).toBe(2);
    expect(result.stopped).toBe(false);
  });

  it("stops on non-retryable login failure", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-stop-"));
    const engine: AutomationEngine = {
      async openLoginWindow() {},
      async saveDraft() {
        return { ok: false, retryable: false, message: "Login required" };
      },
      async close() {}
    };

    const result = await runPosts([makeJob(folder)], engine, { speed: "normal" });

    expect(result.stopped).toBe(true);
    expect(result.message).toBe("Login required");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/runOrchestrator.test.ts`

Expected: FAIL because orchestrator files are missing.

- [ ] **Step 3: Add automation interface**

Write `src/automation/AutomationEngine.ts`:

```ts
import type { PostJob, TypingSpeedName } from "../shared/types";

export type AutomationResult =
  | { ok: true }
  | { ok: false; retryable: boolean; message: string };

export interface AutomationEngine {
  openLoginWindow(): Promise<void>;
  saveDraft(job: PostJob, options: { speed: TypingSpeedName }): Promise<AutomationResult>;
  close(): Promise<void>;
}
```

- [ ] **Step 4: Implement orchestrator**

Write `src/core/runOrchestrator.ts`:

```ts
import type { AutomationEngine } from "../automation/AutomationEngine";
import type { PostJob, TypingSpeedName } from "../shared/types";
import { appendPostLog, writePostStatus } from "./statusStore";

export type RunResult = {
  stopped: boolean;
  message: string;
};

export async function runPosts(
  jobs: PostJob[],
  engine: AutomationEngine,
  options: { speed: TypingSpeedName }
): Promise<RunResult> {
  for (const job of jobs) {
    if (job.status !== "pending") continue;

    const startedAt = new Date().toISOString();
    await writePostStatus(job.folderPath, {
      status: "running",
      startedAt,
      message: "Post automation started"
    });
    await appendPostLog(job.folderPath, `Started post ${job.id}`);

    const result = await saveWithRetry(engine, job, options);
    if (!result.ok) {
      await writePostStatus(job.folderPath, {
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: result.message
      });
      await appendPostLog(job.folderPath, `Failed: ${result.message}`);
      return { stopped: true, message: result.message };
    }

    await writePostStatus(job.folderPath, {
      status: "draft_saved",
      startedAt,
      finishedAt: new Date().toISOString(),
      message: "Draft saved successfully"
    });
    await appendPostLog(job.folderPath, "Draft saved successfully");
  }

  await engine.close();
  return { stopped: false, message: "All eligible posts saved as drafts" };
}

async function saveWithRetry(
  engine: AutomationEngine,
  job: PostJob,
  options: { speed: TypingSpeedName }
) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await engine.saveDraft(job, options);
    if (result.ok) return result;
    await appendPostLog(job.folderPath, `Attempt ${attempt} failed: ${result.message}`);
    if (!result.retryable || attempt === maxAttempts) return result;
  }
  return { ok: false as const, retryable: false, message: "Retry loop ended unexpectedly" };
}
```

- [ ] **Step 5: Run orchestrator tests**

Run: `npm test -- tests/core/runOrchestrator.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/automation/AutomationEngine.ts src/core/runOrchestrator.ts tests/core/runOrchestrator.test.ts
git commit -m "feat: orchestrate sequential draft saves"
```

---

### Task 7: Add Playwright Naver Automation Adapter

**Files:**
- Create: `src/automation/selectors.ts`
- Create: `src/automation/NaverBlogAutomation.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Extend event type with resolved image path already done check**

Confirm `src/shared/types.ts` has `insertImage` with `absolutePath`. No code change is required if Task 2 was implemented exactly.

- [ ] **Step 2: Add selector candidates**

Write `src/automation/selectors.ts`:

```ts
export const NAVER_BLOG_WRITE_URL = "https://blog.naver.com/GoBlogWrite.naver";

export const editorSelectors = {
  title: [
    'textarea[placeholder*="제목"]',
    'input[placeholder*="제목"]',
    '[contenteditable="true"][aria-label*="제목"]'
  ],
  body: [
    '[contenteditable="true"]',
    'div[role="textbox"]'
  ],
  draftSaveButtonNames: ["임시저장", "저장"],
  boldButtonNames: ["굵게", "Bold"],
  quoteButtonNames: ["인용구", "인용"],
  dividerButtonNames: ["구분선"],
  imageButtonNames: ["사진", "이미지"]
};
```

- [ ] **Step 3: Implement Playwright adapter**

Write `src/automation/NaverBlogAutomation.ts`:

```ts
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import type { AutomationEngine, AutomationResult } from "./AutomationEngine";
import { NAVER_BLOG_WRITE_URL, editorSelectors } from "./selectors";
import { getTypingSpeedProfile } from "../core/typingSpeed";
import type { EditorEvent, PostJob, TypingSpeedName } from "../shared/types";

export class NaverBlogAutomation implements AutomationEngine {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private readonly profilePath: string) {}

  async openLoginWindow(): Promise<void> {
    const page = await this.openPage();
    await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded" });
  }

  async saveDraft(job: PostJob, options: { speed: TypingSpeedName }): Promise<AutomationResult> {
    try {
      const page = await this.openPage();
      await page.goto(NAVER_BLOG_WRITE_URL, { waitUntil: "domcontentloaded" });

      if (await this.isLoginRequired(page)) {
        return { ok: false, retryable: false, message: "Login required or security verification shown" };
      }

      await this.waitForEditor(page);
      for (const event of job.parsed.events) {
        await this.executeEvent(page, event, options.speed);
      }
      await this.clickButtonByNames(page, editorSelectors.draftSaveButtonNames);
      await page.waitForTimeout(1000);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.page = null;
  }

  private async openPage(): Promise<Page> {
    if (!this.context) {
      this.context = await chromium.launchPersistentContext(this.profilePath, {
        channel: "chrome",
        headless: false,
        viewport: { width: 1365, height: 900 }
      });
    }
    if (!this.page || this.page.isClosed()) {
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
    }
    return this.page;
  }

  private async isLoginRequired(page: Page): Promise<boolean> {
    return page.url().includes("nid.naver.com") || (await page.locator('input[name="id"]').count()) > 0;
  }

  private async waitForEditor(page: Page): Promise<void> {
    await this.firstVisible(page, [...editorSelectors.title, ...editorSelectors.body], 15000);
  }

  private async executeEvent(page: Page, event: EditorEvent, speedName: TypingSpeedName): Promise<void> {
    const speed = getTypingSpeedProfile(speedName);

    if (event.type === "setTitle") {
      const title = await this.firstVisible(page, editorSelectors.title, 10000);
      await title.click();
      await page.keyboard.type(event.text, { delay: speed.keyDelayMs });
      await page.waitForTimeout(speed.blockPauseMs);
      return;
    }

    if (event.type === "typeText") {
      await this.typeInBody(page, event.text, speed.keyDelayMs, speed.blockPauseMs);
      return;
    }

    if (event.type === "typeBold") {
      await this.clickButtonByNames(page, editorSelectors.boldButtonNames);
      await this.typeInBody(page, event.text, speed.keyDelayMs, speed.blockPauseMs);
      await this.clickButtonByNames(page, editorSelectors.boldButtonNames);
      return;
    }

    if (event.type === "insertQuote") {
      await this.clickButtonByNames(page, editorSelectors.quoteButtonNames);
      await this.typeInBody(page, event.text, speed.keyDelayMs, speed.blockPauseMs);
      return;
    }

    if (event.type === "insertDivider") {
      await this.clickButtonByNames(page, editorSelectors.dividerButtonNames);
      await page.waitForTimeout(speed.blockPauseMs);
      return;
    }

    if (event.type === "insertImage") {
      const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
      await this.clickButtonByNames(page, editorSelectors.imageButtonNames);
      const chooser = await chooserPromise;
      await chooser.setFiles(event.absolutePath);
      await page.waitForTimeout(speed.blockPauseMs);
    }
  }

  private async typeInBody(page: Page, text: string, delay: number, pause: number): Promise<void> {
    const body = await this.firstVisible(page, editorSelectors.body, 10000);
    await body.click();
    await page.keyboard.type(text, { delay });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(pause);
  }

  private async firstVisible(page: Page, selectors: string[], timeout: number): Promise<Locator> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
          return locator;
        }
      }
      await page.waitForTimeout(250);
    }
    throw new Error(`Could not find visible selector from: ${selectors.join(", ")}`);
  }

  private async clickButtonByNames(page: Page, names: string[]): Promise<void> {
    for (const name of names) {
      const button = page.getByRole("button", { name: new RegExp(name, "i") }).first();
      if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
        await button.click();
        return;
      }
    }
    throw new Error(`Could not find button: ${names.join(", ")}`);
  }
}
```

- [ ] **Step 4: Run TypeScript check through tests**

Run: `npm test`

Expected: all tests pass and TypeScript imports compile under Vitest.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/automation/selectors.ts src/automation/NaverBlogAutomation.ts
git commit -m "feat: add naver playwright automation adapter"
```

---

### Task 8: Wire Electron IPC and App Paths

**Files:**
- Create: `src/main/appPaths.ts`
- Create: `src/main/ipc.ts`
- Modify: `src/main/main.ts`

- [ ] **Step 1: Add app paths**

Write `src/main/appPaths.ts`:

```ts
import { app } from "electron";
import path from "node:path";

export function getBrowserProfilePath(): string {
  return path.join(app.getPath("userData"), "browser-profile");
}
```

- [ ] **Step 2: Add IPC handlers**

Write `src/main/ipc.ts`:

```ts
import { dialog, ipcMain } from "electron";
import { loadPosts } from "../core/postLoader";
import { runPosts } from "../core/runOrchestrator";
import { NaverBlogAutomation } from "../automation/NaverBlogAutomation";
import { getBrowserProfilePath } from "./appPaths";
import type { TypingSpeedName } from "../shared/types";

let activeAutomation: NaverBlogAutomation | null = null;

export function registerIpcHandlers(): void {
  ipcMain.handle("workspace:select", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "작업 폴더 선택"
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("posts:load", async (_event, workspacePath: string) => {
    return loadPosts(workspacePath);
  });

  ipcMain.handle("naver:login", async () => {
    activeAutomation = new NaverBlogAutomation(getBrowserProfilePath());
    await activeAutomation.openLoginWindow();
    return { ok: true };
  });

  ipcMain.handle("run:start", async (_event, workspacePath: string, speed: TypingSpeedName) => {
    const posts = await loadPosts(workspacePath);
    const automation = new NaverBlogAutomation(getBrowserProfilePath());
    activeAutomation = automation;
    return runPosts(posts, automation, { speed });
  });

  ipcMain.handle("run:stop", async () => {
    await activeAutomation?.close();
    activeAutomation = null;
    return { ok: true };
  });
}
```

- [ ] **Step 3: Register IPC in main process**

Modify `src/main/main.ts`:

```ts
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { registerIpcHandlers } from "./ipc";

async function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(path.join(app.getAppPath(), "dist-renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  return createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 4: Run tests and build**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: TypeScript and Vite build complete.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/main/appPaths.ts src/main/ipc.ts src/main/main.ts
git commit -m "feat: wire electron ipc"
```

---

### Task 9: Build Desktop UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Add renderer API declaration**

At the top of `src/renderer/App.tsx`, add:

```tsx
import { useState } from "react";
import type { PostJob, TypingSpeedName } from "../shared/types";

declare global {
  interface Window {
    electronAPI?: {
      selectWorkspace(): Promise<string | null>;
      loadPosts(workspacePath: string): Promise<PostJob[]>;
      openLogin(): Promise<{ ok: boolean }>;
      startRun(workspacePath: string, speed: TypingSpeedName): Promise<{ stopped: boolean; message: string }>;
      stopRun(): Promise<{ ok: boolean }>;
    };
  }
}
```

- [ ] **Step 2: Replace `App` with working UI state**

Replace `src/renderer/App.tsx` with:

```tsx
import { useState } from "react";
import type { PostJob, TypingSpeedName } from "../shared/types";

declare global {
  interface Window {
    electronAPI?: {
      selectWorkspace(): Promise<string | null>;
      loadPosts(workspacePath: string): Promise<PostJob[]>;
      openLogin(): Promise<{ ok: boolean }>;
      startRun(workspacePath: string, speed: TypingSpeedName): Promise<{ stopped: boolean; message: string }>;
      stopRun(): Promise<{ ok: boolean }>;
    };
  }
}

export function App() {
  const [workspace, setWorkspace] = useState("");
  const [posts, setPosts] = useState<PostJob[]>([]);
  const [speed, setSpeed] = useState<TypingSpeedName>("normal");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>(["작업 폴더를 선택하세요."]);

  async function selectWorkspace() {
    const selected = await window.electronAPI?.selectWorkspace();
    if (!selected) return;
    setWorkspace(selected);
    const loaded = (await window.electronAPI?.loadPosts(selected)) ?? [];
    setPosts(loaded);
    setLog((current) => [`${loaded.length}개 글 폴더를 감지했습니다.`, ...current]);
  }

  async function openLogin() {
    await window.electronAPI?.openLogin();
    setLog((current) => ["네이버 로그인 브라우저를 열었습니다.", ...current]);
  }

  async function startRun() {
    if (!workspace) return;
    setRunning(true);
    setLog((current) => ["자동화를 시작합니다.", ...current]);
    const result = await window.electronAPI?.startRun(workspace, speed);
    setLog((current) => [result?.message ?? "실행 결과를 받지 못했습니다.", ...current]);
    const refreshed = (await window.electronAPI?.loadPosts(workspace)) ?? [];
    setPosts(refreshed);
    setRunning(false);
  }

  async function stopRun() {
    await window.electronAPI?.stopRun();
    setRunning(false);
    setLog((current) => ["중지 요청을 보냈습니다.", ...current]);
  }

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div>
          <h1>Naver Blog Automation</h1>
          <p>로컬 글 폴더를 네이버 블로그 임시저장 글로 옮깁니다.</p>
        </div>
        <button onClick={selectWorkspace}>작업 폴더 선택</button>
      </header>

      <section className="controls">
        <label>
          입력 속도
          <select value={speed} onChange={(event) => setSpeed(event.target.value as TypingSpeedName)}>
            <option value="fast">빠름</option>
            <option value="normal">보통</option>
            <option value="slow">느림</option>
          </select>
        </label>
        <button onClick={openLogin}>브라우저 열기 / 로그인 확인</button>
        <button onClick={startRun} disabled={!workspace || running}>
          시작
        </button>
        <button onClick={stopRun} disabled={!running}>
          중지
        </button>
      </section>

      <section className="workspace-path">{workspace || "선택된 작업 폴더 없음"}</section>

      <section className="post-list">
        <h2>글 목록</h2>
        {posts.length === 0 ? (
          <p className="empty">감지된 글 폴더가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>폴더</th>
                <th>제목</th>
                <th>상태</th>
                <th>검증</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id}>
                  <td>{post.id}</td>
                  <td>{post.parsed.title || "-"}</td>
                  <td>{post.status}</td>
                  <td>{post.parsed.errors.map((error) => error.message).join(", ") || "정상"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="log-panel">
        <h2>로그</h2>
        {log.map((entry, index) => (
          <div key={`${entry}-${index}`}>{entry}</div>
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Replace styles**

Write `src/renderer/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Segoe UI", system-ui, sans-serif;
  background: #f7f8fa;
  color: #20242a;
}

button,
select {
  border: 1px solid #c8ced8;
  border-radius: 6px;
  background: #ffffff;
  color: #20242a;
  font: inherit;
  padding: 8px 12px;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.app-shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px;
}

.toolbar,
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.controls {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.controls label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workspace-path,
.post-list,
.log-panel {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid #d9dee7;
  border-radius: 8px;
  background: #ffffff;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  border-bottom: 1px solid #edf0f4;
  padding: 10px;
  text-align: left;
  vertical-align: top;
}

.empty {
  color: #667085;
}

.log-panel {
  min-height: 160px;
  font-family: Consolas, "Courier New", monospace;
  font-size: 13px;
}
```

- [ ] **Step 4: Add preload bridge**

Create `src/main/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { TypingSpeedName } from "../shared/types";

contextBridge.exposeInMainWorld("electronAPI", {
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),
  loadPosts: (workspacePath: string) => ipcRenderer.invoke("posts:load", workspacePath),
  openLogin: () => ipcRenderer.invoke("naver:login"),
  startRun: (workspacePath: string, speed: TypingSpeedName) => ipcRenderer.invoke("run:start", workspacePath, speed),
  stopRun: () => ipcRenderer.invoke("run:stop")
});
```

Modify `src/main/main.ts` `webPreferences`:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  preload: path.join(app.getAppPath(), "dist-main", "main", "preload.js")
}
```

- [ ] **Step 5: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/renderer/App.tsx src/renderer/styles.css src/main/preload.ts src/main/main.ts
git commit -m "feat: add desktop control UI"
```

---

### Task 10: Add Manual Test Checklist and Final Verification

**Files:**
- Create: `docs/manual-test-checklist.md`

- [ ] **Step 1: Write manual checklist**

Write `docs/manual-test-checklist.md`:

```md
# Manual Test Checklist

## Fixture Workspace

Create a workspace with this shape:

```text
workspace/
  posts/
    001-first-post/
      content.txt
      images/
        hero.png
```

Use this `content.txt`:

```text
[TITLE]임시저장 테스트 글[/TITLE]

일반 문단입니다.

[BOLD]굵게 들어가는 문장입니다.[/BOLD]

[QUOTE]
인용구 문장입니다.
여러 줄 인용도 확인합니다.
[/QUOTE]

[HR]

[IMAGE:images/hero.png]

이미지 아래 문단입니다.
```

## Checks

- App opens without renderer errors.
- 작업 폴더 선택 후 글 목록에 `001-first-post`가 표시된다.
- 검증 상태가 `정상`으로 표시된다.
- 브라우저 열기 / 로그인 확인 버튼으로 전용 Chrome 프로필이 열린다.
- 사용자가 네이버에 직접 로그인할 수 있다.
- 시작 버튼을 누르면 네이버 블로그 글쓰기 화면으로 이동한다.
- 제목이 입력된다.
- 일반 문단, 볼드 문장, 인용구, 구분선, 이미지, 마지막 문단이 순서대로 입력된다.
- 앱은 발행하지 않고 임시저장 버튼을 누른다.
- `status.json`에 `draft_saved`가 기록된다.
- `run-log.txt`에 시작과 임시저장 성공 로그가 기록된다.
- 로그인 만료 화면이 나오면 자동화가 중단된다.
```

- [ ] **Step 2: Run all automated tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: TypeScript and Vite build succeed.

- [ ] **Step 4: Run manual smoke test**

Run: `npm run electron:dev`

Expected: desktop app opens. Complete `docs/manual-test-checklist.md` against a test or private Naver Blog.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs/manual-test-checklist.md
git commit -m "docs: add manual naver test checklist"
```

---

## Self-Review

Spec coverage:

- Desktop GUI: Task 1 and Task 9.
- Electron or Tauri decision: implemented as Electron in Task 1.
- Node.js Playwright: Task 7.
- Dedicated Chrome profile: Task 7 and Task 8.
- One post equals one folder: Task 4.
- Explicit tag markers: Task 3.
- Always save as draft: Task 6 and Task 7.
- Typing speed presets: Task 2 and Task 9.
- Retry transient failures and stop on hard failures: Task 6.
- Status and logs: Task 5 and Task 6.
- Local tests and manual integration checklist: Tasks 2 through 6 and Task 10.

Completion-marker scan:

- No unfinished-marker or missing implementation sections are intentionally left in this plan.
- Naver selectors are implemented as concrete candidate selectors in `src/automation/selectors.ts`. Manual testing may reveal selector changes required by the live Naver editor.

Type consistency:

- `TypingSpeedName`, `PostJob`, `EditorEvent`, and `PostStatus` are defined in `src/shared/types.ts`.
- `AutomationEngine.saveDraft(job, { speed })` is used consistently by the orchestrator and Playwright adapter.
- `PostJob.parsed.events` is the single event source for automation.
