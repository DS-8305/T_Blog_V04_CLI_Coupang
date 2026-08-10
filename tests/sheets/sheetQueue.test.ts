import { describe, expect, it } from "vitest";
import { selectFirstPendingRow } from "../../src/sheets/sheetQueue";

describe("selectFirstPendingRow", () => {
  it("selects the first keyword whose result is blank", () => {
    expect(selectFirstPendingRow([
      ["keyword", "result"],
      ["completed", "done"],
      ["externally owned", "processing"],
      ["next keyword", "  "],
      ["later keyword", ""]
    ])).toEqual({
      rowNumber: 4,
      keyword: "next keyword",
      keywordColumn: 1,
      resultColumn: 2
    });
  });

  it("finds required headers after columns move", () => {
    expect(selectFirstPendingRow([
      ["notes", "result", "keyword"],
      ["", "", "moved keyword"]
    ])).toEqual({
      rowNumber: 2,
      keyword: "moved keyword",
      keywordColumn: 3,
      resultColumn: 2
    });
  });

  it("skips rows with an empty keyword", () => {
    expect(selectFirstPendingRow([
      ["keyword", "result"],
      ["  ", ""],
      ["usable", ""]
    ])).toMatchObject({ rowNumber: 3, keyword: "usable" });
  });

  it("returns null when every keyword is completed or externally owned", () => {
    expect(selectFirstPendingRow([
      ["keyword", "result"],
      ["completed", "DONE"],
      ["owned", "processing"]
    ])).toBeNull();
  });

  it("rejects a missing result header", () => {
    expect(() => selectFirstPendingRow([["keyword"]]))
      .toThrow("Missing required Sheet header: result");
  });

  it("rejects duplicate keyword headers", () => {
    expect(() => selectFirstPendingRow([["keyword", "result", "keyword"]]))
      .toThrow("Duplicate Sheet header: keyword");
  });
});
