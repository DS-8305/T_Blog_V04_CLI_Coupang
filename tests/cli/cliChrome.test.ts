import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { getCliProfilePath } from "../../src/cli/cliPaths";
import { isCdpAvailable, launchCliChrome } from "../../src/cli/cliChrome";
import {
  MANUAL_CHROME_CDP_ENDPOINT,
  TISTORY_HOME_URL
} from "../../src/main/ManualChromeLoginLauncher";

describe("Tistory CLI Chrome", () => {
  it("shares the Electron application's default browser profile", () => {
    expect(getCliProfilePath(
      { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
      "C:\\Users\\fallback"
    )).toBe(path.join(
      "C:\\Users\\me\\AppData\\Roaming",
      "tistory-blog-auto-v01",
      "browser-profile"
    ));
  });

  it("derives AppData when APPDATA is unavailable", () => {
    expect(getCliProfilePath({}, "C:\\Users\\fallback")).toBe(path.join(
      "C:\\Users\\fallback",
      "AppData",
      "Roaming",
      "tistory-blog-auto-v01",
      "browser-profile"
    ));
  });

  it("reports whether the loopback CDP endpoint responds", async () => {
    const reachableFetch = vi.fn(async () => ({ ok: true } as Response));
    const rejectedFetch = vi.fn(async () => { throw new Error("offline"); });

    await expect(isCdpAvailable(MANUAL_CHROME_CDP_ENDPOINT, reachableFetch)).resolves.toBe(true);
    await expect(isCdpAvailable(MANUAL_CHROME_CDP_ENDPOINT, rejectedFetch)).resolves.toBe(false);
    expect(reachableFetch).toHaveBeenCalledWith(
      `${MANUAL_CHROME_CDP_ENDPOINT}/json/version`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("reuses an already running dedicated Chrome instead of spawning another", async () => {
    const spawn = vi.fn();

    await expect(launchCliChrome("C:\\profile", {
      isCdpAvailable: vi.fn(async () => true),
      findChrome: vi.fn(async () => "C:\\Chrome\\chrome.exe"),
      spawn
    })).resolves.toBe("already_running");

    expect(spawn).not.toHaveBeenCalled();
  });

  it("launches Chrome detached with the shared profile and loopback CDP", async () => {
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));

    await expect(launchCliChrome("C:\\shared profile", {
      isCdpAvailable: vi.fn(async () => false),
      findChrome: vi.fn(async () => "C:\\Chrome\\chrome.exe"),
      spawn
    })).resolves.toBe("launched");

    expect(spawn).toHaveBeenCalledWith(
      "C:\\Chrome\\chrome.exe",
      [
        `--user-data-dir=${path.resolve("C:\\shared profile")}`,
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9222",
        "--no-first-run",
        "--no-default-browser-check",
        TISTORY_HOME_URL
      ],
      { detached: true, stdio: "ignore", windowsHide: false }
    );
    expect(unref).toHaveBeenCalledOnce();
  });
});
