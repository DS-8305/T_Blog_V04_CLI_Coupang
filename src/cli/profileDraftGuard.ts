import fs from 'node:fs/promises';
import path from 'node:path';
import type { AutomationEngine } from '../automation/AutomationEngine';
import { assertRowIdentity, type GoogleSheetsClient } from '../sheets/googleSheetsClient';
import type { LinkedSheetSource } from '../sheets/sheetSource';
import { recordProfileError, syncProfileResult } from '../sheets/profileResultSync';

const athletePromptTypes = new Set(['야구선수', '축구선수', '농구선수', '배구선수', '골프선수']);

export function profileDraftGuard(engine: AutomationEngine, linked: LinkedSheetSource[], client: GoogleSheetsClient,
  sync: typeof syncProfileResult): AutomationEngine {
  return {
    verifySession: () => engine.verifySession(),
    close: () => engine.close(),
    async saveDraft(job, options) {
      const item = linked.find(item => item.postFolder === job.folderPath);
      if (!item) return engine.saveDraft(job,options);
      try {
        await sync(job.folderPath,client,{draftJob:job});
        const {source} = item;
        const remote = await client.readSourceRow(source.spreadsheetId,source.sheetName,source.rowNumber);
        assertRowIdentity(remote,{...source,automationStatus:'READY',result:''},source.rowNumber);
        const draftJob = await applyAthleteTistoryTags(job, item);
        const result = await engine.saveDraft(draftJob,options);
        if (result.outcome !== 'confirmed') await recordProfileError(job.folderPath,client,result.message);
        return result;
      } catch (error) {
        await recordProfileError(job.folderPath,client,error);
        throw error;
      }
    }
  };
}

async function applyAthleteTistoryTags(job: Parameters<AutomationEngine['saveDraft']>[0], item: LinkedSheetSource) {
  const {source} = item;
  if (!source.promptType || !athletePromptTypes.has(source.promptType)) return job;

  const task = JSON.parse(await fs.readFile(path.join(item.postFolder, 'profile-task.json'), 'utf8')) as {
    personId?: unknown;
    row?: { majorType?: unknown; name?: unknown; personId?: unknown; promptType?: unknown };
  };
  const name = typeof task.row?.name === 'string' ? task.row.name.trim() : '';
  if (task.personId !== source.personId || task.row?.personId !== source.personId || task.row?.promptType !== source.promptType
    || task.row?.majorType !== '운동선수' || !name) {
    throw new Error('Athlete Tistory tags require a matching profile-task.json with the athlete name.');
  }

  return {
    ...job,
    parsed: {
      ...job.parsed,
      metadata: {
        ...job.parsed.metadata,
        tags: [`${name}프로필`, `${name}성적`, `${name}연봉`, `${name}나이`]
      }
    }
  };
}
