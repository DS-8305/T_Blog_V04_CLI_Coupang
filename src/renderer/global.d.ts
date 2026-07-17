import type { BlogConfig } from "../core/blogConfig";
import type { LoginActionResult, LoginStateSnapshot, PostJob, ReviewOutcome, TypingSpeedName } from "../shared/types";

declare global {
  interface Window {
    electronAPI?: {
      selectWorkspace(): Promise<string | null>;
      loadPosts(workspacePath: string): Promise<PostJob[]>;
      getBlogConfig(): Promise<BlogConfig | null>;
      saveBlogConfig(blogUrl: string): Promise<BlogConfig>;
      resolveReview(job: PostJob, outcome: ReviewOutcome): Promise<{ ok: true }>;
      getLoginState(): Promise<LoginStateSnapshot>;
      openManualLogin(): Promise<LoginActionResult>;
      verifyLogin(): Promise<LoginActionResult>;
      clearSecurityHold(): Promise<LoginStateSnapshot>;
      startRun(workspacePath: string, speed: TypingSpeedName, maxPosts?: number | null): Promise<{
        stopped: boolean;
        message: string;
        reason?: string;
      }>;
      stopRun(): Promise<{ ok: boolean }>;
      onRunLog(callback: (message: string) => void): () => void;
    };
  }
}

export {};
