import fs from 'node:fs/promises';
import path from 'node:path';
import type { GoogleSheetsClient } from './googleSheetsClient';
import type { SheetSource } from './sheetSource';
import type { ProfileSheetRow } from './profileSheetRow';
import { composeProfilePrompt } from './promptSettings';

export async function writeProfileTask(folder: string, source: SheetSource, row: ProfileSheetRow, client: GoogleSheetsClient): Promise<void> {
  const settings = await client.readQueue(source.spreadsheetId, '프롬프트_설정');
  const prompt = composeProfilePrompt(settings.values, row);
  await fs.mkdir(folder, { recursive: true });
  const task = { version: 1, spreadsheetId: source.spreadsheetId, sheetName: source.sheetName, rowNumber: source.rowNumber,
    personId: row.personId, name: row.name, detailType: row.detailType, searchKey: row.searchKey, promptType: row.promptType,
    row, promptIds: prompt.promptIds, referenceDate: prompt.date };
  await fs.writeFile(path.join(folder, 'profile-prompt.txt'), prompt.text, 'utf8');
  await fs.writeFile(path.join(folder, 'profile-task.json'), JSON.stringify(task, null, 2) + '\n', 'utf8');
}
