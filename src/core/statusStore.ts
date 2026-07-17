import fs from "node:fs/promises";
import path from "node:path";
import type { PostStatus } from "../shared/types";

export type StatusRecord = {
  status: PostStatus;
  startedAt?: string;
  finishedAt?: string;
  message: string;
};

export async function writePostStatus(postFolder: string, record: StatusRecord): Promise<void> {
  const statusPath = path.join(postFolder, "status.json");
  await fs.writeFile(statusPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function appendPostLog(postFolder: string, message: string): Promise<void> {
  const logPath = path.join(postFolder, "run-log.txt");
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.appendFile(logPath, line, "utf8");
}

export async function writeSuccessMarker(postFolder: string): Promise<void> {
  await fs.writeFile(path.join(postFolder, "_SUCCESS.done"), "", "utf8");
}
