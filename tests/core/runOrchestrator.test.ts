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
      metadata: { publication: "draft", category: null, tags: [], scheduledAt: null },
      errors: [],
      events: [{ type: "setTitle", text: "Title" }, { type: "typeText", text: "Body" }]
    }
  };
}

describe("runPosts", () => {
  it("processes pending posts sequentially and records draft_saved", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-post-a-"));
    const secondFolder = await fs.mkdtemp(path.join(os.tmpdir(), "run-post-b-"));
    const calls: string[] = [];
    let closeCalls = 0;
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft(job) {
        calls.push(job.id);
        return { ok: true };
      },
      async close() {
        closeCalls += 1;
      }
    };

    const result = await runPosts([makeJob(folder), makeJob(secondFolder)], engine, { speed: "normal" });

    expect(calls).toEqual([path.basename(folder), path.basename(secondFolder)]);
    expect(result.stopped).toBe(false);
    expect(closeCalls).toBe(1);
    const status = JSON.parse(await fs.readFile(path.join(folder, "status.json"), "utf8"));
    expect(status.status).toBe("draft_saved");
    await expect(fs.access(path.join(folder, "_SUCCESS.done"))).resolves.toBeUndefined();
  });

  it("keeps the browser engine open after successful runs when requested", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-keep-open-"));
    let closed = false;
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft() {
        return { ok: true };
      },
      async close() {
        closed = true;
      }
    };

    const result = await runPosts([makeJob(folder)], engine, { speed: "normal", closeOnSuccess: false });

    expect(result.stopped).toBe(false);
    expect(closed).toBe(false);
    await expect(fs.access(path.join(folder, "_SUCCESS.done"))).resolves.toBeUndefined();
  });

  it("does not close a coordinator-owned engine when lifecycle ownership is disabled", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-coordinator-owned-"));
    let closeCalls = 0;
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft() {
        return { ok: false, retryable: false, reason: "editor", message: "Editor failed" };
      },
      async close() {
        closeCalls += 1;
      }
    };

    await expect(runPosts([makeJob(folder)], engine, { speed: "normal", closeEngine: false })).resolves.toEqual({
      stopped: true,
      reason: "editor",
      message: "Editor failed"
    });
    expect(closeCalls).toBe(0);
  });

  it("emits readable progress logs while running posts", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-progress-"));
    const messages: string[] = [];
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft(_job, options) {
        options.onLog?.("custom automation step");
        return { ok: true };
      },
      async close() {}
    };

    await runPosts([makeJob(folder)], engine, { speed: "normal", onLog: (message) => messages.push(message) });

    expect(messages).toEqual([
      `Starting ${path.basename(folder)}`,
      "custom automation step",
      `Saved draft for ${path.basename(folder)}`
    ]);
  });

  it("limits the number of pending posts processed in one run", async () => {
    const firstFolder = await fs.mkdtemp(path.join(os.tmpdir(), "run-limit-a-"));
    const secondFolder = await fs.mkdtemp(path.join(os.tmpdir(), "run-limit-b-"));
    const thirdFolder = await fs.mkdtemp(path.join(os.tmpdir(), "run-limit-c-"));
    const calls: string[] = [];
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft(job) {
        calls.push(job.id);
        return { ok: true };
      },
      async close() {}
    };

    const result = await runPosts(
      [makeJob(firstFolder), makeJob(secondFolder), makeJob(thirdFolder)],
      engine,
      { speed: "normal", maxPosts: 2 }
    );

    expect(result.stopped).toBe(false);
    expect(calls).toEqual([path.basename(firstFolder), path.basename(secondFolder)]);
    await expect(fs.access(path.join(firstFolder, "_SUCCESS.done"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(secondFolder, "_SUCCESS.done"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(thirdFolder, "_SUCCESS.done"))).rejects.toThrow();
  });

  it("does not retry a failed post", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-no-retry-"));
    let attempts = 0;
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft() {
        attempts += 1;
        return { ok: false, retryable: true, reason: "editor", message: "Editor failed" };
      },
      async close() {}
    };

    const result = await runPosts([makeJob(folder)], engine, { speed: "normal" });

    expect(attempts).toBe(1);
    expect(result).toEqual({ stopped: true, reason: "editor", message: "Editor failed" });
    const status = JSON.parse(await fs.readFile(path.join(folder, "status.json"), "utf8"));
    expect(status.status).toBe("failed");
    const log = await fs.readFile(path.join(folder, "run-log.txt"), "utf8");
    expect(log).toContain(`Started post ${path.basename(folder)}`);
    expect(log).toContain("Failed: Editor failed");
    await expect(fs.access(path.join(folder, "_SUCCESS.done"))).rejects.toThrow();
  });

  it("stops on non-retryable login failure", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-stop-"));
    const laterFolder = await fs.mkdtemp(path.join(os.tmpdir(), "run-stop-later-"));
    const calls: string[] = [];
    let closed = false;
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft(job) {
        calls.push(job.id);
        return { ok: false, retryable: false, reason: "missing_session", message: "Login required" };
      },
      async close() {
        closed = true;
      }
    };

    const result = await runPosts([makeJob(folder), makeJob(laterFolder)], engine, { speed: "normal" });

    expect(calls).toEqual([path.basename(folder)]);
    expect(result.stopped).toBe(true);
    expect(result.message).toBe("Login required");
    expect(closed).toBe(true);
    const status = JSON.parse(await fs.readFile(path.join(folder, "status.json"), "utf8"));
    expect(status.status).toBe("failed");
    expect(status.message).toBe("Login required");
  });

  it("returns the typed failure when cleanup rejects", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-close-reject-"));
    let closeCalls = 0;
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft() {
        return { ok: false, retryable: false, reason: "editor", message: "Editor failed" };
      },
      async close() {
        closeCalls += 1;
        throw new Error("Close failed");
      }
    };

    await expect(runPosts([makeJob(folder)], engine, { speed: "normal" })).resolves.toEqual({
      stopped: true,
      reason: "editor",
      message: "Editor failed"
    });
    expect(closeCalls).toBe(1);
  });

  it("records thrown saveDraft errors as failed and closes the engine", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-throw-"));
    let closeCalls = 0;
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft() {
        throw new Error("Browser crashed");
      },
      async close() {
        closeCalls += 1;
      }
    };

    const result = await runPosts([makeJob(folder)], engine, { speed: "normal" });

    expect(result).toEqual({ stopped: true, reason: "editor", message: "Browser crashed" });
    expect(closeCalls).toBe(1);
    const status = JSON.parse(await fs.readFile(path.join(folder, "status.json"), "utf8"));
    expect(status.status).toBe("failed");
    expect(status.message).toBe("Browser crashed");
  });

  it("skips non-pending jobs", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-skip-"));
    const job = makeJob(folder);
    job.status = "validation_error";
    const calls: string[] = [];
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft(saveJob) {
        calls.push(saveJob.id);
        return { ok: true };
      },
      async close() {}
    };

    const result = await runPosts([job], engine, { speed: "normal" });

    expect(calls).toEqual([]);
    expect(result.stopped).toBe(false);
  });

  it("records stopped when aborted during a running post", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "run-abort-"));
    const controller = new AbortController();
    const engine: AutomationEngine = {
      async verifySession() { return { ok: true }; },
      async saveDraft() {
        controller.abort();
        return { ok: true };
      },
      async close() {}
    };

    const result = await runPosts([makeJob(folder)], engine, { speed: "normal", signal: controller.signal });

    expect(result).toEqual({ stopped: true, reason: "stopped", message: "Run stopped by user" });
    const status = JSON.parse(await fs.readFile(path.join(folder, "status.json"), "utf8"));
    expect(status.status).toBe("stopped");
    const log = await fs.readFile(path.join(folder, "run-log.txt"), "utf8");
    expect(log).toContain(`Started post ${path.basename(folder)}`);
    expect(log).toContain("Failed: Run stopped by user");
    await expect(fs.access(path.join(folder, "_SUCCESS.done"))).rejects.toThrow();
  });
});
