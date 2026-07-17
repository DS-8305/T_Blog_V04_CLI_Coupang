import type { PostJob, SessionVerificationResult, TypingSpeedName } from "../shared/types";

export type AutomationRunOptions = {
  speed: TypingSpeedName;
  signal?: AbortSignal;
  onLog?: (message: string) => void;
};

export type AutomationFailureReason = "missing_session" | "security" | "profile_error" | "editor";

export type AutomationResult =
  | { ok: true }
  | { ok: false; retryable: boolean; reason: AutomationFailureReason; message: string };

export interface AutomationEngine {
  verifySession(): Promise<SessionVerificationResult>;
  saveDraft(job: PostJob, options: AutomationRunOptions): Promise<AutomationResult>;
  close(): Promise<void>;
}
