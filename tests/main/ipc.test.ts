import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginStateSnapshot } from "../../src/shared/types";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const automation = { close: vi.fn(), saveDraft: vi.fn(), verifySession: vi.fn() };
  const snapshot: LoginStateSnapshot = {
    state: "unverified",
    message: "Login session has not been verified",
    manualChromeRunning: false
  };
  const coordinator = {
    initialize: vi.fn().mockResolvedValue(snapshot),
    getState: vi.fn(() => snapshot),
    openManualLogin: vi.fn(),
    verifySession: vi.fn(),
    clearSecurityHold: vi.fn(),
    requireReadyAutomation: vi.fn(() => automation),
    enterSecurityHold: vi.fn(),
    close: vi.fn()
  };

  return {
    handlers,
    automation,
    snapshot,
    coordinator,
    dialog: { showOpenDialog: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
        handlers.set(channel, handler);
      })
    },
    loadPosts: vi.fn(),
    runPosts: vi.fn(),
    readBlogConfig: vi.fn(),
    writeBlogConfig: vi.fn(),
    resolveReview: vi.fn(),
    getBrowserProfilePath: vi.fn(() => "profile-path"),
    getSecurityHoldPath: vi.fn(() => "security-hold-path"),
    getBlogConfigPath: vi.fn(() => "blog-config-path"),
    launcher: { open: vi.fn(), isRunning: vi.fn(), getCdpEndpoint: vi.fn() },
    ManualChromeLoginLauncher: vi.fn(),
    attachTistoryAutomation: vi.fn(),
    LoginSessionCoordinator: vi.fn()
  };
});

vi.mock("electron", () => ({ dialog: mocks.dialog, ipcMain: mocks.ipcMain }));
vi.mock("../../src/core/postLoader", () => ({ loadPosts: mocks.loadPosts }));
vi.mock("../../src/core/runOrchestrator", () => ({ runPosts: mocks.runPosts }));
vi.mock("../../src/core/blogConfig", () => ({
  readBlogConfig: mocks.readBlogConfig,
  writeBlogConfig: mocks.writeBlogConfig
}));
vi.mock("../../src/core/statusStore", () => ({ resolveReview: mocks.resolveReview }));
vi.mock("../../src/main/appPaths", () => ({
  getBrowserProfilePath: mocks.getBrowserProfilePath,
  getSecurityHoldPath: mocks.getSecurityHoldPath,
  getBlogConfigPath: mocks.getBlogConfigPath
}));
vi.mock("../../src/main/ManualChromeLoginLauncher", () => ({
  ManualChromeLoginLauncher: mocks.ManualChromeLoginLauncher
}));
vi.mock("../../src/automation/TistoryBlogAutomation", () => ({
  TistoryBlogAutomation: { attach: mocks.attachTistoryAutomation }
}));
vi.mock("../../src/main/LoginSessionCoordinator", () => ({
  LoginSessionCoordinator: mocks.LoginSessionCoordinator
}));

describe("registerIpcHandlers", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.ManualChromeLoginLauncher.mockImplementation(() => mocks.launcher);
    mocks.attachTistoryAutomation.mockReturnValue(mocks.automation);
    mocks.LoginSessionCoordinator.mockImplementation(() => mocks.coordinator);
    mocks.coordinator.initialize.mockResolvedValue(mocks.snapshot);
    mocks.coordinator.getState.mockReturnValue(mocks.snapshot);
    mocks.coordinator.requireReadyAutomation.mockReturnValue(mocks.automation);
    mocks.coordinator.openManualLogin.mockResolvedValue({ ok: true, snapshot: mocks.snapshot });
    mocks.coordinator.verifySession.mockResolvedValue({ ok: true, snapshot: mocks.snapshot });
    mocks.coordinator.clearSecurityHold.mockResolvedValue(mocks.snapshot);
    mocks.coordinator.enterSecurityHold.mockResolvedValue(mocks.snapshot);
    mocks.coordinator.close.mockResolvedValue(undefined);
    mocks.readBlogConfig.mockResolvedValue(null);
    mocks.writeBlogConfig.mockResolvedValue(undefined);
    mocks.resolveReview.mockResolvedValue(undefined);
  });

  async function register() {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    await registerIpcHandlers();
  }

  it("initializes one coordinator before registering the expected IPC channels", async () => {
    let resolveInitialization!: () => void;
    mocks.coordinator.initialize.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveInitialization = resolve; })
    );

    const registration = register();
    await vi.waitFor(() => expect(mocks.coordinator.initialize).toHaveBeenCalledOnce());
    expect(mocks.handlers.size).toBe(0);
    resolveInitialization();
    await registration;

    expect(mocks.LoginSessionCoordinator).toHaveBeenCalledOnce();
    expect(mocks.LoginSessionCoordinator).toHaveBeenCalledWith({
      launcher: mocks.launcher,
      createAutomation: expect.any(Function),
      profilePath: "profile-path",
      holdPath: "security-hold-path"
    });
    expect([...mocks.handlers.keys()].sort()).toEqual([
      "blog:getConfig",
      "blog:saveConfig",
      "login:clearSecurityHold",
      "login:getState",
      "login:openManual",
      "login:verify",
      "posts:load",
      "review:resolve",
      "run:start",
      "run:stop",
      "workspace:select"
    ]);
  });

  it("reads and saves the single target blog configuration", async () => {
    const config = { blogUrl: "https://sample.tistory.com" };
    await register();
    mocks.readBlogConfig.mockResolvedValue(config);

    await expect(mocks.handlers.get("blog:getConfig")?.()).resolves.toBe(config);
    await expect(mocks.handlers.get("blog:saveConfig")?.({}, "sample.tistory.com")).resolves.toEqual(config);
    expect(mocks.readBlogConfig).toHaveBeenCalledWith("blog-config-path");
    expect(mocks.writeBlogConfig).toHaveBeenCalledWith("blog-config-path", { blogUrl: "sample.tistory.com" });
  });

  it("validates blog configuration and review IPC arguments", async () => {
    await register();
    await expect(mocks.handlers.get("blog:saveConfig")?.({}, 42)).rejects.toThrow(/blog URL/i);
    await expect(mocks.handlers.get("review:resolve")?.({}, {}, "unknown")).rejects.toThrow(/review outcome/i);
    expect(mocks.writeBlogConfig).not.toHaveBeenCalled();
    expect(mocks.resolveReview).not.toHaveBeenCalled();
  });

  it("delegates an explicit review resolution", async () => {
    const job = {
      id: "001",
      folderPath: "C:\\workspace\\001",
      contentPath: "C:\\workspace\\001\\content.txt",
      status: "needs_review",
      parsed: {
        title: "Title",
        metadata: { publication: "public", category: null, tags: [], scheduledAt: null },
        events: [],
        errors: []
      }
    };
    await register();

    await expect(mocks.handlers.get("review:resolve")?.({}, job, "not_created")).resolves.toEqual({ ok: true });
    expect(mocks.resolveReview).toHaveBeenCalledWith(job, "not_created");
  });

  it("constructs coordinator automation by attaching to the manual Chrome endpoint", async () => {
    mocks.readBlogConfig.mockResolvedValue({ blogUrl: "https://sample.tistory.com" });
    await register();
    const dependencies = mocks.LoginSessionCoordinator.mock.calls[0][0];

    expect(dependencies.createAutomation("http://127.0.0.1:9222")).toBe(mocks.automation);
    expect(mocks.attachTistoryAutomation).toHaveBeenCalledWith(
      "http://127.0.0.1:9222",
      "https://sample.tistory.com"
    );
  });

  it("requires a configured blog before creating attached automation", async () => {
    await register();
    const dependencies = mocks.LoginSessionCoordinator.mock.calls[0][0];

    expect(() => dependencies.createAutomation("http://127.0.0.1:9222")).toThrow(/blog URL/i);
    expect(mocks.attachTistoryAutomation).not.toHaveBeenCalled();
  });

  it("delegates explicit login commands to the coordinator", async () => {
    await register();

    await expect(mocks.handlers.get("login:getState")?.()).resolves.toBe(mocks.snapshot);
    await expect(mocks.handlers.get("login:openManual")?.()).resolves.toEqual({ ok: true, snapshot: mocks.snapshot });
    await expect(mocks.handlers.get("login:verify")?.()).resolves.toEqual({ ok: true, snapshot: mocks.snapshot });
    await expect(mocks.handlers.get("login:clearSecurityHold")?.()).resolves.toBe(mocks.snapshot);

    expect(mocks.coordinator.getState).toHaveBeenCalledOnce();
    expect(mocks.coordinator.openManualLogin).toHaveBeenCalledOnce();
    expect(mocks.coordinator.verifySession).toHaveBeenCalledOnce();
    expect(mocks.coordinator.clearSecurityHold).toHaveBeenCalledOnce();
  });

  it("opens a directory picker and loads posts", async () => {
    const posts = [{ id: "001" }];
    await register();
    mocks.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["C:\\workspace"] });
    mocks.loadPosts.mockResolvedValue(posts);

    await expect(mocks.handlers.get("workspace:select")?.()).resolves.toBe("C:\\workspace");
    await expect(mocks.handlers.get("posts:load")?.({}, "C:\\workspace")).resolves.toBe(posts);
    expect(mocks.loadPosts).toHaveBeenCalledWith("C:\\workspace");
  });

  it("blocks run:start unless the coordinator is ready", async () => {
    await register();
    mocks.coordinator.requireReadyAutomation.mockImplementation(() => {
      throw new Error("로그인 확인이 필요합니다");
    });

    await expect(mocks.handlers.get("run:start")?.({}, "C:\\workspace", "normal", 1))
      .rejects.toThrow("로그인 확인이 필요합니다");
    expect(mocks.loadPosts).not.toHaveBeenCalled();
    expect(mocks.runPosts).not.toHaveBeenCalled();
  });

  it("runs with the retained ready automation and forwards progress", async () => {
    const posts = [{ id: "001" }];
    const sender = { send: vi.fn() };
    const runResult = { stopped: false, message: "ok" };
    await register();
    mocks.loadPosts.mockResolvedValue(posts);
    mocks.runPosts.mockImplementation(async (_posts, _automation, options) => {
      options.onLog("001 title entered");
      return runResult;
    });

    await expect(mocks.handlers.get("run:start")?.({ sender }, "C:\\workspace", "normal", 1)).resolves.toBe(runResult);

    expect(mocks.coordinator.requireReadyAutomation).toHaveBeenCalledOnce();
    expect(mocks.runPosts).toHaveBeenCalledWith(posts, mocks.automation, {
      speed: "normal",
      signal: expect.any(AbortSignal),
      closeEngine: false,
      onLog: expect.any(Function),
      maxPosts: 1
    });
    expect(sender.send).toHaveBeenCalledWith("run:log", "001 title entered");
    expect(mocks.coordinator.close).not.toHaveBeenCalled();
  });

  it("enters security hold exactly once for post-start authentication loss", async () => {
    await register();
    mocks.loadPosts.mockResolvedValue([]);
    mocks.coordinator.enterSecurityHold.mockImplementationOnce(async () => {
      await mocks.automation.close();
      return mocks.snapshot;
    });
    mocks.runPosts.mockResolvedValue({
      stopped: true,
      reason: "security",
      message: "Tistory requires login or security verification. Automation stopped."
    });

    await mocks.handlers.get("run:start")?.({}, "C:\\workspace", "normal");
    expect(mocks.runPosts.mock.calls[0][2]).toMatchObject({ closeEngine: false });
    expect(mocks.coordinator.enterSecurityHold).toHaveBeenCalledOnce();
    expect(mocks.coordinator.enterSecurityHold).toHaveBeenCalledWith(
      "Tistory requires login or security verification. Automation stopped."
    );
    expect(mocks.coordinator.close).not.toHaveBeenCalled();
    expect(mocks.automation.close).toHaveBeenCalledOnce();
  });

  it("closes coordinator-owned automation exactly once after an editor failure", async () => {
    await register();
    mocks.loadPosts.mockResolvedValue([]);
    mocks.coordinator.close.mockImplementationOnce(() => mocks.automation.close());
    mocks.runPosts.mockResolvedValue({ stopped: true, reason: "editor", message: "Editor failed" });

    await expect(mocks.handlers.get("run:start")?.({}, "C:\\workspace", "normal")).resolves.toEqual({
      stopped: true,
      reason: "editor",
      message: "Editor failed"
    });

    expect(mocks.runPosts.mock.calls[0][2]).toMatchObject({ closeEngine: false });
    expect(mocks.coordinator.close).toHaveBeenCalledOnce();
    expect(mocks.coordinator.enterSecurityHold).not.toHaveBeenCalled();
    expect(mocks.automation.close).toHaveBeenCalledOnce();
  });

  it("rejects concurrent runs and login actions while a run is active", async () => {
    let resolveRun!: (value: unknown) => void;
    await register();
    mocks.loadPosts.mockResolvedValue([]);
    mocks.runPosts.mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));

    const firstRun = mocks.handlers.get("run:start")?.({}, "C:\\workspace", "normal");
    await vi.waitFor(() => expect(mocks.runPosts).toHaveBeenCalledOnce());

    await expect(mocks.handlers.get("run:start")?.({}, "C:\\workspace", "normal")).resolves.toEqual({
      stopped: true,
      message: "Run already in progress"
    });
    await expect(mocks.handlers.get("login:openManual")?.()).resolves.toEqual({
      ok: false,
      snapshot: mocks.snapshot
    });
    await expect(mocks.handlers.get("login:verify")?.()).resolves.toEqual({
      ok: false,
      snapshot: mocks.snapshot
    });
    await expect(mocks.handlers.get("login:clearSecurityHold")?.()).resolves.toBe(mocks.snapshot);
    expect(mocks.coordinator.openManualLogin).not.toHaveBeenCalled();
    expect(mocks.coordinator.verifySession).not.toHaveBeenCalled();
    expect(mocks.coordinator.clearSecurityHold).not.toHaveBeenCalled();

    resolveRun({ stopped: false, message: "ok" });
    await firstRun;
  });

  it("aborts on run:stop and closes exactly once when the active run settles", async () => {
    let resolveRun!: (value: unknown) => void;
    await register();
    mocks.loadPosts.mockResolvedValue([]);
    mocks.coordinator.close.mockImplementationOnce(() => mocks.automation.close());
    mocks.runPosts.mockImplementationOnce((_posts, _automation, options) => new Promise((resolve) => {
      expect(options.signal.aborted).toBe(false);
      resolveRun = resolve;
    }));

    const firstRun = mocks.handlers.get("run:start")?.({}, "C:\\workspace", "normal");
    await vi.waitFor(() => expect(mocks.runPosts).toHaveBeenCalledOnce());
    await expect(mocks.handlers.get("run:stop")?.()).resolves.toEqual({ ok: true });

    expect(mocks.coordinator.close).not.toHaveBeenCalled();
    const options = mocks.runPosts.mock.calls[0][2];
    expect(options.signal.aborted).toBe(true);
    await expect(mocks.handlers.get("run:start")?.({}, "C:\\workspace", "normal")).resolves.toEqual({
      stopped: true,
      message: "Run already in progress"
    });

    resolveRun({ stopped: true, message: "Run stopped by user" });
    await firstRun;
    expect(options).toMatchObject({ closeEngine: false });
    expect(mocks.coordinator.close).toHaveBeenCalledOnce();
    expect(mocks.coordinator.enterSecurityHold).not.toHaveBeenCalled();
    expect(mocks.automation.close).toHaveBeenCalledOnce();
  });

  it("closes exactly once when stopped while loadPosts is still pending", async () => {
    let resolvePosts!: (posts: unknown[]) => void;
    let coordinatorState: LoginStateSnapshot = {
      state: "ready",
      message: "Login session verified",
      manualChromeRunning: false
    };
    await register();
    mocks.coordinator.getState.mockImplementation(() => coordinatorState);
    mocks.coordinator.close.mockImplementation(async () => {
      coordinatorState = mocks.snapshot;
    });
    mocks.loadPosts.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePosts = resolve; })
    );

    const run = mocks.handlers.get("run:start")?.({}, "C:\\workspace", "normal");
    await vi.waitFor(() => expect(mocks.loadPosts).toHaveBeenCalledOnce());
    await expect(mocks.handlers.get("run:stop")?.()).resolves.toEqual({ ok: true });
    expect(mocks.coordinator.close).not.toHaveBeenCalled();

    resolvePosts([]);

    await expect(run).resolves.toEqual({
      stopped: true,
      reason: "stopped",
      message: "Run stopped by user"
    });
    expect(mocks.runPosts).not.toHaveBeenCalled();
    expect(mocks.coordinator.close).toHaveBeenCalledOnce();
    await expect(mocks.handlers.get("login:getState")?.()).resolves.toMatchObject({
      state: "unverified"
    });
  });

  it("closes the retained coordinator automation when run:stop has no active run", async () => {
    await register();

    await expect(mocks.handlers.get("run:stop")?.()).resolves.toEqual({ ok: true });

    expect(mocks.coordinator.close).toHaveBeenCalledOnce();
  });
});

describe("renderer run lifecycle", () => {
  it("stays non-idle after stop is requested until the original run settles", async () => {
    const { transitionRunPhase } = await import("../../src/renderer/App");

    const running = transitionRunPhase("idle", "start");
    const stopping = transitionRunPhase(running, "stop_requested");

    expect(stopping).toBe("stopping");
    expect(transitionRunPhase(stopping, "settled")).toBe("idle");
  });
});
