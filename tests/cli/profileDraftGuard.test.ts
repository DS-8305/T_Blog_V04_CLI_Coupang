import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationEngine } from '../../src/automation/AutomationEngine';
import type { PostJob } from '../../src/shared/types';
import type { GoogleSheetsClient } from '../../src/sheets/googleSheetsClient';
import type { LinkedSheetSource } from '../../src/sheets/sheetSource';
import { profileDraftGuard } from '../../src/cli/profileDraftGuard';
import type { syncProfileResult } from '../../src/sheets/profileResultSync';

const temporaryFolders: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true })));
});

describe('profileDraftGuard', () => {
  it.each(['야구선수', '축구선수', '농구선수', '배구선수', '골프선수'])(
    'uses exactly the four name-based Tistory tags for a %s profile', async promptType => {
      const folder = await makeProfileFolder('운동선수', '임기영', promptType);
      const job = makeJob(folder, []);
      const saveDraft = vi.fn(async (_job: PostJob) => ({ outcome: 'confirmed', status: 'draft_saved' } as const));
      const guard = createGuard(folder, saveDraft, promptType);

      await guard.saveDraft(job, { speed: 'fast' });

      expect(saveDraft).toHaveBeenCalledOnce();
      expect(saveDraft.mock.calls[0]?.[0].parsed.metadata.tags).toEqual(['임기영프로필', '임기영성적', '임기영연봉', '임기영나이']);
      expect(job.parsed.metadata.tags).toEqual([]);
    }
  );

  it('does not add athlete tags to a politician profile', async () => {
    const folder = await makeProfileFolder('정치인·공직자', '김정민');
    const job = makeJob(folder, ['기존 태그']);
    const saveDraft = vi.fn(async (_job: PostJob) => ({ outcome: 'confirmed', status: 'draft_saved' } as const));
    const guard = createGuard(folder, saveDraft, '정치인·공직자');

    await guard.saveDraft(job, { speed: 'fast' });

    expect(saveDraft.mock.calls[0]?.[0].parsed.metadata.tags).toEqual(['기존 태그']);
  });
});

function createGuard(folder: string, saveDraft: AutomationEngine['saveDraft'], promptType = '야구선수') {
  const engine: AutomationEngine = {
    verifySession: async () => ({ ok: true }),
    saveDraft,
    close: async () => undefined
  };
  const client = {
    readSourceRow: async () => ({
      keyword: '선수 프로필', result: '', keywordColumn: 17, resultColumn: 18,
      automationStatus: 'READY', profile: { personId: 'SP000001' } as never
    }),
    readQueue: async () => ({ values: [], rowCount: 0 }),
    writeDone: async () => undefined
  } satisfies GoogleSheetsClient;
  const source: LinkedSheetSource['source'] = {
    version: 2, personId: 'SP000001', promptType, spreadsheetId: 'sheet-id',
    sheetName: 'Codex_작업큐', rowNumber: 2, keywordHeader: 'keyword', resultHeader: 'result', keyword: '선수 프로필'
  };
  const sync = vi.fn(async () => 'https://docs.google.com/document/d/test/edit') as unknown as typeof syncProfileResult;
  return profileDraftGuard(engine, [{ postFolder: folder, source }], client, sync);
}

async function makeProfileFolder(majorType: string, name: string, promptType?: string): Promise<string> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-draft-guard-'));
  temporaryFolders.push(folder);
  await fs.writeFile(path.join(folder, 'profile-task.json'), JSON.stringify({
    version: 1, personId: 'SP000001', name,
    row: { personId: 'SP000001', name, majorType, promptType: promptType ?? (majorType === '운동선수' ? '야구선수' : '정치인·공직자') }
  }));
  return folder;
}

function makeJob(folderPath: string, tags: string[]): PostJob {
  return {
    id: 'profile', folderPath, contentPath: path.join(folderPath, 'content.txt'), status: 'pending',
    parsed: {
      title: '선수 프로필', events: [], errors: [],
      metadata: { publication: 'draft', category: null, tags, scheduledAt: null }
    }
  };
}
