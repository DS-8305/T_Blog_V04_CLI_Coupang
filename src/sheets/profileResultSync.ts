import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGoogleDocsClient, type GoogleDocsClient } from '../google/googleDocsClient';
import { assertRowIdentity, type GoogleSheetsClient, type RowIdentity } from './googleSheetsClient';
import { readSheetSource, type SheetSource } from './sheetSource';
import { formatProfileSources, parseProfileResult, profileBodyText } from './profileResult';
import { parseContent } from '../core/parser';
import { applyCliDraftPolicy } from '../cli/cliPostPolicy';
import type { PostJob } from '../shared/types';
import { readPostStatus } from '../core/statusStore';
import { assertProfileDraftCheckpoint, manuscriptDigest, writeProfileDraftCheckpoint } from './profileDraftCheckpoint';

export async function recordProfileError(folder: string, client: GoogleSheetsClient, error: unknown): Promise<void> {
  // Error reporting is best effort, and must never replace the original error or user HOLD.
  try {
    const source = await readSheetSource(folder);
    if (source?.version !== 2 || !client.writeProfileFields) return;
    const remote = await client.readSourceRow(source.spreadsheetId, source.sheetName, source.rowNumber);
    assertRowIdentity(remote, source, source.rowNumber);
    if (remote.automationStatus !== 'READY' || remote.result) return;
    await client.writeProfileFields(source.spreadsheetId, source.sheetName, source.rowNumber,
      {자동화상태:'ERROR',검수메모:(error instanceof Error ? error.message : String(error)).slice(0,1000)},
      {...source,automationStatus:'READY',result:''});
  } catch { /* Preserve original error; never overwrite another person's row. */ }
}

export async function syncProfileResult(folder: string, client: GoogleSheetsClient,
  options: { docs?: GoogleDocsClient; folderId?: string; allowDone?: boolean; draftJob?: PostJob } = {}): Promise<string> {
  try {
    const source = await readSheetSource(folder);
    if (source?.version !== 2) throw new Error('Profile sync requires sheet-source.json version 2.');
    if (!client.writeProfileFields) throw new Error('Sheets client does not support profile results.');
    const remote = await client.readSourceRow(source.spreadsheetId, source.sheetName, source.rowNumber);
    assertRowIdentity(remote, source, source.rowNumber);
    if (remote.automationStatus !== 'READY' || (remote.result && !(options.allowDone && remote.result.toLowerCase() === 'done'))) {
      throw new Error(`Profile row ${source.rowNumber} is not READY with an eligible result.`);
    }
    const expected: RowIdentity = {...source,automationStatus:'READY',result:remote.result};
    const result = parseProfileResult(JSON.parse(await fs.readFile(path.join(folder,'profile-result.json'),'utf8')));
    const contentPath = path.join(folder,'content.txt');
    const content = await fs.readFile(contentPath,'utf8');
    const parsed = parseContent(content,folder);
    const [job] = await applyCliDraftPolicy([{id:path.basename(folder),folderPath:folder,contentPath,parsed,status:'pending'}]);
    if (job!.parsed.errors.length) throw new Error(job!.parsed.errors.map(e => e.message).join('; '));
    if (parsed.title !== result.title.trim() || profileBodyText(content) !== result.body.replace(/\r\n/g,'\n').trim()) {
      throw new Error('profile-result.json does not match content.txt title/body.');
    }
    if (options.draftJob && (parsed.title !== options.draftJob.parsed.title
      || JSON.stringify(parsed.events) !== JSON.stringify(options.draftJob.parsed.events))) {
      throw new Error('Current manuscript does not match the loaded draft; reload before saving.');
    }
    const digest = manuscriptDigest(source,content,result);
    const saved = (await readPostStatus(folder))?.status === 'draft_saved';
    if (saved) await assertProfileDraftCheckpoint(folder,digest);
    if (options.allowDone && !saved) throw new Error('Profile completion requires a confirmed draft_saved status.');
    const folderId = (options.folderId ?? process.env.PROFILE_DOCS_FOLDER_ID)?.trim();
    if (!folderId) throw new Error('PROFILE_DOCS_FOLDER_ID must name a writable shared-drive folder.');
    const fields = {최신정보확인일:result.latestInfoDate,제목:result.title,본문:result.body,태그:result.tags.join(', '),조사출처:formatProfileSources(result.sources),
      ...(result.reviewMemo?.trim() ? {검수메모:result.reviewMemo.trim()} : {})};
    await client.writeProfileFields(source.spreadsheetId,source.sheetName,source.rowNumber,fields,expected);
    const docs = options.docs ?? createGoogleDocsClient();
    const url = await docs.save({folderId,key:profileSourceKey(source),title:`[${source.personId}] ${remote.profile!.name} 프로필`,
      text:`제목\n${result.title}\n\n티스토리 원고\n${result.body}\n\n태그\n${result.tags.join(', ')}\n\n조사 출처\n${formatProfileSources(result.sources)}`});
    await client.writeProfileFields(source.spreadsheetId,source.sheetName,source.rowNumber,{GoogleDocsURL:url},expected);
    await fs.writeFile(path.join(folder,'profile-sync.json'),JSON.stringify({version:1,state:'results_synced',googleDocsUrl:url,updatedAt:new Date().toISOString()},null,2)+'\n','utf8');
    // Prepared before the engine call; draft_saved later proves this exact loaded job was confirmed.
    if (options.draftJob && !saved) await writeProfileDraftCheckpoint(folder,digest);
    return url;
  } catch (error) {
    await recordProfileError(folder,client,error);
    throw error;
  }
}

function profileSourceKey(source: SheetSource): string {
  return createHash('sha256').update(JSON.stringify([source.spreadsheetId,source.sheetName,source.rowNumber,source.personId,source.keyword])).digest('hex');
}
