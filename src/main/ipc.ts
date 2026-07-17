import { dialog, ipcMain } from "electron";
import { NaverBlogAutomation } from "../automation/NaverBlogAutomation";
import { readBlogConfig, writeBlogConfig } from "../core/blogConfig";
import { loadPosts } from "../core/postLoader";
import { runPosts } from "../core/runOrchestrator";
import { resolveReview } from "../core/statusStore";
import type { LoginActionResult, PostJob, ReviewOutcome, TypingSpeedName } from "../shared/types";
import { getBlogConfigPath, getBrowserProfilePath, getSecurityHoldPath } from "./appPaths";
import { LoginSessionCoordinator } from "./LoginSessionCoordinator";
import { ManualChromeLoginLauncher } from "./ManualChromeLoginLauncher";

let activeRunController: AbortController | null = null;

type RunResultWithOptionalReason = Awaited<ReturnType<typeof runPosts>> & {
  reason?: string;
};

export async function registerIpcHandlers(): Promise<void> {
  const blogConfigPath = getBlogConfigPath();
  const launcher = new ManualChromeLoginLauncher();
  const coordinator = new LoginSessionCoordinator({
    launcher,
    createAutomation: (cdpEndpoint) => NaverBlogAutomation.attach(cdpEndpoint),
    profilePath: getBrowserProfilePath(),
    holdPath: getSecurityHoldPath()
  });
  await coordinator.initialize();

  const blockedLoginAction = (): LoginActionResult => ({
    ok: false,
    snapshot: coordinator.getState()
  });

  ipcMain.handle("workspace:select", async () => {
    const result = await dialog.showOpenDialog({
      title: "작업 폴더 선택",
      properties: ["openDirectory"]
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("posts:load", async (_event, workspacePath: string) => {
    return loadPosts(workspacePath);
  });

  ipcMain.handle("blog:getConfig", async () => readBlogConfig(blogConfigPath));
  ipcMain.handle("blog:saveConfig", async (_event, blogUrl: unknown) => {
    if (typeof blogUrl !== "string") {
      throw new Error("A blog URL string is required.");
    }
    await writeBlogConfig(blogConfigPath, { blogUrl });
    const saved = await readBlogConfig(blogConfigPath);
    if (!saved) throw new Error("Saved blog configuration could not be read.");
    return saved;
  });

  ipcMain.handle("review:resolve", async (_event, job: PostJob, outcome: unknown) => {
    if (outcome !== "already_created" && outcome !== "not_created") {
      throw new Error("Review outcome must be already_created or not_created.");
    }
    if (!job || typeof job !== "object" || typeof job.folderPath !== "string") {
      throw new Error("A valid post job is required.");
    }
    await resolveReview(job, outcome as ReviewOutcome);
    return { ok: true };
  });

  ipcMain.handle("login:getState", async () => coordinator.getState());
  ipcMain.handle("login:openManual", async () => {
    return activeRunController ? blockedLoginAction() : coordinator.openManualLogin();
  });
  ipcMain.handle("login:verify", async () => {
    return activeRunController ? blockedLoginAction() : coordinator.verifySession();
  });
  ipcMain.handle("login:clearSecurityHold", async () => {
    return activeRunController ? coordinator.getState() : coordinator.clearSecurityHold();
  });

  ipcMain.handle(
    "run:start",
    async (_event, workspacePath: string, speed: TypingSpeedName, maxPosts?: number | null) => {
      if (activeRunController) {
        return { stopped: true, message: "Run already in progress" };
      }

      const automation = coordinator.requireReadyAutomation();
      activeRunController = new AbortController();
      const runController = activeRunController;
      let reachedRunPosts = false;
      let coordinatorCleanupStarted = false;
      const closeCoordinator = async () => {
        if (coordinatorCleanupStarted) return;
        coordinatorCleanupStarted = true;
        await coordinator.close();
      };

      try {
        const posts = await loadPosts(workspacePath);
        if (runController.signal.aborted) {
          return { stopped: true, reason: "stopped", message: "Run stopped by user" };
        }

        reachedRunPosts = true;
        const runResult: RunResultWithOptionalReason = await runPosts(posts, automation, {
          speed,
          signal: runController.signal,
          closeEngine: false,
          onLog: (message) => {
            _event.sender.send("run:log", message);
          },
          ...(typeof maxPosts === "number" && maxPosts > 0 ? { maxPosts } : {})
        });

        if (runResult.reason === "security") {
          await coordinator.enterSecurityHold(runResult.message);
        } else if (runResult.stopped) {
          await closeCoordinator();
        }

        return runResult;
      } catch (error) {
        await closeCoordinator();
        throw error;
      } finally {
        if (!reachedRunPosts && runController.signal.aborted) {
          await closeCoordinator();
        }
        if (activeRunController === runController) {
          activeRunController = null;
        }
      }
    }
  );

  ipcMain.handle("run:stop", async () => {
    if (activeRunController) {
      activeRunController.abort();
    } else {
      await coordinator.close();
    }
    return { ok: true };
  });
}
