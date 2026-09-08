import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { syncProfileResult } from '../../src/sheets/profileResultSync';
import { syncCompletedSheetPosts } from '../../src/sheets/sheetResultSync';
import { writeSheetSource } from '../../src/sheets/sheetSource';
import { writePostStatus } from '../../src/core/statusStore';
import { readSheetCompletionCheckpoint } from '../../src/sheets/sheetCompletionCheckpoint';
import { parseContent } from '../../src/core/parser';
import { mapProfileSheetRow } from '../../src/sheets/profileSheetRow';
import type { GoogleSheetsClient } from '../../src/sheets/googleSheetsClient';
import { headers, profileCells, resultFixture } from './profileFixtures';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p,{recursive:true,force:true}))); });
async function setup(status = 'READY', result = '') {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(),'profile-sync-')); roots.push(workspace);
  const folder = path.join(workspace,'posts','000002-test');
  const source = {version:2 as const,spreadsheetId:'sheet',sheetName:'queue',rowNumber:2,keywordHeader:'keyword' as const,resultHeader:'result' as const,keyword:'테스트선수 프로필',personId:'SP000001',promptType:'야구선수'};
  await writeSheetSource(folder,source);
  await fs.writeFile(path.join(folder,'profile-result.json'), JSON.stringify(resultFixture));
  await fs.writeFile(path.join(folder,'content.txt'),`[TITLE]${resultFixture.title}[/TITLE]\n${resultFixture.body}`);
  const row = {...mapProfileSheetRow(headers,profileCells({자동화상태:status,result}))};
  const writes: string[] = [];
  const client: GoogleSheetsClient = {
    readQueue:async () => ({values:[],rowCount:0}),
    readSourceRow:async () => ({keyword:row.keyword,result:row.result,keywordColumn:18,resultColumn:19,automationStatus:row.automationStatus,profile:{...row}}),
    writeDone:async () => { writes.push('done'); row.result='done'; },
    writeProfileFields:async (_id,_tab,_number,fields) => {
      writes.push(Object.keys(fields).join(','));
      for (const [header,value] of Object.entries(fields)) {
        const cells = headers.map(h => h === header ? value : profileCells()[headers.indexOf(h)]!);
        const field = Object.keys(mapProfileSheetRow(headers,cells))[headers.indexOf(header)]!;
        (row as Record<string,string>)[field] = value;
      }
    }
  };
  const docs = {save:vi.fn(async (_input: import('../../src/google/googleDocsClient').ProfileDocInput) => {writes.push('docs'); return 'https://docs.google.com/document/d/doc1/edit';})};
  return {workspace,folder,source,row,client,docs,writes};
}
it('syncs outputs then Docs URL without writing result or COMPLETE', async () => {
  const s = await setup();
  await syncProfileResult(s.folder,s.client,{docs:s.docs,folderId:'folder'});
  expect(s.writes).toEqual(['최신정보확인일,제목,본문,태그,조사출처','docs','GoogleDocsURL']);
  expect(s.row.result).toBe(''); expect(s.row.automationStatus).toBe('READY');
  expect(s.docs.save.mock.calls[0]?.[0]).toMatchObject({title:'[SP000001] 테스트선수 프로필',text:expect.stringContaining('조사 출처')});
});
it('records ERROR and review memo on Docs failure but leaves result blank', async () => {
  const s = await setup(); s.docs.save.mockRejectedValueOnce(new Error('Docs offline'));
  await expect(syncProfileResult(s.folder,s.client,{docs:s.docs,folderId:'folder'})).rejects.toThrow('Docs offline');
  expect(s.row.automationStatus).toBe('ERROR'); expect(s.row.result).toBe(''); expect(s.row.reviewMemo).toContain('Docs offline');
});
it('rejects mismatched manuscript before any remote writes', async () => {
  const s = await setup();
  await fs.writeFile(path.join(s.folder,'content.txt'),'[TITLE]different[/TITLE]\nwrong');
  await expect(syncProfileResult(s.folder,s.client,{docs:s.docs,folderId:'folder'})).rejects.toThrow('does not match');
  expect(s.writes).not.toContain('docs'); expect(s.row.title).toBe('');
});
it.each(['HOLD','ERROR','REVIEW','COMPLETE'])('does not let a %s local source block the queue', async status => {
  const s = await setup(status);
  expect((await syncCompletedSheetPosts(s.workspace,s.client)).pending).toEqual([]);
  expect(s.writes).toEqual([]);
});
it('does not let an externally filled result block the queue', async () => {
  const s = await setup('READY','external');
  expect((await syncCompletedSheetPosts(s.workspace,s.client)).pending).toEqual([]);
});
it('does not let an externally filled result block an already saved profile either',async()=>{
  const s=await setup('READY','external');await writePostStatus(s.folder,{status:'draft_saved',message:'saved'});
  expect((await syncCompletedSheetPosts(s.workspace,s.client)).pending).toEqual([]);
  expect(s.writes).toEqual([]);
});
it('recovers the local completion checkpoint after a confirmed COMPLETE/done',async()=>{
  const s=await setup('COMPLETE','done');await writePostStatus(s.folder,{status:'draft_saved',message:'saved'});
  expect((await syncCompletedSheetPosts(s.workspace,s.client)).alreadyDone).toBe(1);
  expect(await readSheetCompletionCheckpoint(s.folder)).toMatchObject({state:'sheet_done'});
  expect(s.writes).toEqual([]);
});
it('syncs profile outputs before done and COMPLETE only after draft_saved', async () => {
  const s = await setup();
  await syncProfileResult(s.folder,s.client,{docs:s.docs,folderId:'folder',draftJob:await draftJob(s.folder)});
  s.writes.length=0;
  await writePostStatus(s.folder,{status:'draft_saved',message:'saved'});
  const syncProfile = async () => syncProfileResult(s.folder,s.client,{docs:s.docs,folderId:'folder'});
  await syncCompletedSheetPosts(s.workspace,s.client,undefined,{syncProfile});
  expect(s.writes).toEqual(['최신정보확인일,제목,본문,태그,조사출처','docs','GoogleDocsURL','done','자동화상태']);
  expect(s.row.automationStatus).toBe('COMPLETE');
});
it('rejects a loaded job whose text differs from the current manuscript before output writes',async()=>{
  const s=await setup();const job=await draftJob(s.folder);job.parsed.title='older title';
  await expect(syncProfileResult(s.folder,s.client,{docs:s.docs,folderId:'folder',draftJob:job})).rejects.toThrow('loaded draft');
  expect(s.row.title).toBe('');expect(s.docs.save).not.toHaveBeenCalled();
});
it('refuses to mark a saved draft complete after local manuscript/result edits',async()=>{
  const s=await setup();
  await syncProfileResult(s.folder,s.client,{docs:s.docs,folderId:'folder',draftJob:await draftJob(s.folder)});
  await writePostStatus(s.folder,{status:'draft_saved',message:'saved original'});
  await fs.writeFile(path.join(s.folder,'content.txt'),'[TITLE]새 제목[/TITLE]\n새 본문');
  await fs.writeFile(path.join(s.folder,'profile-result.json'),JSON.stringify({...resultFixture,title:'새 제목',body:'새 본문'}));
  s.writes.length=0;
  await expect(syncCompletedSheetPosts(s.workspace,s.client,undefined,{syncProfile:async()=>syncProfileResult(s.folder,s.client,{docs:s.docs,folderId:'folder',allowDone:true})})).rejects.toThrow('manuscript changed');
  expect(s.row.title).toBe(resultFixture.title);expect(s.row.result).toBe('');expect(s.writes).not.toContain('done');
});
async function draftJob(folder:string) {
  const contentPath=path.join(folder,'content.txt');
  return {id:path.basename(folder),folderPath:folder,contentPath,status:'pending' as const,parsed:parseContent(await fs.readFile(contentPath,'utf8'),folder)};
}
it('protects changed person identity and keyword', async () => {
  const s = await setup(); s.row.keyword='changed';
  await expect(syncCompletedSheetPosts(s.workspace,s.client)).rejects.toThrow('keyword changed');
  expect(s.writes).toEqual([]);
});
