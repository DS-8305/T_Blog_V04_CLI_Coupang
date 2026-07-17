import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANUAL_CHROME_CDP_ENDPOINT,
  ManualChromeLoginLauncher,
  NAVER_HOME_URL,
  type ChromeChildProcess,
  type ChromeLauncherDependencies
} from "../../src/main/ManualChromeLoginLauncher";

class FakeChildProcess extends EventEmitter implements ChromeChildProcess {
  kill = vi.fn(() => true);
}

describe("ManualChromeLoginLauncher", () => {
  let fakeChild: FakeChildProcess;
  let spawn: ReturnType<typeof vi.fn>;
  let dependencies: ChromeLauncherDependencies;

  beforeEach(() => {
    fakeChild = new FakeChildProcess();
    spawn = vi.fn(() => fakeChild);
    dependencies = {
      env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
      canAccess: async (candidate) => {
        if (candidate.includes("Local\\Google\\Chrome")) {
          return;
        }
        throw new Error("missing executable");
      },
      spawn
    };
  });

  it("treats an undefined access result as an accessible Chrome executable", async () => {
    const expected = "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
    const canAccess = vi.fn(async (candidate: string) => {
      if (candidate === expected) {
        return;
      }
      throw new Error("missing executable");
    });

    const launcher = new ManualChromeLoginLauncher({
      env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
      canAccess,
      spawn
    });

    await launcher.open("C:\\profile");

    expect(spawn).toHaveBeenCalledWith(expected, expect.any(Array), expect.any(Object));
    expect(canAccess).toHaveBeenCalledTimes(1);
  });

  it("prefers per-user installed Chrome and launches the dedicated profile", async () => {
    const launcher = new ManualChromeLoginLauncher(dependencies);

    await launcher.open("C:\\profile");

    expect(spawn).toHaveBeenCalledWith(
      "C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
      [
        "--user-data-dir=C:\\profile",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9222",
        "--no-first-run",
        "--no-default-browser-check",
        NAVER_HOME_URL
      ],
      expect.objectContaining({ stdio: "ignore", windowsHide: false })
    );
    expect(launcher.isRunning()).toBe(true);
  });

  it("launches Chrome with a loopback CDP endpoint", async () => {
    const launcher = new ManualChromeLoginLauncher(dependencies);

    await launcher.open("C:\\profile");

    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9222"
      ]),
      expect.any(Object)
    );
    expect(MANUAL_CHROME_CDP_ENDPOINT).toBe("http://127.0.0.1:9222");
    expect(launcher.getCdpEndpoint()).toBe("http://127.0.0.1:9222");
  });

  it("falls back to Program Files Chrome when the per-user executable is inaccessible", async () => {
    const canAccess = vi.fn(async (candidate: string) => {
      if (candidate.includes("Program Files\\Google\\Chrome")) {
        return;
      }
      throw new Error("missing executable");
    });
    const launcher = new ManualChromeLoginLauncher({
      env: {
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        PROGRAMFILES: "C:\\Program Files",
        "PROGRAMFILES(X86)": "C:\\Program Files (x86)"
      },
      canAccess,
      spawn
    });

    await launcher.open("C:\\profile");

    expect(spawn).toHaveBeenCalledWith(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      expect.any(Array),
      expect.any(Object)
    );
    expect(canAccess).toHaveBeenCalledTimes(2);
  });

  it("clears running state when Chrome exits", async () => {
    const launcher = new ManualChromeLoginLauncher(dependencies);

    await launcher.open("C:\\profile");
    fakeChild.emit("exit", 0);

    expect(launcher.isRunning()).toBe(false);
    expect(launcher.getCdpEndpoint()).toBeUndefined();
  });

  it("clears running state when Chrome reports an error", async () => {
    const launcher = new ManualChromeLoginLauncher(dependencies);

    await launcher.open("C:\\profile");
    fakeChild.emit("error", new Error("spawn failed"));

    expect(launcher.isRunning()).toBe(false);
    expect(launcher.getCdpEndpoint()).toBeUndefined();
  });

  it("refuses to open a second manual Chrome process", async () => {
    const launcher = new ManualChromeLoginLauncher(dependencies);

    await launcher.open("C:\\profile");
    await expect(launcher.open("C:\\profile")).rejects.toThrow("already open");
  });

  it("rejects concurrent opens while the first executable lookup is in flight", async () => {
    let resolveAccess!: () => void;
    const canAccess = vi.fn(() => new Promise<void>((resolve) => {
      resolveAccess = resolve;
    }));
    const launcher = new ManualChromeLoginLauncher({ ...dependencies, canAccess });

    const firstOpen = launcher.open("C:\\profile");
    await Promise.resolve();

    await expect(launcher.open("C:\\profile")).rejects.toThrow("already open");
    resolveAccess();
    await firstOpen;

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("clears the opening guard when executable lookup fails", async () => {
    let shouldFail = true;
    const canAccess = vi.fn(async () => {
      if (shouldFail) {
        throw new Error("missing executable");
      }
    });
    const launcher = new ManualChromeLoginLauncher({ ...dependencies, canAccess });

    await expect(launcher.open("C:\\profile")).rejects.toThrow("not found");
    shouldFail = false;

    await expect(launcher.open("C:\\profile")).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("does not kill the manually launched Chrome process", async () => {
    const launcher = new ManualChromeLoginLauncher(dependencies);

    await launcher.open("C:\\profile");
    fakeChild.emit("exit", 0);

    expect(fakeChild.kill).not.toHaveBeenCalled();
  });
});
