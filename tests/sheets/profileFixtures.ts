export const headers = ['인물ID','대분류','세부분류','이름','종목','리그','소속팀','포지션','정당','직위','선거구·소속기관','지역','선출·임명구분','임기','검색키','프롬프트유형','자동화상태','keyword','result','최신정보확인일','제목','본문','태그','조사출처','GoogleDocsURL','검수메모'];
export function profileCells(overrides: Record<string, string> = {}) {
  const data = { 인물ID: 'SP000001', 대분류: '운동선수', 세부분류: '야구선수', 이름: '테스트선수', 소속팀: '테스트팀', 검색키: '테스트선수 야구선수 테스트팀', 프롬프트유형: '야구선수', 자동화상태: 'READY', keyword: '테스트선수 프로필', ...overrides };
  return headers.map(h => (data as Record<string, string>)[h] ?? '');
}
export const promptValues = [
  ['프롬프트ID','구분','적용대상','조합순서','사용여부','버전','프롬프트내용'],
  ['DOC_OUTPUT','','','90','Y','1','DOC RULE'],
  ['BASEBALL','','','30','Y','1','BASEBALL RULE'],
  ['GOLF','','','30','Y','1','GOLF RULE'],
  ['POLITICIAN','','','20','Y','1','POLITICIAN RULE'],
  ['ATHLETE_BASE','','','20','Y','1','ATHLETE RULE'],
  ['COMMON_BASE','','','10','Y','1','COMMON RULE'],
  ['UNUSED','','','1','N','1','DISABLED RULE']
];
export const resultFixture = { latestInfoDate: '2026-09-07', title: '테스트선수 프로필', body: '최종 본문', tags: Array.from({ length: 10 }, (_, i) => `태그${i + 1}`), sources: [{ name: '기관', title: '공식 소개', date: '2026-09-07', url: 'https://example.org/profile' }] };
