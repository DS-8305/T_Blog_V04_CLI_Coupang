import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareProfile } from '../../src/cli/profilePrepare';
import { profileBodyText } from '../../src/sheets/profileResult';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, {recursive:true,force:true}); });
async function workspace() { const root = await fs.mkdtemp(path.join(os.tmpdir(),'profile-prepare-')); roots.push(root); return root; }
const input = () => ({
  content:'[TITLE]한승택 프로필[/TITLE]\n\n소개입니다.\n[HR]\n[H2]프로필[/H2]\n내용입니다.\n[HR]\n[H2]성적[/H2]\n기록입니다.',
  latestInfoDate:'2026-09-25', tags:['한승택'], sources:[{name:'KBO',title:'기록',date:'2026-09-25',url:'https://www.koreabaseball.com/'}],
  source:{spreadsheetId:'example',sheetId:1377924888,sheetName:'Codex_작업큐',rowNumber:19,personId:'SP000018',keyword:'한승택 프로필',
    row:{personId:'SP000018',name:'한승택',majorType:'운동선수',detailType:'야구선수',promptType:'야구선수',keyword:'한승택 프로필',automationStatus:'READY',result:''}}
});
it('derives all body copies from one manuscript and targets actual sheet row 19', async () => {
  const value=input(); const prepared=await prepareProfile(await workspace(),value);
  const result=JSON.parse(await fs.readFile(path.join(prepared.folder,'profile-result.json'),'utf8'));
  const payload=JSON.parse(await fs.readFile(path.join(prepared.folder,'connector-payload.json'),'utf8'));
  expect(result.body).toBe(profileBodyText(value.content));
  expect(payload.document.text).toContain(result.body);
  expect(payload.sheet.requests[0].updateCells.range).toMatchObject({startRowIndex:18,startColumnIndex:19,endColumnIndex:24});
  expect(prepared.h2Count).toBe(2);
});
it('rejects a mismatched identity and inactive rows before creating a post',async()=>{
  const value=input(); value.source.row.personId='SP000017';
  await expect(prepareProfile(await workspace(),value)).rejects.toThrow(/identity/i);
  const inactive=input(); inactive.source.row.automationStatus='COMPLETE';
  await expect(prepareProfile(await workspace(),inactive)).rejects.toThrow(/READY/);
});
it('rejects missing widget headings and forbidden markers',async()=>{
  const value=input(); value.content='[TITLE]한승택[/TITLE]\n본문';
  await expect(prepareProfile(await workspace(),value)).rejects.toThrow(/H2/);
  value.content=input().content+'\n[PUBLISH]public[/PUBLISH]';
  await expect(prepareProfile(await workspace(),value)).rejects.toThrow(/PUBLISH/);
});
it('rejects unknown classification without leaving a partial post',async()=>{
  const root=await workspace(); const value=input();
  value.source.row.majorType='unknown'; value.source.row.detailType='unknown'; value.source.row.promptType='unknown';
  await expect(prepareProfile(root,value)).rejects.toThrow(/classification/);
  expect(await fs.readdir(root)).toEqual([]);
});
it('never overwrites an existing or completed item, including a moved sheet row',async()=>{
  const root=await workspace(); const value=input(); const prepared=await prepareProfile(root,value);
  await fs.writeFile(path.join(prepared.folder,'_SUCCESS.done'),'');
  await expect(prepareProfile(root,value)).rejects.toThrow(/already exists/);
  value.source.rowNumber=20;
  await expect(prepareProfile(root,value)).rejects.toThrow(/already exists/);
  expect(await fs.readFile(path.join(prepared.folder,'content.txt'),'utf8')).toBe(value.content);
});
it('allows [IMAGE:...] markers inside the post folder and remaps pre-collected images',async()=>{
  const root=await workspace(); const value=input();
  const folder=path.join(root,'posts','000019-한승택-프로필');
  await fs.mkdir(path.join(folder,'images'),{recursive:true});
  await fs.writeFile(path.join(folder,'images','01-image.png'),'collected-png-1');
  await fs.writeFile(path.join(folder,'image-collection.json'),JSON.stringify({
    version:1,keyword:'한승택',engine:'google',collectedAt:'2026-10-19T06:00:00.000Z',
    images:[{index:1,relativePath:'images/01-image.png',marker:'[IMAGE:images/01-image.png]',engine:'google',width:1200,height:800,byteSize:15,contentHash:'h1',sourceUrl:'',downloadedUrl:'',licenseUrl:'',title:'',downloadKind:'original'}]
  }));
  value.content='[TITLE]한승택 프로필[/TITLE]\n\n소개입니다.\n[HR]\n[H2]프로필[/H2]\n[IMAGE:images/01-profile.png]\n내용입니다.\n[HR]\n[H2]성적[/H2]\n기록입니다.';
  const prepared=await prepareProfile(root,value);
  expect(prepared.imageCount).toBe(1);
  expect(await fs.readFile(path.join(prepared.folder,'images','01-profile.png'),'utf8')).toBe('collected-png-1');
});
it('rejects profile [IMAGE:...] markers that escape the post folder',async()=>{
  const root=await workspace(); const value=input();
  value.content='[TITLE]한승택 프로필[/TITLE]\n\n소개입니다.\n[HR]\n[H2]프로필[/H2]\n[IMAGE:../outside.png]\n내용입니다.\n[HR]\n[H2]성적[/H2]\n기록입니다.';
  await expect(prepareProfile(root,value)).rejects.toThrow(/must stay inside the post folder/);
});
