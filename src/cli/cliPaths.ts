import os from "node:os";
import path from "node:path";

export function getCliProfilePath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir()
): string {
  const appData = env.APPDATA ?? path.join(homeDir, "AppData", "Roaming");
  return path.join(appData, "tistory-blog-auto-v01", "browser-profile");
}
