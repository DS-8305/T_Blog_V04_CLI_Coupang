import fs from "node:fs/promises";
import path from "node:path";

export type SheetSource = {
  version: 1;
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
  keywordHeader: "keyword";
  resultHeader: "result";
  keyword: string;
};

export type LinkedSheetSource = {
  postFolder: string;
  source: SheetSource;
};

const sourceFileName = "sheet-source.json";

export async function readSheetSource(postFolder: string): Promise<SheetSource | null> {
  const sourcePath = path.join(postFolder, sourceFileName);
  let raw: string;
  try {
    raw = await fs.readFile(sourcePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!isSheetSource(value)) throw new Error("invalid schema");
    return value;
  } catch {
    throw new Error(`Invalid ${sourceFileName} in ${postFolder}`);
  }
}

export async function writeSheetSource(postFolder: string, source: SheetSource): Promise<void> {
  if (!isSheetSource(source)) throw new Error(`Invalid ${sourceFileName}`);
  await fs.mkdir(postFolder, { recursive: true });
  const sourcePath = path.join(postFolder, sourceFileName);
  const temporaryPath = `${sourcePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, sourcePath);
}

export async function findSheetSources(workspacePath: string): Promise<LinkedSheetSource[]> {
  const postsRoot = await resolvePostsRoot(workspacePath);
  let entries;
  try {
    entries = await fs.readdir(postsRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const linked: LinkedSheetSource[] = [];
  const folderNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "ko"));
  for (const folderName of folderNames) {
    const postFolder = path.join(postsRoot, folderName);
    const source = await readSheetSource(postFolder);
    if (source) linked.push({ postFolder, source });
  }
  return linked;
}

export function buildSheetPostId(rowNumber: number, keyword: string): string {
  if (!Number.isSafeInteger(rowNumber) || rowNumber < 2) {
    throw new Error("Sheet row number must be an integer greater than one.");
  }
  const slug = keyword
    .normalize("NFC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  if (!slug) throw new Error("Sheet keyword cannot produce a post folder name.");
  return `${String(rowNumber).padStart(6, "0")}-${slug}`;
}

async function resolvePostsRoot(workspacePath: string): Promise<string> {
  const nested = path.join(workspacePath, "posts");
  try {
    return (await fs.stat(nested)).isDirectory() ? nested : workspacePath;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return nested;
    throw error;
  }
}

function isSheetSource(value: unknown): value is SheetSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<SheetSource>;
  return source.version === 1
    && typeof source.spreadsheetId === "string" && source.spreadsheetId.trim().length > 0
    && typeof source.sheetName === "string" && source.sheetName.trim().length > 0
    && Number.isSafeInteger(source.rowNumber) && Number(source.rowNumber) >= 2
    && source.keywordHeader === "keyword"
    && source.resultHeader === "result"
    && typeof source.keyword === "string" && source.keyword.trim().length > 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
