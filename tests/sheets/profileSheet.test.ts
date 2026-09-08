import { describe, expect, it } from 'vitest';
import { selectFirstPendingRow } from '../../src/sheets/sheetQueue';
import { mapProfileSheetRow } from '../../src/sheets/profileSheetRow';
import { composeProfilePrompt } from '../../src/sheets/promptSettings';
import { headers, profileCells, promptValues } from './profileFixtures';

describe('profile queue and prompts', () => {
  it.each(['HOLD','ERROR','REVIEW','COMPLETE',''])('skips %s before READY', status => {
    expect(selectFirstPendingRow([headers, profileCells({ 자동화상태: status }), profileCells()])?.rowNumber).toBe(3);
  });
  it('keeps legacy keyword/result selection', () => {
    expect(selectFirstPendingRow([['result','keyword'],['done','old'],['','new']])?.keyword).toBe('new');
  });
  it('maps every column by header after reordering', () => {
    const values = profileCells({ 정당: '정당', 지역: '서울', 본문: 'line1\nline2' });
    const row = mapProfileSheetRow([...headers].reverse(), [...values].reverse());
    expect(Object.keys(row)).toHaveLength(26);
    expect(row).toMatchObject({ personId:'SP000001', party:'정당', region:'서울', body:'line1\nline2', googleDocsUrl:'' });
    expect(() => mapProfileSheetRow(headers.slice(1), values.slice(1))).toThrow('인물ID');
  });
  it.each([
    ['야구선수','운동선수',['COMMON_BASE','ATHLETE_BASE','BASEBALL','DOC_OUTPUT']],
    ['골프선수','운동선수',['COMMON_BASE','ATHLETE_BASE','GOLF','DOC_OUTPUT']],
    ['국회의원','정치인·공직자',['COMMON_BASE','POLITICIAN','DOC_OUTPUT']]
  ])('composes %s settings and Seoul date', (type, major, ids) => {
    const row = mapProfileSheetRow(headers, profileCells({ 프롬프트유형:type, 세부분류:type, 대분류:major }));
    const composed = composeProfilePrompt(promptValues, row, new Date('2026-09-06T16:00:00Z'));
    expect(composed.promptIds).toEqual(ids);
    expect(composed.text).toContain('2026-09-07');
    expect(composed.text).toContain('검색키: 테스트선수 야구선수 테스트팀');
    expect(composed.text).not.toContain('DISABLED RULE');
    expect(composed.text.indexOf('인물ID:')).toBeLessThan(composed.text.indexOf('DOC RULE'));
  });
  it('rejects a missing enabled required prompt instead of silently using health defaults', () => {
    const values = promptValues.map(r => r[0] === 'COMMON_BASE' ? r.map((v,i) => i === 4 ? 'N' : v) : r);
    expect(() => composeProfilePrompt(values, mapProfileSheetRow(headers, profileCells()))).toThrow('COMMON_BASE');
  });
});
