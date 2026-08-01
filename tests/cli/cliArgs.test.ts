import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/cliArgs";

describe("parseCliArgs", () => {
  it("parses login without options", () => {
    expect(parseCliArgs(["login"])).toEqual({ command: "login" });
  });

  it("normalizes the required Tistory blog URL for verify", () => {
    expect(parseCliArgs(["verify", "--blog-url", "Sample.Tistory.com/"])).toEqual({
      command: "verify",
      blogUrl: "https://sample.tistory.com"
    });
  });

  it("requires a blog URL for verify", () => {
    expect(() => parseCliArgs(["verify"])).toThrow("--blog-url is required");
  });

  it("parses run defaults with an absolute workspace", () => {
    expect(parseCliArgs([
      "run",
      "--workspace",
      "C:\\blog-workspace",
      "--blog-url",
      "sample.tistory.com"
    ])).toEqual({
      command: "run",
      workspacePath: "C:\\blog-workspace",
      blogUrl: "https://sample.tistory.com",
      speed: "normal"
    });
  });

  it("accepts the pnpm separator, speed, and maximum post count", () => {
    expect(parseCliArgs([
      "run",
      "--",
      "--workspace",
      "C:\\blog-workspace",
      "--blog-url",
      "https://sample.tistory.com",
      "--speed",
      "slow",
      "--max-posts",
      "3"
    ])).toEqual({
      command: "run",
      workspacePath: "C:\\blog-workspace",
      blogUrl: "https://sample.tistory.com",
      speed: "slow",
      maxPosts: 3
    });
  });

  it("requires an absolute run workspace", () => {
    expect(() => parseCliArgs([
      "run",
      "--workspace",
      "relative-workspace",
      "--blog-url",
      "sample.tistory.com"
    ])).toThrow("--workspace must be an absolute path");
  });

  it.each([
    ["--speed", "instant", "--speed must be fast, normal, or slow"],
    ["--max-posts", "0", "--max-posts must be a positive integer"],
    ["--max-posts", "1.5", "--max-posts must be a positive integer"]
  ])("rejects invalid run option %s %s", (key, value, message) => {
    expect(() => parseCliArgs([
      "run",
      "--workspace",
      "C:\\blog-workspace",
      "--blog-url",
      "sample.tistory.com",
      key,
      value
    ])).toThrow(message);
  });

  it("rejects duplicate, unknown, and missing-value options", () => {
    expect(() => parseCliArgs(["verify", "--blog-url", "a.tistory.com", "--blog-url", "b.tistory.com"]))
      .toThrow("Duplicate option: --blog-url");
    expect(() => parseCliArgs(["verify", "--other", "value"])).toThrow("Unknown option: --other");
    expect(() => parseCliArgs(["verify", "--blog-url"])).toThrow("Missing value for --blog-url");
  });

  it("rejects login options and unknown commands", () => {
    expect(() => parseCliArgs(["login", "--blog-url", "sample.tistory.com"]))
      .toThrow("login does not accept options");
    expect(() => parseCliArgs(["publish"])).toThrow("Command must be login, verify, or run");
  });
});
