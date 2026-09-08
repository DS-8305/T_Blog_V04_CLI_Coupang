import { expect, it } from 'vitest';
import { parseProfileResult, formatProfileSources } from '../../src/sheets/profileResult';
import { resultFixture } from './profileFixtures';
it('validates result schema and formats line-separated sources', () => {
  expect(parseProfileResult(resultFixture)).toEqual(resultFixture);
  expect(formatProfileSources(resultFixture.sources)).toBe('기관 | 공식 소개 | 2026-09-07 | https://example.org/profile');
});
it.each([{...resultFixture,latestInfoDate:'2026-02-30'},{...resultFixture,tags:'tag'}, {...resultFixture,sources:[{url:'javascript:alert(1)'}]}, {...resultFixture,body:''}])('rejects invalid result files', value => {
  expect(() => parseProfileResult(value)).toThrow('profile-result.json');
});
