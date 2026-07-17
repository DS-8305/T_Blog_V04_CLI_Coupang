export type TypingSpeedName = "fast" | "normal" | "slow";

export type TypingSpeedProfile = {
  keyDelayMs: number;
  linePauseMs: number;
  blockPauseMs: number;
};

export type EditorEvent =
  | { type: "setTitle"; text: string }
  | { type: "typeText"; text: string }
  | { type: "typeBold"; text: string }
  | { type: "insertQuote"; text: string }
  | { type: "insertDivider" }
  | { type: "insertImage"; relativePath: string; absolutePath: string };

export type ValidationError = {
  code: string;
  message: string;
};

export type ParsedPost = {
  title: string;
  events: EditorEvent[];
  errors: ValidationError[];
};

export type PostStatus = "pending" | "validation_error" | "running" | "draft_saved" | "failed" | "stopped";

export type PostJob = {
  id: string;
  folderPath: string;
  contentPath: string;
  status: PostStatus;
  parsed: ParsedPost;
};

export type LoginState = "unverified" | "login_open" | "checking" | "ready" | "security_hold";

export type LoginStateSnapshot = {
  state: LoginState;
  message: string;
  manualChromeRunning: boolean;
};

export type LoginActionResult = {
  ok: boolean;
  snapshot: LoginStateSnapshot;
};

export type SessionVerificationResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "security" | "profile_error"; message: string };
