import os from "node:os";
import path from "node:path";

export function getCliProfilePath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir()
): string {
  const appData = env.APPDATA ?? path.join(homeDir, "AppData", "Roaming");
  return path.join(appData, "Tistory Blog Automation", "browser-profile");
}
