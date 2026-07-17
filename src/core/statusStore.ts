import fs from "node:fs/promises";
import path from "node:path";
import type { PostJob, PostStatus, PublicationMode, ReviewOutcome } from "../shared/types";

export type StatusRecord = {
  status: PostStatus;
  startedAt?: string;
  finishedAt?: string;
  message: string;
  publication?: PublicationMode;
  postId?: string;
  postUrl?: string;
};

const terminalStatusByPublication: Record<PublicationMode, Extract<PostStatus, "draft_saved" | "published" | "scheduled">> = {
  draft: "draft_saved",
  public: "published",
  scheduled: "scheduled"
};

export async function writePostStatus(postFolder: string, record: StatusRecord): Promise<void> {
  const statusPath = path.join(postFolder, "status.json");
  await fs.writeFile(statusPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function readPostStatus(postFolder: string): Promise<StatusRecord | null> {
  try {
    const raw = await fs.readFile(path.join(postFolder, "status.json"), "utf8");
    const value = JSON.parse(raw) as Partial<StatusRecord>;
    return typeof value.status === "string" && typeof value.message === "string"
      ? value as StatusRecord
      : null;
  } catch {
    return null;
  }
}

export async function resolveReview(job: PostJob, outcome: ReviewOutcome, now = new Date()): Promise<void> {
  const current = await readPostStatus(job.folderPath);
  if (current?.status !== "needs_review") {
    throw new Error("Only a needs_review post can be resolved.");
  }

  const publication = job.parsed.metadata.publication;
  const status = outcome === "already_created"
    ? terminalStatusByPublication[publication]
    : "pending";
  await writePostStatus(job.folderPath, {
    status,
    finishedAt: now.toISOString(),
    publication,
    message: outcome === "already_created"
      ? "User confirmed the Tistory post was already created."
      : "User confirmed the Tistory post was not created; reset to pending."
  });
  await appendPostLog(job.folderPath, `Review resolved: ${outcome}; status=${status}`);
  if (outcome === "already_created") {
    await writeSuccessMarker(job.folderPath);
  }
}

export async function appendPostLog(postFolder: string, message: string): Promise<void> {
  const logPath = path.join(postFolder, "run-log.txt");
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.appendFile(logPath, line, "utf8");
}

export async function writeSuccessMarker(postFolder: string): Promise<void> {
  await fs.writeFile(path.join(postFolder, "_SUCCESS.done"), "", "utf8");
}
