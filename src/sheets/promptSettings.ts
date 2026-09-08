import { requireUniqueHeader } from './sheetQueue';
import { profileHeaders, type ProfileSheetRow } from './profileSheetRow';

const sportPrompts: Record<string, string> = {
  야구선수: 'BASEBALL', 축구선수: 'FOOTBALL', 농구선수: 'BASKETBALL', 배구선수: 'VOLLEYBALL', 골프선수: 'GOLF'
};

export function seoulDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}

export function composeProfilePrompt(values: string[][], row: ProfileSheetRow, now = new Date()) {
  for (const key of ['personId', 'name', 'searchKey', 'promptType'] as const) {
    if (!row[key]) throw new Error(`Missing profile identity: ${profileHeaders[key]}`);
  }
  const sport = sportPrompts[row.promptType];
  const athlete = Boolean(sport) || row.majorType.includes('운동') || row.detailType.endsWith('선수');
  if (athlete && !sport) throw new Error(`Unsupported athlete prompt type: ${row.promptType}`);
  const required = ['COMMON_BASE', ...(athlete ? ['ATHLETE_BASE', sport!] : ['POLITICIAN']), 'DOC_OUTPUT'];
  const headers = values[0] ?? [];
  const columns = ['프롬프트ID', '조합순서', '사용여부', '프롬프트내용'].map(h => requireUniqueHeader(headers, h) - 1);
  const prompts = values.slice(1).filter(c => c[columns[2]!]?.trim() === 'Y' && required.includes(c[columns[0]!]!.trim())).map(c => ({
    id: c[columns[0]!]!.trim(), order: Number(c[columns[1]!]), text: c[columns[3]!]?.trim() ?? ''
  })).sort((a, b) => a.order - b.order);
  for (const id of required) {
    const matching = prompts.filter(p => p.id === id);
    if (matching.length !== 1 || !matching[0]!.text || !Number.isFinite(matching[0]!.order)) {
      throw new Error(`Expected one enabled valid prompt: ${id}`);
    }
  }
  // Data must precede output rules; reject contradictory sheet ordering rather than silently override it.
  if (prompts[0]?.id !== 'COMMON_BASE' || prompts.at(-1)?.id !== 'DOC_OUTPUT') {
    throw new Error('Prompt order must start with COMMON_BASE and end with DOC_OUTPUT.');
  }
  const data = Object.entries(profileHeaders).filter(([key]) => !['result','title','body','tags','sources','googleDocsUrl','reviewMemo'].includes(key))
    .filter(([key]) => row[key as keyof ProfileSheetRow])
    .map(([key, label]) => `${label}: ${row[key as keyof ProfileSheetRow]}`).join('\n');
  const date = seoulDate(now);
  return { promptIds: prompts.map(p => p.id), date, text: [
    ...prompts.slice(0, -1).map(p => p.text), data, `기준일: ${date} (Asia/Seoul)`, prompts.at(-1)!.text
  ].join('\n\n') + '\n' };
}
