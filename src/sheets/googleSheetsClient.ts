import { createSheetsAccessToken } from "./sheetAuth";
import { optionalSheetHeader, requireUniqueHeader, resolveSheetHeaders } from "./sheetQueue";
import { isProfileSheet, mapProfileSheetRow, type ProfileSheetRow } from './profileSheetRow';

const SHEETS_API_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";

export type SheetQueueValues = {
  values: string[][];
  rowCount: number;
};

export type SheetSourceRow = {
  automationStatus?: string;
  profile?: ProfileSheetRow;
  keyword: string;
  result: string;
  keywordColumn: number;
  resultColumn: number;
};

export type GoogleSheetsClient = {
  writeProfileFields?(spreadsheetId: string, sheetName: string, rowNumber: number,
    fields: Record<string, string>, expected: RowIdentity): Promise<void>;
  readQueue(spreadsheetId: string, sheetName: string): Promise<SheetQueueValues>;
  readSourceRow(spreadsheetId: string, sheetName: string, rowNumber: number): Promise<SheetSourceRow>;
  writeDone(
    spreadsheetId: string,
    sheetName: string,
    rowNumber: number,
    resultColumn: number,
    expected?: RowIdentity
  ): Promise<void>;
};

export type RowIdentity = { keyword: string; personId?: string; automationStatus?: string; result?: string };

export function assertRowIdentity(row: SheetSourceRow, expected: RowIdentity, rowNumber: number): void {
  if (row.keyword.trim() !== expected.keyword.trim()) throw new Error(`Sheet keyword changed at row ${rowNumber}`);
  if (expected.personId !== undefined && row.profile?.personId !== expected.personId) throw new Error(`Sheet personId changed at row ${rowNumber}`);
  if (expected.automationStatus !== undefined && row.automationStatus !== expected.automationStatus) throw new Error(`Sheet automationStatus changed at row ${rowNumber}`);
  if (expected.result !== undefined && row.result.trim() !== expected.result) throw new Error(`Sheet result changed at row ${rowNumber}`);
}

type ClientOptions = {
  fetch?: typeof globalThis.fetch;
  getAccessToken?: () => Promise<string>;
};

type MetadataResponse = {
  sheets?: Array<{
    properties?: {
      title?: string;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
  }>;
};

type ValuesResponse = { values?: unknown[][]; updatedCells?: number };

export function createGoogleSheetsClient(options: ClientOptions = {}): GoogleSheetsClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const getAccessToken = options.getAccessToken ?? (() => createSheetsAccessToken());

  async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await getAccessToken();
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      }
    });
    const body = await response.json() as T & { error?: { message?: string } };
    if (!response.ok) {
      const message = body.error?.message ?? response.statusText ?? "Request failed";
      throw new Error(`Google Sheets API ${response.status}: ${message}`);
    }
    return body;
  }

  async function readValues(spreadsheetId: string, range: string): Promise<string[][]> {
    const response = await requestJson<ValuesResponse>(
      `${SHEETS_API_ROOT}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`
    );
    return (response.values ?? []).map((row) => row.map((value) => String(value ?? "")));
  }

  async function readRow(spreadsheetId: string, sheetName: string, rowNumber: number) {
    requireDataRow(rowNumber);
    const prefix = `${quoteSheetName(sheetName)}!`;
    const headers = (await readValues(spreadsheetId, `${prefix}A1:Z1`))[0] ?? [];
    const cells = (await readValues(spreadsheetId, `${prefix}A${rowNumber}:Z${rowNumber}`))[0] ?? [];
    const { keywordColumn, resultColumn } = resolveSheetHeaders(headers);
    const statusColumn = optionalSheetHeader(headers, '자동화상태');
    const row: SheetSourceRow = {
      keyword: cells[keywordColumn - 1]?.trim() ?? '', result: cells[resultColumn - 1]?.trim() ?? '', keywordColumn, resultColumn,
      ...(statusColumn === undefined ? {} : { automationStatus: cells[statusColumn - 1]?.trim() ?? '' }),
      ...(isProfileSheet(headers) ? { profile: mapProfileSheetRow(headers, cells) } : {})
    };
    return { headers, cells, row };
  }

  return {
    async readQueue(spreadsheetId, sheetName) {
      const metadata = await requestJson<MetadataResponse>(
        `${SHEETS_API_ROOT}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(title%2CgridProperties(rowCount%2CcolumnCount))`
      );
      const sheet = metadata.sheets?.find(({ properties }) => properties?.title === sheetName);
      if (!sheet) throw new Error(`Sheet tab not found: ${sheetName}`);
      const rowCount = sheet.properties?.gridProperties?.rowCount ?? 0;
      const columnCount = sheet.properties?.gridProperties?.columnCount ?? 0;
      if (columnCount > 26) throw new Error("Sheet tables wider than Z are not supported.");
      const range = `${quoteSheetName(sheetName)}!A1:Z${Math.max(1, rowCount)}`;
      return { values: await readValues(spreadsheetId, range), rowCount };
    },

    async readSourceRow(spreadsheetId, sheetName, rowNumber) {
      return (await readRow(spreadsheetId, sheetName, rowNumber)).row;
    },

    async writeProfileFields(spreadsheetId, sheetName, rowNumber, fields, expected) {
      const allowed = new Set(['최신정보확인일','제목','본문','태그','조사출처','GoogleDocsURL','검수메모','자동화상태']);
      const entries = Object.entries(fields);
      if (!entries.length || entries.some(([header, value]) => !allowed.has(header) || typeof value !== 'string')) {
        throw new Error('Unsupported profile result fields; result is reserved for draft completion.');
      }
      const before = await readRow(spreadsheetId, sheetName, rowNumber);
      assertRowIdentity(before.row, expected, rowNumber);
      const data = entries.map(([header, value]) => ({
        range: `${quoteSheetName(sheetName)}!${columnLetter(requireUniqueHeader(before.headers, header))}${rowNumber}`,
        values: [[value]]
      }));
      const response = await requestJson<{totalUpdatedCells?: number}>(
        `${SHEETS_API_ROOT}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
        { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) }
      );
      if (response.totalUpdatedCells !== entries.length) throw new Error('Google Sheets did not confirm all profile cells updated.');
      const after = await readRow(spreadsheetId, sheetName, rowNumber);
      assertRowIdentity(after.row, { ...expected, ...(fields['자동화상태'] === undefined ? {} : { automationStatus: fields['자동화상태'] }) }, rowNumber);
      for (const [header, value] of entries) {
        if ((after.cells[requireUniqueHeader(after.headers, header) - 1] ?? '') !== value) throw new Error(`Sheet did not confirm ${header} at row ${rowNumber}`);
      }
    },

    async writeDone(spreadsheetId, sheetName, rowNumber, resultColumn, expected) {
      requireDataRow(rowNumber);
      if (expected) {
        const current = await readRow(spreadsheetId,sheetName,rowNumber);
        assertRowIdentity(current.row,expected,rowNumber);
        resultColumn=current.row.resultColumn;
      }
      const range = `${quoteSheetName(sheetName)}!${columnLetter(resultColumn)}${rowNumber}`;
      const response = await requestJson<ValuesResponse>(
        `${SHEETS_API_ROOT}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        { method: "PUT", body: JSON.stringify({ values: [["done"]] }) }
      );
      if (response.updatedCells !== 1) {
        throw new Error(`Expected one updated Sheet cell, received ${response.updatedCells ?? 0}.`);
      }
    }
  };
}

export function parseSpreadsheetId(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname !== "docs.google.com") throw new Error("wrong host");
    const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    if (match?.[1]) return match[1];
  } catch {
    // Use the stable user-facing error below.
  }
  throw new Error("Enter a Google Sheets URL or spreadsheet ID.");
}

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replaceAll("'", "''")}'`;
}

function columnLetter(column: number): string {
  if (!Number.isSafeInteger(column) || column < 1 || column > 26) {
    throw new Error("Sheet result column must be between A and Z.");
  }
  return String.fromCharCode(64 + column);
}

function requireDataRow(rowNumber: number): void {
  if (!Number.isSafeInteger(rowNumber) || rowNumber < 2) {
    throw new Error("Sheet row number must be an integer greater than one.");
  }
}
