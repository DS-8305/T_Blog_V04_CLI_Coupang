import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationEngine } from "../../src/automation/AutomationEngine";
import type { SessionVerificationResult } from "../../src/shared/types";
import { LoginSessionCoordinator } from "../../src/main/LoginSessionCoordinator";

type VerifiedAutomation = Omit<AutomationEngine, "openLoginWindow"> & {
  verifySession(): Promise<SessionVerificationResult>;
};

function createAutomation(result: SessionVerificationResult = { ok: true }): VerifiedAutomation {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    saveDraft: vi.fn(),
    verifySession: vi.fn().mockResolvedValue(result)
  };
}

describe("LoginSessionCoordinator", () => {
  let temporaryDirectory: string;
  let holdPath: string;
  let profilePath: string;
  let launcher: {
    open: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;
    getCdpEndpoint: ReturnType<typeof vi.fn>;
  };
  let automation: VerifiedAutomation;
  let createAutomationFactory: ReturnType<typeof vi.fn>;
  let coordinator: LoginSessionCoordinator;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "n-blog-login-session-"));
    holdPath = path.join(temporaryDirectory, "security-hold.json");
    profilePath = path.join(temporaryDirectory, "browser-profile");
    launcher = {
      open: vi.fn().mockResolvedValue(undefined),
      isRunning: vi.fn().mockReturnValue(true),
      getCdpEndpoint: vi.fn().mockReturnValue("http://127.0.0.1:9224")
    };
    automation = createAutomation();
    createAutomationFactory = vi.fn(() => automation);
    coordinator = new LoginSessionCoordinator({
      launcher,
      createAutomation: createAutomationFactory,
      profilePath,
      holdPath
    });
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("verifies through the attached manual Chrome session", async () => {
    const result = await coordinator.verifySession();

    expect(result).toMatchObject({ ok: true, snapshot: { state: "ready" } });
    expect(createAutomationFactory).toHaveBeenCalledWith("http://127.0.0.1:9224");
    expect(automation.verifySession).toHaveBeenCalledOnce();
  });

  it("requires the manual Chrome process before verification", async () => {
    launcher.isRunning.mockReturnValue(false);

    const result = await coordinator.verifySession();

    expect(result.ok).toBe(false);
    expect(result.snapshot.state).toBe("unverified");
    expect(result.snapshot.message).toContain("Chrome");
    expect(createAutomationFactory).not.toHaveBeenCalled();
  });

  it("requires an available CDP endpoint from the manual Chrome process", async () => {
    launcher.getCdpEndpoint.mockReturnValue(undefined);

    const result = await coordinator.verifySession();

    expect(result.ok).toBe(false);
    expect(result.snapshot.state).toBe("unverified");
    expect(result.snapshot.message).toContain("Chrome");
    expect(createAutomationFactory).not.toHaveBeenCalled();
  });

  it("retains the verified automation and enters ready", async () => {
    const result = await coordinator.verifySession();

    expect(result.snapshot.state).toBe("ready");
    expect(automation.verifySession).toHaveBeenCalledOnce();
    expect(coordinator.requireReadyAutomation()).toBe(automation);
  });

  it("persists security hold and closes verification automation", async () => {
    automation = createAutomation({
      ok: false,
      reason: "security",
      message: "Security verification required"
    });
    createAutomationFactory.mockImplementation(() => automation);

    const result = await coordinator.verifySession();

    expect(result.snapshot.state).toBe("security_hold");
    expect(automation.close).toHaveBeenCalledOnce();
    await expect(readFile(holdPath, "utf8")).resolves.toContain("Security verification required");
  });

  it("persists a fallback security hold when the primary hold path is not writable", async () => {
    holdPath = temporaryDirectory;
    automation = createAutomation({
      ok: false,
      reason: "security",
      message: "Security verification required"
    });
    createAutomationFactory.mockImplementation(() => automation);
    coordinator = new LoginSessionCoordinator({
      launcher,
      createAutomation: createAutomationFactory,
      profilePath,
      holdPath
    });

    await coordinator.verifySession();

    const fallbackHoldPath = path.join(profilePath, "security-hold.json");
    await expect(readFile(fallbackHoldPath, "utf8")).resolves.toContain("Security verification required");

    const restartedCoordinator = new LoginSessionCoordinator({
      launcher,
      createAutomation: createAutomationFactory,
      profilePath,
      holdPath
    });
    await restartedCoordinator.initialize();

    expect(restartedCoordinator.getState().state).toBe("security_hold");
  });

  it("restores security hold on initialize and clears only explicitly", async () => {
    await writeFile(holdPath, JSON.stringify({ heldAt: new Date().toISOString(), message: "held" }));

    await coordinator.initialize();

    expect(coordinator.getState().state).toBe("security_hold");
    await coordinator.clearSecurityHold();
    expect(coordinator.getState().state).toBe("unverified");
    await expect(readFile(holdPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["missing", "profile_error"] as const)("closes the automation and returns to unverified for %s", async (reason) => {
    automation = createAutomation({ ok: false, reason, message: `${reason} session` });
    createAutomationFactory.mockImplementation(() => automation);

    const result = await coordinator.verifySession();

    expect(result.snapshot.state).toBe("unverified");
    expect(automation.close).toHaveBeenCalledOnce();
    expect(() => coordinator.requireReadyAutomation()).toThrow("No verified automation is ready");
  });

  it("does not create a second automation during an in-flight verification", async () => {
    let resolveVerification!: (result: SessionVerificationResult) => void;
    automation.verifySession = vi.fn(
      () => new Promise<SessionVerificationResult>((resolve) => {
        resolveVerification = resolve;
      })
    );

    const first = coordinator.verifySession();
    const second = await coordinator.verifySession();
    resolveVerification({ ok: true });
    const firstResult = await first;

    expect(second).toMatchObject({ ok: false, snapshot: { state: "checking" } });
    expect(firstResult.snapshot.state).toBe("ready");
    expect(createAutomationFactory).toHaveBeenCalledOnce();
    expect(automation.verifySession).toHaveBeenCalledOnce();
  });

  it("rejects manual login while verification is in progress", async () => {
    let resolveVerification!: (result: SessionVerificationResult) => void;
    automation.verifySession = vi.fn(
      () => new Promise<SessionVerificationResult>((resolve) => {
        resolveVerification = resolve;
      })
    );

    const verification = coordinator.verifySession();
    const manualLogin = await coordinator.openManualLogin();
    resolveVerification({ ok: true });
    await verification;

    expect(manualLogin).toMatchObject({ ok: false, snapshot: { state: "checking" } });
    expect(launcher.open).not.toHaveBeenCalled();
  });

  it("blocks verification while manual login is still opening", async () => {
    launcher.isRunning.mockReturnValue(false);
    let resolveOpen!: () => void;
    launcher.open.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveOpen = resolve;
      })
    );

    const manualLogin = coordinator.openManualLogin();
    const verification = await coordinator.verifySession();
    resolveOpen();
    await manualLogin;

    expect(verification).toMatchObject({ ok: false, snapshot: { state: "login_open" } });
    expect(createAutomationFactory).not.toHaveBeenCalled();
  });

  it("keeps manual Chrome open while verifying after a successful manual login", async () => {
    launcher.isRunning.mockReturnValue(false);
    await coordinator.openManualLogin();
    launcher.isRunning.mockReturnValue(true);

    const verification = await coordinator.verifySession();

    expect(verification).toMatchObject({ ok: true, snapshot: { state: "ready" } });
    expect(createAutomationFactory).toHaveBeenCalledWith("http://127.0.0.1:9224");
    expect(automation.verifySession).toHaveBeenCalledOnce();
  });

  it("keeps a security hold when verification resolves after the hold is entered", async () => {
    let resolveVerification!: (result: SessionVerificationResult) => void;
    automation.verifySession = vi.fn(
      () => new Promise<SessionVerificationResult>((resolve) => {
        resolveVerification = resolve;
      })
    );

    const verification = coordinator.verifySession();
    await coordinator.enterSecurityHold("Manual security hold");
    resolveVerification({ ok: true });
    const verificationResult = await verification;

    expect(verificationResult).toMatchObject({ ok: false, snapshot: { state: "security_hold" } });
    expect(coordinator.getState().state).toBe("security_hold");
    await expect(readFile(holdPath, "utf8")).resolves.toContain("Manual security hold");
  });

  it("persists a security hold and blocks reuse when automation close rejects", async () => {
    automation = createAutomation({ ok: false, reason: "missing", message: "Session is missing" });
    automation.close = vi.fn().mockRejectedValue(new Error("close failed"));
    createAutomationFactory.mockImplementation(() => automation);

    const result = await coordinator.verifySession();
    const verificationAfterCloseFailure = await coordinator.verifySession();
    const manualLoginAfterCloseFailure = await coordinator.openManualLogin();

    expect(result).toMatchObject({ ok: false, snapshot: { state: "security_hold" } });
    expect(verificationAfterCloseFailure).toMatchObject({ ok: false, snapshot: { state: "security_hold" } });
    expect(manualLoginAfterCloseFailure).toMatchObject({ ok: false, snapshot: { state: "security_hold" } });
    expect(automation.close).toHaveBeenCalledOnce();
    expect(createAutomationFactory).toHaveBeenCalledOnce();
    expect(launcher.open).not.toHaveBeenCalled();
    await expect(readFile(holdPath, "utf8")).resolves.toContain("close failed");
  });

  it("opens manual login once and prevents a concurrent duplicate open", async () => {
    launcher.isRunning.mockReturnValue(false);
    let resolveOpen!: () => void;
    launcher.open.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveOpen = resolve;
      })
    );

    const first = coordinator.openManualLogin();
    const second = await coordinator.openManualLogin();
    resolveOpen();
    const firstResult = await first;

    expect(firstResult).toMatchObject({ ok: true, snapshot: { state: "login_open" } });
    expect(second).toMatchObject({ ok: false, snapshot: { state: "login_open" } });
    expect(launcher.open).toHaveBeenCalledOnce();
  });
});
