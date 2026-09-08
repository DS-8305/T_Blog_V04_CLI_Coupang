import type { AutomationEngine } from "../automation/AutomationEngine";
import { TistoryBlogAutomation } from "../automation/TistoryBlogAutomation";
import { loadPosts } from "../core/postLoader";
import { runPosts } from "../core/runOrchestrator";
import type { PostJob } from "../shared/types";
import { MANUAL_CHROME_CDP_ENDPOINT } from "../main/ManualChromeLoginLauncher";
import { parseCliArgs } from "./cliArgs";
import { launchCliChrome } from "./cliChrome";
import { getCliProfilePath } from "./cliPaths";
import { applyCliDraftPolicy } from "./cliPostPolicy";
import { assertRowIdentity, createGoogleSheetsClient, type GoogleSheetsClient } from "../sheets/googleSheetsClient";
import { syncCompletedSheetPosts } from "../sheets/sheetResultSync";
import { findSheetSources, type LinkedSheetSource } from "../sheets/sheetSource";
import { syncProfileResult, recordProfileError } from '../sheets/profileResultSync';
import { profileDraftGuard } from './profileDraftGuard';

export type CliDependencies = {
  getProfilePath: typeof getCliProfilePath;
  launchChrome: typeof launchCliChrome;
  loadPosts: typeof loadPosts;
  applyPolicy: typeof applyCliDraftPolicy;
  attachAutomation: (endpoint: string, blogUrl: string) => AutomationEngine;
  runPosts: typeof runPosts;
  findSheetSources: typeof findSheetSources;
  createSheetsClient: typeof createGoogleSheetsClient;
  syncCompletedSheetPosts: typeof syncCompletedSheetPosts;
  syncProfileResult: typeof syncProfileResult;
  log: (message: string) => void;
  error: (message: string) => void;
};

export async function main(
  argv: string[],
  overrides: Partial<CliDependencies> = {}
): Promise<number> {
  const getProfilePath = overrides.getProfilePath ?? getCliProfilePath;
  const launchChrome = overrides.launchChrome ?? launchCliChrome;
  const load = overrides.loadPosts ?? loadPosts;
  const applyPolicy = overrides.applyPolicy ?? applyCliDraftPolicy;
  const attachAutomation = overrides.attachAutomation
    ?? ((endpoint, blogUrl) => TistoryBlogAutomation.attach(endpoint, blogUrl));
  const run = overrides.runPosts ?? runPosts;
  const findSources = overrides.findSheetSources ?? findSheetSources;
  const createSheetsClient = overrides.createSheetsClient ?? createGoogleSheetsClient;
  const syncSheets = overrides.syncCompletedSheetPosts ?? syncCompletedSheetPosts;
  const log = overrides.log ?? console.log;
  const logError = overrides.error ?? console.error;

  try {
    const command = parseCliArgs(argv);
    if (command.command === "login") {
      const result = await launchChrome(getProfilePath());
      log(result === "launched"
        ? "Dedicated Chrome opened. Sign in to Kakao/Tistory and keep it open."
        : "Dedicated Chrome is already open.");
      return 0;
    }

    let jobs: PostJob[] | undefined;
    let sheetsClient: GoogleSheetsClient | undefined;
    let profiles: LinkedSheetSource[] = [];
    if (command.command === "run") {
      const linkedSources = await findSources(command.workspacePath);
      let inactive = new Set<string>();
      if (linkedSources.length > 0) {
        sheetsClient = createSheetsClient();
        const summary = await syncSheets(command.workspacePath, sheetsClient, log);
        const pending = new Set(summary.pending.map(item => item.postFolder));
        inactive = new Set(linkedSources.filter(item => (item.source.version === 2 || sheetsClient!.writeProfileFields) && !pending.has(item.postFolder)).map(item => item.postFolder));
        profiles = linkedSources.filter(item => item.source.version === 2 && !inactive.has(item.postFolder));
      }
      jobs = await applyPolicy((await load(command.workspacePath)).filter(job => !inactive.has(job.folderPath)));
      for (const job of jobs.filter(job => job.status === 'validation_error' || job.status === 'needs_review')) {
        if (sheetsClient && profiles.some(p => p.postFolder === job.folderPath)) {
          await recordProfileError(job.folderPath,sheetsClient,job.parsed.errors.map(e => e.message).join('; ') || 'Post needs manual review.');
        }
      }
      assertJobsRunnable(jobs);
    }

    const automation = attachAutomation(MANUAL_CHROME_CDP_ENDPOINT, command.blogUrl);
    try {
      const verification = await automation.verifySession();
      if (!verification.ok) throw new Error(verification.message);

      if (command.command === "verify") {
        log("Login session verified.");
        return 0;
      }

      const attemptedProfiles = new Set<string>();
      const syncProfile: typeof syncProfileResult = async (folder, client, options) => {
        attemptedProfiles.add(folder);
        return (overrides.syncProfileResult ?? syncProfileResult)(folder,client,options);
      };
      const guarded = sheetsClient && profiles.length ? profileDraftGuard(automation,profiles,sheetsClient,syncProfile) : automation;
      const result = await run(jobs ?? [], guarded, {
        speed: command.speed,
        ...(command.maxPosts === undefined ? {} : { maxPosts: command.maxPosts }),
        closeEngine: false,
        onLog: log
      });
      if (result.stopped) throw new Error(result.message);
      if (sheetsClient) {
        const sheetSummary = await syncSheets(command.workspacePath, sheetsClient, log);
        const pending = sheetSummary.pending.find(item => item.source.version !== 2 || attemptedProfiles.has(item.postFolder));
        if (pending) {
          throw new Error(
            `Sheet completion pending for row ${pending.source.rowNumber}; retry this command to resume the done write.`
          );
        }
        for (const item of profiles.filter(item => attemptedProfiles.has(item.postFolder))) {
          const {source} = item;
          const finalRow = await sheetsClient.readSourceRow(source.spreadsheetId,source.sheetName,source.rowNumber);
          assertRowIdentity(finalRow,source,source.rowNumber);
          if (finalRow.result.trim().toLowerCase() !== 'done' || finalRow.automationStatus !== 'COMPLETE') {
            throw new Error(`Profile row ${source.rowNumber} completion not confirmed: result=${finalRow.result || '(blank)'}, status=${finalRow.automationStatus}.`);
          }
        }
      }
      log(result.message);
      return 0;
    } finally {
      await automation.close();
    }
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function assertJobsRunnable(jobs: PostJob[]): void {
  const invalid = jobs.filter((job) => job.status === "validation_error");
  if (invalid.length > 0) {
    throw new Error(invalid.map((job) => {
      const messages = job.parsed.errors.map((error) => error.message).join("; ") || "Validation failed.";
      return `Invalid post ${job.id}: ${messages}`;
    }).join("\n"));
  }

  const needsReview = jobs.find((job) => job.status === "needs_review");
  if (needsReview) {
    throw new Error(`Post ${needsReview.id} requires manual review before another CLI run.`);
  }
}

if (process.argv[1]?.endsWith("draftCli.js")) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
