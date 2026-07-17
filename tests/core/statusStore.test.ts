import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendPostLog, resolveReview, writePostStatus } from "../../src/core/statusStore";
import type { PostJob } from "../../src/shared/types";

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

  it("resets an uncertain post when the user confirms it was not created", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "post-review-reset-"));
    const job = makeJob(folder, "public");
    await writePostStatus(folder, { status: "needs_review", message: "Publication result is uncertain" });

    await resolveReview(job, "not_created", new Date("2026-07-17T01:00:00.000Z"));

    const record = JSON.parse(await fs.readFile(path.join(folder, "status.json"), "utf8"));
    const log = await fs.readFile(path.join(folder, "run-log.txt"), "utf8");
    expect(record).toMatchObject({ status: "pending", publication: "public" });
    expect(log).toContain("not_created");
  });

  it("maps an already-created review to the requested terminal status", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "post-review-created-"));
    const job = makeJob(folder, "scheduled");
    await writePostStatus(folder, { status: "needs_review", message: "Schedule result is uncertain" });

    await resolveReview(job, "already_created", new Date("2026-07-17T01:00:00.000Z"));

    const record = JSON.parse(await fs.readFile(path.join(folder, "status.json"), "utf8"));
    expect(record).toMatchObject({ status: "scheduled", publication: "scheduled" });
  });

  it("refuses to resolve a post that is not awaiting review", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "post-review-invalid-"));
    const job = makeJob(folder, "draft");
    await writePostStatus(folder, { status: "pending", message: "Ready" });

    await expect(resolveReview(job, "already_created")).rejects.toThrow(/needs_review/);
  });
});

function makeJob(folderPath: string, publication: "draft" | "public" | "scheduled"): PostJob {
  return {
    id: path.basename(folderPath),
    folderPath,
    contentPath: path.join(folderPath, "content.txt"),
    status: "needs_review",
    parsed: {
      title: "Title",
      metadata: { publication, category: null, tags: [], scheduledAt: null },
      events: [],
      errors: []
    }
  };
}
