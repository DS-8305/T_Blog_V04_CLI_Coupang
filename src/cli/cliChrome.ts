import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import path from "node:path";
import {
  findChromeExecutable,
  MANUAL_CHROME_CDP_ENDPOINT,
  TISTORY_HOME_URL
} from "../main/ManualChromeLoginLauncher";

type DetachedChild = {
  unref(): void;
  once(event: "spawn", listener: () => void): DetachedChild;
  once(event: "error", listener: (error: Error) => void): DetachedChild;
};
type Spawn = (executable: string, args: string[], options: SpawnOptions) => DetachedChild;

type LaunchDependencies = {
  isCdpAvailable?: () => Promise<boolean>;
  findChrome?: typeof findChromeExecutable;
  spawn?: Spawn;
};

export async function isCdpAvailable(
  endpoint = MANUAL_CHROME_CDP_ENDPOINT,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(750)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function launchCliChrome(
  profilePath: string,
  dependencies: LaunchDependencies = {}
): Promise<"launched" | "already_running"> {
  const checkCdp = dependencies.isCdpAvailable ?? (() => isCdpAvailable());
  if (await checkCdp()) return "already_running";

  const executable = await (dependencies.findChrome ?? findChromeExecutable)();
  const spawn = dependencies.spawn ?? nodeSpawn as unknown as Spawn;
  const child = spawn(executable, [
    `--user-data-dir=${path.resolve(profilePath)}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
    "--no-first-run",
    "--no-default-browser-check",
    TISTORY_HOME_URL
  ], { detached: true, stdio: "ignore", windowsHide: false });
  await waitForSpawn(child);
  child.unref();
  return "launched";
}

function waitForSpawn(child: DetachedChild): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
}
