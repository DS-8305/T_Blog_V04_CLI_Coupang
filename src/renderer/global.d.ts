import type { LoginActionResult, LoginStateSnapshot, PostJob, TypingSpeedName } from "../shared/types";

declare global {
  interface Window {
    electronAPI?: {
      selectWorkspace(): Promise<string | null>;
      loadPosts(workspacePath: string): Promise<PostJob[]>;
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
