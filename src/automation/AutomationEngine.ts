import type { PostJob, PostStatus, SessionVerificationResult, TypingSpeedName } from "../shared/types";

export type AutomationRunOptions = {
  speed: TypingSpeedName;
  signal?: AbortSignal;
  onLog?: (message: string) => void;
};

export type AutomationFailureReason = "missing_session" | "security" | "profile_error" | "editor";

export type ConfirmedPostStatus = Extract<PostStatus, "draft_saved" | "published" | "scheduled">;

export type AutomationResult =
  | { outcome: "confirmed"; status: ConfirmedPostStatus; postUrl?: string }
  | { outcome: "uncertain"; message: string }
  | { outcome: "failed"; retryable: boolean; reason: AutomationFailureReason; message: string };

export interface AutomationEngine {
  verifySession(): Promise<SessionVerificationResult>;
  saveDraft(job: PostJob, options: AutomationRunOptions): Promise<AutomationResult>;
  close(): Promise<void>;
}
