import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ProfileResult } from './profileResult';
import type { SheetSource } from './sheetSource';

export function manuscriptDigest(source: SheetSource, content: string, result: ProfileResult): string {
  return createHash('sha256').update(JSON.stringify({ source, content: content.replace(/\r\n/g,'\n'),
    result: { latestInfoDate: result.latestInfoDate, title: result.title, body: result.body.replace(/\r\n/g,'\n'),
      tags: result.tags, sources: result.sources, reviewMemo: result.reviewMemo ?? '' }
  })).digest('hex');
}

export async function writeProfileDraftCheckpoint(folder: string, digest: string): Promise<void> {
  const target = path.join(folder,'profile-draft.json');
  await fs.writeFile(`${target}.tmp`,JSON.stringify({version:1,manuscriptDigest:digest,preparedAt:new Date().toISOString()},null,2)+'\n','utf8');
  await fs.rename(`${target}.tmp`,target);
}

export async function assertProfileDraftCheckpoint(folder: string, digest: string): Promise<void> {
  let value: { version?: number; manuscriptDigest?: string };
  try { value=JSON.parse(await fs.readFile(path.join(folder,'profile-draft.json'),'utf8')); }
  catch { throw new Error('Saved profile is missing a valid profile-draft.json checkpoint; manual review required.'); }
  if (value?.version !== 1 || value.manuscriptDigest !== digest) {
    throw new Error('Saved profile manuscript changed since draft preparation; restore the saved manuscript before completion.');
  }
}
