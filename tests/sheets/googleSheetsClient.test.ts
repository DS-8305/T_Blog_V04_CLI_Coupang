import { describe, expect, it, vi } from "vitest";
import {
  createGoogleSheetsClient,
  parseSpreadsheetId
} from "../../src/sheets/googleSheetsClient";

const sheetId = "105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g";
const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?gid=0`;

describe("parseSpreadsheetId", () => {
  it("accepts a raw id and a Google Sheets URL", () => {
    expect(parseSpreadsheetId(sheetId)).toBe(sheetId);
    expect(parseSpreadsheetId(sheetUrl)).toBe(sheetId);
  });

  it("rejects a non-Sheets URL", () => {
    expect(() => parseSpreadsheetId("https://example.com/spreadsheets/d/not-google"))
      .toThrow("Enter a Google Sheets URL or spreadsheet ID.");
  });
});

describe("GoogleSheetsClient", () => {
  it("reads the exact tab through a bounded A:Z queue range", async () => {
    const fetchMock = sequenceFetch(
      jsonResponse({
        sheets: [{ properties: { title: "시트1", gridProperties: { rowCount: 1922, columnCount: 26 } } }]
      }),
      jsonResponse({ values: [["keyword", "result"], ["next", ""]] })
    );
    const client = createGoogleSheetsClient({
      fetch: fetchMock,
      getAccessToken: async () => "token"
    });

    await expect(client.readQueue(sheetId, "시트1")).resolves.toEqual({
      values: [["keyword", "result"], ["next", ""]],
      rowCount: 1922
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(encodeURIComponent("'시트1'!A1:Z1922"));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer token" }
    });
  });

  it("rejects a missing tab", async () => {
    const client = createGoogleSheetsClient({
      fetch: sequenceFetch(jsonResponse({
        sheets: [{ properties: { title: "other", gridProperties: { rowCount: 10, columnCount: 2 } } }]
      })),
      getAccessToken: async () => "token"
    });

    await expect(client.readQueue(sheetId, "시트1")).rejects.toThrow("Sheet tab not found: 시트1");
  });

  it("rejects a table wider than the supported A:Z contract", async () => {
    const client = createGoogleSheetsClient({
      fetch: sequenceFetch(jsonResponse({
        sheets: [{ properties: { title: "시트1", gridProperties: { rowCount: 10, columnCount: 27 } } }]
      })),
      getAccessToken: async () => "token"
    });

    await expect(client.readQueue(sheetId, "시트1"))
      .rejects.toThrow("Sheet tables wider than Z are not supported.");
  });

  it("reads a source row with current header positions", async () => {
    const fetchMock = sequenceFetch(
      jsonResponse({ values: [["notes", "result", "keyword"]] }),
      jsonResponse({ values: [["", "", "selected keyword"]] })
    );
    const client = createGoogleSheetsClient({ fetch: fetchMock, getAccessToken: async () => "token" });

    await expect(client.readSourceRow(sheetId, "시트1", 34)).resolves.toEqual({
      keyword: "selected keyword",
      result: "",
      keywordColumn: 3,
      resultColumn: 2
    });
  });

  it("writes done to exactly one result cell", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ updatedCells: 1 }));
    const client = createGoogleSheetsClient({ fetch: fetchMock, getAccessToken: async () => "token" });

    await client.writeDone(sheetId, "시트1", 34, 2);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(encodeURIComponent("'시트1'!B34"));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ values: [["done"]] });
  });

  it("surfaces a sanitized Google API error", async () => {
    const client = createGoogleSheetsClient({
      fetch: vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ error: { message: "permission denied" } }, 403)),
      getAccessToken: async () => "secret-token"
    });

    await expect(client.readQueue(sheetId, "시트1"))
      .rejects.toThrow("Google Sheets API 403: permission denied");
  });

  it("requires exactly one updated cell", async () => {
    const client = createGoogleSheetsClient({
      fetch: vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ updatedCells: 0 })),
      getAccessToken: async () => "token"
    });

    await expect(client.writeDone(sheetId, "시트1", 34, 2))
      .rejects.toThrow("Expected one updated Sheet cell, received 0.");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function sequenceFetch(...responses: Response[]) {
  return vi.fn<typeof globalThis.fetch>(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected fetch call");
    return response;
  });
}
