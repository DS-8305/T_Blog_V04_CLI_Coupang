import fs from "node:fs/promises";
import path from "node:path";

const checkpointFileName = "sheet-completion.json";

export type SheetCompletionCheckpoint = {
  version: 1;
  state: "awaiting_sheet_done" | "sheet_done";
  updatedAt: string;
  rowNumber: number;
};

export async function readSheetCompletionCheckpoint(
  postFolder: string
): Promise<SheetCompletionCheckpoint | undefined> {
  try {
    const raw = await fs.readFile(path.join(postFolder, checkpointFileName), "utf8");
    const value: unknown = JSON.parse(raw);
    if (!isCheckpoint(value)) throw new Error(`Invalid ${checkpointFileName}`);
    return value;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeSheetCompletionCheckpoint(
  postFolder: string,
  checkpoint: SheetCompletionCheckpoint
): Promise<void> {
  await fs.writeFile(
    path.join(postFolder, checkpointFileName),
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    "utf8"
  );
}

function isCheckpoint(value: unknown): value is SheetCompletionCheckpoint {
  if (!value || typeof value !== "object") return false;
  const checkpoint = value as Partial<SheetCompletionCheckpoint>;
  return checkpoint.version === 1
    && (checkpoint.state === "awaiting_sheet_done" || checkpoint.state === "sheet_done")
    && typeof checkpoint.updatedAt === "string"
    && typeof checkpoint.rowNumber === "number"
    && Number.isInteger(checkpoint.rowNumber)
    && checkpoint.rowNumber > 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
