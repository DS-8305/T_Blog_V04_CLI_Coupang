import type { TypingSpeedName, TypingSpeedProfile } from "../shared/types";

const profiles: Record<TypingSpeedName, TypingSpeedProfile> = {
  fast: { keyDelayMs: 20, linePauseMs: 120, blockPauseMs: 260 },
  normal: { keyDelayMs: 45, linePauseMs: 220, blockPauseMs: 450 },
  slow: { keyDelayMs: 85, linePauseMs: 420, blockPauseMs: 800 }
};

export function getTypingSpeedProfile(name: TypingSpeedName): TypingSpeedProfile {
  const profile = profiles[name];
  if (!profile) {
    throw new Error(`Unknown typing speed: ${String(name)}`);
  }
  return profile;
}
