import { spawnSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
beforeAll(() => {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "pnpm.cmd run cli:build"]
    : ["run", "cli:build"];
  const build = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    encoding: "utf8"
  });
  expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
}, 30_000);

describe("built CLI runtime", () => {
  it("starts draftCli without bundled CommonJS dynamic-require failures", () => {
    const result = spawnSync(process.execPath, ["dist-cli/draftCli.js", "publish"], {
      cwd: projectRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Command must be login, verify, or run");
    expect(result.stderr).not.toContain("Dynamic require");
  });
});
