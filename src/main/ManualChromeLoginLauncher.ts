import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { access as nodeAccess } from "node:fs/promises";
import path from "node:path";
import { TISTORY_HOME_URL } from "../automation/tistorySelectors";

export { TISTORY_HOME_URL } from "../automation/tistorySelectors";
export const MANUAL_CHROME_CDP_ENDPOINT = "http://127.0.0.1:9224";

export interface ChromeChildProcess {
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}
export type ChromeAccess = (candidate: string) => Promise<unknown>;
export type ChromeSpawn = (
  executable: string,
  args: string[],
  options: SpawnOptions
) => ChromeChildProcess;

export type ChromeLauncherDependencies = {
  env?: NodeJS.ProcessEnv;
  canAccess?: ChromeAccess;
  spawn?: ChromeSpawn;
};

const chromeExecutableCandidates = (env: NodeJS.ProcessEnv): string[] => [
  path.win32.join(env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  path.win32.join(env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  path.win32.join(env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe")
];

export async function findChromeExecutable(
  env: NodeJS.ProcessEnv = process.env,
  canAccess: ChromeAccess = nodeAccess
): Promise<string> {
  for (const candidate of chromeExecutableCandidates(env)) {
    try {
      await canAccess(candidate);
      return candidate;
    } catch {
      // Try the next standard Windows installation location.
    }
  }

  throw new Error("Normal Chrome executable not found");
}

export class ManualChromeLoginLauncher {
  private readonly env: NodeJS.ProcessEnv;
  private readonly canAccess: ChromeAccess;
  private readonly spawn: ChromeSpawn;
  private child?: ChromeChildProcess;
  private opening = false;

  constructor(dependencies: ChromeLauncherDependencies = {}) {
    this.env = dependencies.env ?? process.env;
    this.canAccess = dependencies.canAccess ?? nodeAccess;
    this.spawn = dependencies.spawn ?? ((executable, args, options) => nodeSpawn(executable, args, options));
  }

  async open(profilePath: string): Promise<void> {
    if (this.child || this.opening) {
      throw new Error("Manual Chrome is already open");
    }

    this.opening = true;
    try {
      const executable = await findChromeExecutable(this.env, this.canAccess);
      const child = this.spawn(
        executable,
        [
          `--user-data-dir=${profilePath}`,
          "--remote-debugging-port=9224",
          "--no-first-run",
          "--no-default-browser-check",
          TISTORY_HOME_URL
        ],
        { stdio: "ignore", windowsHide: false }
      );

      this.child = child;
      const clearIfCurrent = () => {
        if (this.child === child) {
          this.child = undefined;
        }
      };
      child.on("exit", clearIfCurrent);
      child.on("error", clearIfCurrent);
    } finally {
      this.opening = false;
    }
  }

  isRunning(): boolean {
    return this.child !== undefined;
  }

  getCdpEndpoint(): string | undefined {
    return this.child ? MANUAL_CHROME_CDP_ENDPOINT : undefined;
  }
}
