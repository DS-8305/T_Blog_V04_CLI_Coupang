import path from "node:path";
import { parseSpreadsheetId } from "../sheets/googleSheetsClient";

export type SheetNextArgs = {
  workspacePath: string;
  spreadsheetId: string;
  sheetName: string;
};

export function parseSheetNextArgs(argv: string[]): SheetNextArgs {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  const allowed = new Set(["--workspace", "--sheet-url", "--sheet-name"]);
  const options = new Map<string, string>();

  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--")) throw new Error(`Invalid option: ${key ?? ""}`);
    if (!allowed.has(key)) throw new Error(`Unknown option: ${key}`);
    if (options.has(key)) throw new Error(`Duplicate option: ${key}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options.set(key, value);
  }

  const workspacePath = options.get("--workspace");
  if (!workspacePath) throw new Error("--workspace is required");
  if (!path.isAbsolute(workspacePath)) throw new Error("--workspace must be an absolute path");
  const sheetValue = options.get("--sheet-url");
  if (!sheetValue) throw new Error("--sheet-url is required");
  const sheetName = options.get("--sheet-name")?.trim() ?? "시트1";
  if (!sheetName) throw new Error("--sheet-name cannot be blank");

  return {
    workspacePath,
    spreadsheetId: parseSpreadsheetId(sheetValue),
    sheetName
  };
}
