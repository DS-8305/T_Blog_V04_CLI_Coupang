import { describe, expect, it } from "vitest";
import { getTypingSpeedProfile } from "../../src/core/typingSpeed";

describe("getTypingSpeedProfile", () => {
  it("returns the normal profile by default", () => {
    expect(getTypingSpeedProfile("normal")).toEqual({
      keyDelayMs: 45,
      linePauseMs: 220,
      blockPauseMs: 450
    });
  });

  it("rejects an unknown profile name", () => {
    expect(() => getTypingSpeedProfile("turbo" as never)).toThrow("Unknown typing speed: turbo");
  });
});
