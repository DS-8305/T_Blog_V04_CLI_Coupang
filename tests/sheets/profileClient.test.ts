import { expect, it, vi } from 'vitest';
import { createGoogleSheetsClient } from '../../src/sheets/googleSheetsClient';
import { headers, profileCells } from './profileFixtures';

function setup(...responses: unknown[]) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (!responses.length) throw new Error('Unexpected network request');
    return new Response(JSON.stringify(responses.shift()));
  });
  return { fetch, client: createGoogleSheetsClient({ fetch, getAccessToken: async () => 'token' }) };
}
it('reads full profile and status from A:Z with reordered headers', async () => {
  const { client } = setup({ values:[[...headers].reverse()] }, { values:[[...profileCells()].reverse()] });
  const row = await client.readSourceRow('sheet', 'Codex_작업큐', 2);
  expect(row).toMatchObject({ automationStatus:'READY', profile:{ personId:'SP000001', team:'테스트팀' } });
});
it('writes only named output cells and verifies values', async () => {
  const fields = { 최신정보확인일:'2026-09-07', 제목:'title', 본문:'body', 태그:'a,b', 조사출처:'sources', GoogleDocsURL:'https://docs.google.com/document/d/id/edit' };
  const before = profileCells();
  const after = profileCells(fields);
  const { fetch, client } = setup({ values:[headers] }, { values:[before] }, { totalUpdatedCells:6 }, { values:[headers] }, { values:[after] });
  await client.writeProfileFields!('sheet','Codex_작업큐',2,fields,{ keyword:'테스트선수 프로필',personId:'SP000001', automationStatus:'READY',result:'' });
  const body = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body));
  expect(body.valueInputOption).toBe('RAW');
  expect(body.data.map((d: {range:string}) => d.range)).toEqual(['T','U','V','W','X','Y'].map(c => `'Codex_작업큐'!${c}2`));
});
it('resolves status column by header and never writes result', async () => {
  const reversed = [...headers].reverse();
  const { fetch, client } = setup({ values:[reversed] }, { values:[[...profileCells()].reverse()] }, { totalUpdatedCells:1 }, { values:[reversed] }, { values:[[...profileCells({자동화상태:'ERROR'})].reverse()] });
  await client.writeProfileFields!('sheet','queue',2,{ 자동화상태:'ERROR' },{keyword:'테스트선수 프로필',personId:'SP000001',automationStatus:'READY',result:''});
  expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body)).data).toEqual([{range:"'queue'!J2",values:[['ERROR']]}]);
  await expect(client.writeProfileFields!('sheet','queue',2,{ result:'done' },{keyword:'x'})).rejects.toThrow('Unsupported');
});
it('protects changed identity before writing', async () => {
  const { fetch, client } = setup({ values:[headers] }, { values:[profileCells({ keyword:'changed' })] });
  await expect(client.writeProfileFields!('sheet','queue',2,{ 제목:'title' },{keyword:'old'})).rejects.toThrow('keyword changed');
  expect(fetch.mock.calls.every(([,init]) => !init?.method)).toBe(true);
});
it('refuses guarded done after HOLD and resolves a moved result header', async () => {
  const expected={keyword:'테스트선수 프로필',personId:'SP000001',automationStatus:'READY',result:''};
  const held=setup({values:[headers]},{values:[profileCells({자동화상태:'HOLD'})]});
  await expect(held.client.writeDone('sheet','queue',2,19,expected)).rejects.toThrow('automationStatus changed');
  expect(held.fetch.mock.calls.every(([,init])=>!init?.method)).toBe(true);
  const moved=setup({values:[[...headers].reverse()]},{values:[[...profileCells()].reverse()]},{updatedCells:1});
  await moved.client.writeDone('sheet','queue',2,19,expected);
  expect(decodeURIComponent(String(moved.fetch.mock.calls[2]?.[0]))).toContain("'queue'!H2");
});
