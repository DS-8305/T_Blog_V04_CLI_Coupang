import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendPostLog, writePostStatus } from "../../src/core/statusStore";

describe("statusStore", () => {
  it("writes status.json", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "post-status-"));

    await writePostStatus(folder, {
      status: "draft_saved",
      startedAt: "2026-06-28T10:00:00+09:00",
      finishedAt: "2026-06-28T10:02:00+09:00",
      message: "Draft saved successfully"
    });

    const raw = await fs.readFile(path.join(folder, "status.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      status: "draft_saved",
      message: "Draft saved successfully"
    });
  });

  it("appends readable log entries", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "post-log-"));

    await appendPostLog(folder, "Started");
    await appendPostLog(folder, "Saved draft");

    const raw = await fs.readFile(path.join(folder, "run-log.txt"), "utf8");
    expect(raw).toContain("Started");
    expect(raw).toContain("Saved draft");
  });
});
