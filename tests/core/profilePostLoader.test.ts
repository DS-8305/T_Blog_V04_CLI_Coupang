import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach,expect,it } from 'vitest';
import { loadPosts } from '../../src/core/postLoader';
import { writeSheetSource } from '../../src/sheets/sheetSource';
const roots:string[]=[];
afterEach(async () => {await Promise.all(roots.splice(0).map(p=>fs.rm(p,{recursive:true,force:true})));});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'profile-loader-'));roots.push(root);
  const folder=path.join(root,'posts','profile');
  await writeSheetSource(folder,{version:2,personId:'SP1',promptType:'야구선수',spreadsheetId:'sheet',sheetName:'queue',rowNumber:2,keywordHeader:'keyword',resultHeader:'result',keyword:'keyword'});
  return {root,folder};
}
it('does not treat profile-prompt.txt as a draft when content.txt is missing',async () => {
  const s=await setup();await fs.writeFile(path.join(s.folder,'profile-prompt.txt'),'[TITLE]Instruction[/TITLE]\nNot content');
  expect((await loadPosts(s.root))[0]?.parsed.errors).toContainEqual(expect.objectContaining({code:'missing_content'}));
});
it('does not apply the health length contract to a v2 profile even with four images',async () => {
  const s=await setup();await fs.mkdir(path.join(s.folder,'images'));
  await fs.writeFile(path.join(s.folder,'images','photo.png'),'test');
  const body=Array.from({length:4},()=> '[HR]\n[H2]프로필[/H2]\n[IMAGE:images/photo.png]\n'+ '가'.repeat(250)).join('\n');
  await fs.writeFile(path.join(s.folder,'content.txt'),'[TITLE]프로필[/TITLE]\n'+body);
  expect((await loadPosts(s.root))[0]?.parsed.errors).toEqual([]);
});
