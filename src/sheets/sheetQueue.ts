export type PendingSheetRow = {
  rowNumber: number;
  keyword: string;
  keywordColumn: number;
  resultColumn: number;
};

export function selectFirstPendingRow(values: string[][]): PendingSheetRow | null {
  const headers = values[0] ?? [];
  const keywordColumn = requireUniqueHeader(headers, "keyword");
  const resultColumn = requireUniqueHeader(headers, "result");

  for (let index = 1; index < values.length; index += 1) {
    const keyword = values[index]?.[keywordColumn - 1]?.trim() ?? "";
    const result = values[index]?.[resultColumn - 1]?.trim() ?? "";
    if (keyword && !result) {
      return { rowNumber: index + 1, keyword, keywordColumn, resultColumn };
    }
  }

  return null;
}

function requireUniqueHeader(headers: string[], expected: string): number {
  const matches = headers
    .map((header, index) => ({ header: header.trim().toLowerCase(), index }))
    .filter(({ header }) => header === expected);
  if (matches.length === 0) throw new Error(`Missing required Sheet header: ${expected}`);
  if (matches.length > 1) throw new Error(`Duplicate Sheet header: ${expected}`);
  return matches[0]!.index + 1;
}
