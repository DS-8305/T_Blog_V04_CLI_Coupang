import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeTistoryBlogUrl } from '../core/blogConfig';

const athleteTypes = new Set(['운동선수', '야구선수', '축구선수', '농구선수', '배구선수', '골프선수']);
const civicTypes = new Set(['정치인', '공직자', '공무원', '정치인·공직자', '국회의원', '광역단체장', '기초단체장', '장관', '차관', '위원장']);

export function classifyProfileBlog(row: unknown): string {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Missing profile classification');
  const data = row as Record<string, unknown>;
  const values = ['majorType', 'detailType', 'promptType'].map(key => typeof data[key] === 'string' ? data[key].trim() : '');
  const athlete = values.some(value => athleteTypes.has(value));
  const civic = values.some(value => civicTypes.has(value));
  if (athlete === civic) throw new Error('Unknown or conflicting profile classification');
  return athlete ? 'https://time-giver.tistory.com' : 'https://moneyguru.tistory.com';
}

export async function resolveProfileBlog(folders: string[], requested: string): Promise<string> {
  const destinations = new Set<string>();
  let unclassified = false;
  for (const folder of folders) {
    let found = false;
    for (const file of ['profile-task.json', 'connector-source.json', 'sheet-source.json']) {
      let text: string;
      try { text = await fs.readFile(path.join(folder, file), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const data = JSON.parse(text);
      if (file === 'sheet-source.json' && data?.version === 1) continue;
      let row = data?.row;
      if (file === 'sheet-source.json') row = { promptType: data?.promptType };
      // Compatibility for the fixed A:Z snapshot used before named row objects.
      if (file === 'connector-source.json' && !row && Array.isArray(data?.sourceRow)) {
        row = { majorType: data.sourceRow[1], detailType: data.sourceRow[2], promptType: data.sourceRow[15] };
      }
      destinations.add(classifyProfileBlog(row)); found = true;
    }
    if (!found) unclassified = true;
  }
  if (destinations.size > 1) throw new Error('Mixed profile blog destinations; run one category at a time');
  if (requested === 'auto') {
    if (unclassified || destinations.size !== 1) throw new Error('Cannot auto-route without profile classification');
    return [...destinations][0]!;
  }
  const normalized = normalizeTistoryBlogUrl(requested);
  if (destinations.size && !destinations.has(normalized)) throw new Error(`Profile blog mismatch: expected ${[...destinations][0]}, received ${normalized}`);
  return normalized;
}
