import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/draftCli";
import type { AutomationEngine } from "../../src/automation/AutomationEngine";
import type { PostJob, SessionVerificationResult } from "../../src/shared/types";

describe("Tistory draft CLI", () => {
  it.each([
    ["launched", "Dedicated Chrome opened. Sign in to Kakao/Tistory and keep it open."],
    ["already_running", "Dedicated Chrome is already open."]
  ] as const)("reports the login result %s", async (launchResult, expectedMessage) => {
    const logs: string[] = [];
    const launchChrome = vi.fn(async () => launchResult);

    const code = await main(["login"], {
      getProfilePath: () => "C:\\shared-profile",
      launchChrome,
      log: (message) => logs.push(message)
    });

    expect(code).toBe(0);
    expect(logs).toEqual([expectedMessage]);
    expect(launchChrome).toHaveBeenCalledWith("C:\\shared-profile");
  });

  it("verifies a Tistory session and closes only the attachment", async () => {
    const logs: string[] = [];
    const automation = createAutomation({ ok: true });

    const code = await main(["verify", "--blog-url", "sample.tistory.com"], {
      attachAutomation: (_endpoint, blogUrl) => {
        expect(blogUrl).toBe("https://sample.tistory.com");
        return automation;
      },
      log: (message) => logs.push(message)
    });

    expect(code).toBe(0);
    expect(logs).toEqual(["Login session verified."]);
    expect(automation.close).toHaveBeenCalledOnce();
  });

  it("returns a clean failure for an unusable Tistory session", async () => {
    const errors: string[] = [];
    const automation = createAutomation({
      ok: false,
      reason: "missing",
      message: "Log in first."
    });

    const code = await main(["verify", "--blog-url", "sample.tistory.com"], {
      attachAutomation: () => automation,
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual(["Log in first."]);
    expect(automation.close).toHaveBeenCalledOnce();
  });

  it("rejects validation errors before attaching to Chrome", async () => {
    const errors: string[] = [];
    const invalidJob = createJob("validation_error", [
      { code: "cli_unsupported_marker", message: "Tistory draft CLI does not allow [PUBLISH] markers." }
    ]);
    const attachAutomation = vi.fn();

    const code = await main(runArgs(), {
      loadPosts: vi.fn(async () => [invalidJob]),
      applyPolicy: vi.fn(async () => [invalidJob]),
      attachAutomation,
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual([
      "Invalid post 001-post: Tistory draft CLI does not allow [PUBLISH] markers."
    ]);
    expect(attachAutomation).not.toHaveBeenCalled();
  });

  it("rejects unresolved needs_review before attaching to Chrome", async () => {
    const errors: string[] = [];
    const reviewJob = createJob("needs_review");
    const attachAutomation = vi.fn();

    const code = await main(runArgs(), {
      loadPosts: vi.fn(async () => [reviewJob]),
      applyPolicy: vi.fn(async () => [reviewJob]),
      attachAutomation,
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual(["Post 001-post requires manual review before another CLI run."]);
    expect(attachAutomation).not.toHaveBeenCalled();
  });

  it("runs validated posts through the existing Tistory orchestrator", async () => {
    const logs: string[] = [];
    const pendingJob = createJob("pending");
    const automation = createAutomation({ ok: true });
    const runPosts = vi.fn(async () => ({ stopped: false, message: "All eligible Tistory posts completed" }));

    const code = await main([
      ...runArgs(),
      "--speed",
      "fast",
      "--max-posts",
      "2"
    ], {
      loadPosts: vi.fn(async () => [pendingJob]),
      applyPolicy: vi.fn(async () => [pendingJob]),
      attachAutomation: () => automation,
      runPosts,
      log: (message) => logs.push(message)
    });

    expect(code).toBe(0);
    expect(runPosts).toHaveBeenCalledWith([pendingJob], automation, {
      speed: "fast",
      maxPosts: 2,
      closeEngine: false,
      onLog: expect.any(Function)
    });
    expect(logs).toEqual(["All eligible Tistory posts completed"]);
    expect(automation.close).toHaveBeenCalledOnce();
  });

  it("returns a failure when the orchestrator stops", async () => {
    const errors: string[] = [];
    const pendingJob = createJob("pending");
    const automation = createAutomation({ ok: true });

    const code = await main(runArgs(), {
      loadPosts: vi.fn(async () => [pendingJob]),
      applyPolicy: vi.fn(async () => [pendingJob]),
      attachAutomation: () => automation,
      runPosts: vi.fn(async () => ({ stopped: true, reason: "editor" as const, message: "Editor stopped." })),
      error: (message) => errors.push(message)
    });

    expect(code).toBe(1);
    expect(errors).toEqual(["Editor stopped."]);
    expect(automation.close).toHaveBeenCalledOnce();
  });
});

function runArgs(): string[] {
  return [
    "run",
    "--workspace",
    "C:\\blog-workspace",
    "--blog-url",
    "sample.tistory.com"
  ];
}

function createAutomation(verification: SessionVerificationResult): AutomationEngine & {
  close: ReturnType<typeof vi.fn>;
} {
  return {
    verifySession: vi.fn(async () => verification),
    saveDraft: vi.fn(async () => ({
      outcome: "confirmed" as const,
      status: "draft_saved" as const
    })),
    close: vi.fn(async () => undefined)
  };
}

function createJob(
  status: PostJob["status"],
  errors: PostJob["parsed"]["errors"] = []
): PostJob {
  return {
    id: "001-post",
    folderPath: "C:\\blog-workspace\\posts\\001-post",
    contentPath: "C:\\blog-workspace\\posts\\001-post\\content.txt",
    status,
    parsed: {
      title: "A",
      metadata: {
        publication: "draft",
        category: null,
        tags: [],
        scheduledAt: null
      },
      events: [{ type: "setTitle", text: "A" }],
      errors
    }
  };
}
