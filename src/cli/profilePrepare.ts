import fs from 'node:fs/promises';
import path from 'node:path';
import { parseContent } from '../core/parser';
import { formatProfileSources, parseProfileResult, profileBodyText, type ProfileResult } from '../sheets/profileResult';
import { buildSheetPostId } from '../sheets/sheetSource';
import { classifyProfileBlog } from './profileBlogRouting';

export type PrepareInput = {
  content: string;
  latestInfoDate: string;
  tags: string[];
  sources: ProfileResult['sources'];
  source: {
    spreadsheetId: string; sheetId: number; sheetName: string; rowNumber: number;
    personId: string; keyword: string;
    row: { personId: string; name: string; majorType: string; detailType: string; promptType: string;
      keyword: string; automationStatus: string; result: string; [key: string]: unknown };
    [key: string]: unknown;
  };
};

/** Local preparation only. Connector reads/writes and editorial review remain explicit. */
export async function prepareProfile(workspace: string, input: PrepareInput) {
  if (!path.isAbsolute(workspace)) throw new Error('Workspace must be an absolute path.');
  const source = input?.source;
  if (!source || !source.row || !source.personId?.trim() || !source.keyword?.trim()
    || source.personId !== source.row.personId || source.keyword !== source.row.keyword) {
    throw new Error('Source row identity does not match personId/keyword.');
  }
  if (source.row.automationStatus !== 'READY' || typeof source.row.result !== 'string' || source.row.result.trim()) throw new Error('Source row must be READY with an empty result.');
  classifyProfileBlog(source.row);
  if (!source.spreadsheetId?.trim() || !source.sheetName?.trim() || !Number.isSafeInteger(source.sheetId) || source.sheetId < 0) {
    throw new Error('Exact spreadsheet and sheet identity are required.');
  }
  const id = buildSheetPostId(source.rowNumber, source.keyword);
  const folder = path.join(workspace, 'posts', id);
  if (typeof input.content !== 'string') throw new Error('Manuscript content is required.');
  const content = input.content.replace(/\r\n/g, '\n').trim();
  const parsed = parseContent(content, folder);
  if (parsed.errors.length) throw new Error(parsed.errors.map(e => e.message).join('; '));
  for (const marker of content.matchAll(/\[([^\]\r\n]+)\]/g)) {
    if (!/^(?:\/?(?:TITLE|H2|BOLD)|HR)$/.test(marker[1])) throw new Error(`Unsupported profile marker: ${marker[0]}`);
  }
  const headings = [...content.matchAll(/\[H2\]/g)];
  if (headings.length < 2) throw new Error('At least two H2 headings are required for Coupang widgets.');
  for (const heading of headings) {
    if (!/\[HR\]\s*$/.test(content.slice(0, heading.index))) throw new Error('Every H2 must be preceded by HR.');
  }
  if (!source.row.name?.trim() || !parsed.title.includes(source.row.name)) throw new Error('Title must identify the source row name.');
  const result = parseProfileResult({latestInfoDate: input.latestInfoDate, title: parsed.title,
    body: profileBodyText(content), tags: input.tags, sources: input.sources});
  const posts = path.dirname(folder);
  await fs.mkdir(posts, {recursive:true});
  for (const entry of await fs.readdir(posts, {withFileTypes:true})) {
    if (!entry.isDirectory()) continue;
    let existing;
    try { existing = JSON.parse(await fs.readFile(path.join(posts,entry.name,'connector-source.json'),'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (existing.spreadsheetId === source.spreadsheetId && existing.personId === source.personId) {
      throw new Error(`Profile already exists: ${entry.name}. Inspect its status before continuing.`);
    }
  }
  // Exclusive creation prevents reruns from overwriting saved, running, or uncertain drafts.
  try { await fs.mkdir(folder); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Profile already exists: ${folder}`); throw error; }
  const connectorSource = {...source, version:1, referenceDate:input.latestInfoDate};
  await fs.writeFile(path.join(folder,'connector-source.json'), JSON.stringify(connectorSource,null,2)+'\n','utf8');
  const values = [result.latestInfoDate,result.title,result.body,result.tags.join(', '),formatProfileSources(result.sources)];
  const payload = {
    document: {title:`[${source.personId}] ${source.row.name} 프로필`,
      text:`제목\n${result.title}\n\n티스토리 원고\n${result.body}\n\n태그\n${result.tags.join(', ')}\n\n조사 출처\n${formatProfileSources(result.sources)}`},
    // Current queue schema only: caller must verify live headers A:Z and row identity before applying.
    sheet: {spreadsheet_id:source.spreadsheetId, requests:[{updateCells:{
      range:{sheetId:source.sheetId,startRowIndex:source.rowNumber-1,endRowIndex:source.rowNumber,startColumnIndex:19,endColumnIndex:24},
      rows:[{values:values.map(stringValue=>({userEnteredValue:{stringValue}}))}],fields:'userEnteredValue'}}]},
    identity: {personId:source.personId,keyword:source.keyword,rowNumber:source.rowNumber},
    instructions:'Verify live headers T:X and row identity before applying. Add document URL to Y after creation. Set S=done and Q=COMPLETE only after verified draft_saved and _SUCCESS.done.'
  };
  await fs.writeFile(path.join(folder,'content.txt'),content,'utf8');
  await fs.writeFile(path.join(folder,'profile-result.json'),JSON.stringify(result,null,2)+'\n','utf8');
  await fs.writeFile(path.join(folder,'connector-payload.json'),JSON.stringify(payload,null,2)+'\n','utf8');
  return {folder,personId:source.personId,rowNumber:source.rowNumber,bodyLength:result.body.length,h2Count:headings.length,
    warnings:result.body.length < 1000 || result.body.length > 1200 ? ['Review body length against the current sheet prompt.'] : []};
}
