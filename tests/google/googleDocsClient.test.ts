import { expect, it, vi } from 'vitest';
import { createGoogleDocsClient } from '../../src/google/googleDocsClient';

const input = { folderId:'folder', key:'source-key', title:'[SP001] 테스트 프로필', text:'제목\n본문\n태그\n조사 출처' };
const folder = { id:'folder',mimeType:'application/vnd.google-apps.folder',driveId:'shared-drive',capabilities:{canAddChildren:true} };
function document(text: string, revisionId = 'rev1') { return { revisionId,body:{content:[{endIndex:text.length + 2,paragraph:{elements:[{textRun:{content:text+'\n'}}]}}]} }; }
function setup(...responses: Array<unknown | Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (!responses.length) throw new Error('Unexpected request');
    const next = responses.shift();
    return next instanceof Response ? next : new Response(JSON.stringify(next));
  });
  return { fetch, client:createGoogleDocsClient({ fetch,getAccessToken:async () => 'token' }) };
}
it('creates a native Doc directly in the shared folder and verifies inserted text', async () => {
  const { fetch,client } = setup(folder,{files:[]},{id:'doc1'},document(''),{},document(input.text,'rev2'));
  await expect(client.save(input)).resolves.toBe('https://docs.google.com/document/d/doc1/edit');
  const create = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body));
  expect(create).toMatchObject({name:input.title,mimeType:'application/vnd.google-apps.document',parents:['folder'],appProperties:{profileSource:'source-key'}});
  const batch = JSON.parse(String(fetch.mock.calls[4]?.[1]?.body));
  expect(batch.requests.at(-1)).toEqual({insertText:{location:{index:1},text:input.text}});
  expect(batch.writeControl).toEqual({requiredRevisionId:'rev1'});
});
it('reuses an existing matching document on retry instead of creating duplicates', async () => {
  const { fetch,client } = setup(folder,{files:[{id:'doc1'}]},document(input.text));
  await client.save(input);
  expect(fetch.mock.calls.every(([,init]) => !init?.method)).toBe(true);
});
it.each([
  [new Response(JSON.stringify({error:{message:'denied'}}),{status:403}),'PROFILE_DOCS_FOLDER_ID'],
  [{...folder,driveId:undefined},'shared drive'],
  [{...folder,capabilities:{canAddChildren:false}},'write permission']
])('reports inaccessible or unsuitable folders', async (response,error) => {
  const {client} = setup(response);
  await expect(client.save(input)).rejects.toThrow(String(error));
});
it('reports Docs API errors without leaking access tokens', async () => {
  const {client} = setup(folder,{files:[]},{id:'doc1'},new Response(JSON.stringify({error:{message:'Docs disabled'}}),{status:403}));
  await expect(client.save(input)).rejects.toThrow('Google Docs API 403: Docs disabled');
});
it('does not confirm success when read-back content differs', async () => {
  const {client} = setup(folder,{files:[]},{id:'doc1'},document(''),{},document('wrong'));
  await expect(client.save(input)).rejects.toThrow('confirm');
});
it('replaces changed existing text with a revision guarded delete and insert',async()=>{
  const {fetch,client}=setup(folder,{files:[{id:'doc1'}]},document('old'),{},document(input.text,'rev2'));
  await client.save(input);
  expect(JSON.parse(String(fetch.mock.calls[3]?.[1]?.body)).requests).toEqual([
    {deleteContentRange:{range:{startIndex:1,endIndex:4}}},
    {insertText:{location:{index:1},text:input.text}}
  ]);
});
it('updates the name of a reused document when the person name is corrected',async()=>{
  const {fetch,client}=setup(folder,{files:[{id:'doc1',name:'old name'}]},{name:input.title},document(input.text));
  await client.save(input);
  expect(fetch.mock.calls[2]?.[1]).toMatchObject({method:'PATCH',body:JSON.stringify({name:input.title})});
});
