import { optionalSheetHeader, requireUniqueHeader } from './sheetQueue';

export const profileHeaders = {
  personId: '인물ID', majorType: '대분류', detailType: '세부분류', name: '이름',
  sport: '종목', league: '리그', team: '소속팀', position: '포지션', party: '정당',
  office: '직위', constituencyOrAgency: '선거구·소속기관', region: '지역',
  appointmentType: '선출·임명구분', term: '임기', searchKey: '검색키', promptType: '프롬프트유형',
  automationStatus: '자동화상태', keyword: 'keyword', result: 'result', latestInfoDate: '최신정보확인일',
  title: '제목', body: '본문', tags: '태그', sources: '조사출처', googleDocsUrl: 'GoogleDocsURL', reviewMemo: '검수메모'
} as const;
export type ProfileSheetRow = { [K in keyof typeof profileHeaders]: string };

export function isProfileSheet(headers: string[]): boolean {
  return optionalSheetHeader(headers, '인물ID') !== undefined;
}

export function mapProfileSheetRow(headers: string[], cells: string[]): ProfileSheetRow {
  return Object.fromEntries(Object.entries(profileHeaders).map(([key, header]) =>
    [key, cells[requireUniqueHeader(headers, header) - 1]?.trim() ?? '']
  )) as ProfileSheetRow;
}
