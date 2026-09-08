import type { AutomationEngine } from '../automation/AutomationEngine';
import { assertRowIdentity, type GoogleSheetsClient } from '../sheets/googleSheetsClient';
import type { LinkedSheetSource } from '../sheets/sheetSource';
import { recordProfileError, syncProfileResult } from '../sheets/profileResultSync';

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
        const result = await engine.saveDraft(job,options);
        if (result.outcome !== 'confirmed') await recordProfileError(job.folderPath,client,result.message);
        return result;
      } catch (error) {
        await recordProfileError(job.folderPath,client,error);
        throw error;
      }
    }
  };
}
