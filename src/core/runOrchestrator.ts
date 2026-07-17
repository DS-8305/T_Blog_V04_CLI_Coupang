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
  reason?: AutomationFailureReason | "stopped";
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

type SaveResult = AutomationResult | { ok: false; retryable: false; reason: "stopped"; message: string };

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
        result = { ok: false, retryable: false, reason: "stopped", message: STOPPED_MESSAGE };
      } else {
        result = await saveDraftSafely(engine, job, options);
        if (options.signal?.aborted) {
          result = { ok: false, retryable: false, reason: "stopped", message: STOPPED_MESSAGE };
        }
      }
      if (!result.ok) {
        await writePostStatus(job.folderPath, {
          status: result.reason === "stopped" ? "stopped" : "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: result.message
        });
        await appendPostLog(job.folderPath, `Failed: ${result.message}`);
        return { stopped: true, reason: result.reason, message: result.message };
      }

      await writePostStatus(job.folderPath, {
        status: "draft_saved",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: "Draft saved successfully"
      });
      await appendPostLog(job.folderPath, "Draft saved successfully");
      await writeSuccessMarker(job.folderPath);
      options.onLog?.(`Saved draft for ${job.id}`);
      processedCount += 1;
    }

    completedSuccessfully = true;
    return { stopped: false, message: "All eligible posts saved as drafts" };
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
      ok: false as const,
      retryable: false,
      reason: "editor" as const,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
