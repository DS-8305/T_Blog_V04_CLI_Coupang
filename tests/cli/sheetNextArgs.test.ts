import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSheetNextArgs } from "../../src/cli/sheetNextArgs";

const sheetId = "105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g";
const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?gid=0`;
const workspace = path.resolve("C:\\blog-workspace");

describe("parseSheetNextArgs", () => {
  it("parses the required options and defaults to 시트1", () => {
    expect(parseSheetNextArgs([
      "--workspace", workspace,
      "--sheet-url", sheetUrl
    ])).toEqual({ workspacePath: workspace, spreadsheetId: sheetId, sheetName: "시트1" });
  });

  it("accepts pnpm forwarding and a tab override", () => {
    expect(parseSheetNextArgs([
      "--",
      "--workspace", workspace,
      "--sheet-url", sheetId,
      "--sheet-name", "콘텐츠"
    ])).toEqual({ workspacePath: workspace, spreadsheetId: sheetId, sheetName: "콘텐츠" });
  });

  it("requires an absolute workspace", () => {
    expect(() => parseSheetNextArgs([
      "--workspace", "relative",
      "--sheet-url", sheetUrl
    ])).toThrow("--workspace must be an absolute path");
  });

  it.each([
    [["--workspace", workspace], "--sheet-url is required"],
    [["--sheet-url", sheetUrl], "--workspace is required"],
    [["--workspace", workspace, "--sheet-url", sheetUrl, "--other", "x"], "Unknown option: --other"],
    [["--workspace", workspace, "--sheet-url"], "Missing value for --sheet-url"]
  ])("rejects invalid options", (args, message) => {
    expect(() => parseSheetNextArgs(args)).toThrow(message);
  });
});
