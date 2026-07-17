import { app } from "electron";
import path from "node:path";

export function normalizeBrowserProfileName(profileName: string): string {
  return profileName.trim().replace(/[^a-zA-Z0-9_-]+/g, "_") || "default";
}

export function getBrowserProfilePath(profileName = "default"): string {
  if (profileName.trim() === "default") {
    return path.join(app.getPath("userData"), "browser-profile");
  }

  return path.join(
    app.getPath("userData"),
    "browser-profiles",
    `profile_${normalizeBrowserProfileName(profileName)}`
  );
}

export function getSecurityHoldPath(): string {
  return path.join(app.getPath("userData"), "security-hold.json");
}
