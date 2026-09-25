import type {
  AutomationEngine,
  AutomationFailureReason,
  AutomationResult,
  AutomationRunOptions
} from "../automation/AutomationEngine";
import type { PostJob, TypingSpeedName } from "../shared/types";
import { appendPostLog, writePostStatus, writeSuccessMarker } from "./statusStore";

const STOPPED_MESSAGE = "Run stopped by user";

export type RunResult = {
  stopped: boolean;
  reason?: AutomationFailureReason | "stopped" | "needs_review";
  message: string;
};

type RunOptions = {
  speed: TypingSpeedName;
  signal?: AbortSignal;
  closeEngine?: boolean;
  closeOnSuccess?: boolean;
  onLog?: (message: string) => void;
  maxPosts?: number;
};

type SaveResult = AutomationResult | { outcome: "stopped"; message: string };

export async function runPosts(
  jobs: PostJob[],
  engine: AutomationEngine,
  options: RunOptions
): Promise<RunResult> {
  let completedSuccessfully = false;
  let processedCount = 0;
  try {
    for (const job of jobs) {
      if (job.status !== "pending") continue;
      if (options.maxPosts && processedCount >= options.maxPosts) break;
      if (options.signal?.aborted) {
        return { stopped: true, reason: "stopped", message: STOPPED_MESSAGE };
      }

      const startedAt = new Date().toISOString();
      await writePostStatus(job.folderPath, {
        status: "running",
        startedAt,
        message: "Post automation started"
      });
      await appendPostLog(job.folderPath, `Started post ${job.id}`);
      options.onLog?.(`Starting ${job.id}`);

      let result: SaveResult;
      if (options.signal?.aborted) {
        result = { outcome: "stopped", message: STOPPED_MESSAGE };
      } else {
        const timings: string[] = [];
        result = await saveDraftSafely(engine, job, {...options, onLog: message => {
          if (message.startsWith("[timing]")) timings.push(message);
          options.onLog?.(message);
        }});
        for (const timing of timings) await appendPostLog(job.folderPath, timing);
        if (options.signal?.aborted) {
          result = { outcome: "stopped", message: STOPPED_MESSAGE };
        }
      }
      if (result.outcome === "uncertain") {
        await writePostStatus(job.folderPath, {
          status: "needs_review",
          startedAt,
          finishedAt: new Date().toISOString(),
          publication: job.parsed.metadata.publication,
          message: result.message
        });
        await appendPostLog(job.folderPath, `Needs review: ${result.message}`);
        return { stopped: true, reason: "needs_review", message: result.message };
      }

      if (result.outcome === "failed" || result.outcome === "stopped") {
        const reason = result.outcome === "stopped" ? "stopped" : result.reason;
        await writePostStatus(job.folderPath, {
          status: reason === "stopped" ? "stopped" : "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: result.message
        });
        await appendPostLog(job.folderPath, `Failed: ${result.message}`);
        return { stopped: true, reason, message: result.message };
      }

      await writePostStatus(job.folderPath, {
        status: result.status,
        startedAt,
        finishedAt: new Date().toISOString(),
        publication: job.parsed.metadata.publication,
        ...(result.postUrl ? { postUrl: result.postUrl } : {}),
        message: `Tistory post completed: ${result.status}`
      });
      await appendPostLog(job.folderPath, `Tistory post completed: ${result.status}`);
      await writeSuccessMarker(job.folderPath);
      options.onLog?.(`Completed ${job.id}: ${result.status}`);
      processedCount += 1;
    }

    completedSuccessfully = true;
    return { stopped: false, message: "All eligible Tistory posts completed" };
  } finally {
    if (options.closeEngine !== false && (!completedSuccessfully || options.closeOnSuccess !== false)) {
      try {
        await engine.close();
      } catch {
        // Cleanup errors must not replace the completed run result.
      }
    }
  }
}

async function saveDraftSafely(
  engine: AutomationEngine,
  job: PostJob,
  options: AutomationRunOptions
) {
  try {
    return await engine.saveDraft(job, options);
  } catch (error) {
    return {
      outcome: "failed" as const,
      retryable: false,
      reason: "editor" as const,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
