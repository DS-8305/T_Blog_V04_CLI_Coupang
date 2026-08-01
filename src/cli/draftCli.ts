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

export type CliDependencies = {
  getProfilePath: typeof getCliProfilePath;
  launchChrome: typeof launchCliChrome;
  loadPosts: typeof loadPosts;
  applyPolicy: typeof applyCliDraftPolicy;
  attachAutomation: (endpoint: string, blogUrl: string) => AutomationEngine;
  runPosts: typeof runPosts;
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
    if (command.command === "run") {
      jobs = await applyPolicy(await load(command.workspacePath));
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

      const result = await run(jobs ?? [], automation, {
        speed: command.speed,
        ...(command.maxPosts === undefined ? {} : { maxPosts: command.maxPosts }),
        closeEngine: false,
        onLog: log
      });
      if (result.stopped) throw new Error(result.message);
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
