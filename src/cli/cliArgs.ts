import path from "node:path";
import { normalizeTistoryBlogUrl } from "../core/blogConfig";
import type { TypingSpeedName } from "../shared/types";

export type CliCommand =
  | { command: "login" }
  | { command: "verify"; blogUrl: string }
  | {
    command: "run";
    workspacePath: string;
    blogUrl: string;
    speed: TypingSpeedName;
    maxPosts?: number;
  };

export function parseCliArgs(argv: string[]): CliCommand {
  const [command, ...rawRest] = argv;
  const rest = rawRest[0] === "--" ? rawRest.slice(1) : rawRest;

  if (command === "login") {
    if (rest.length > 0) throw new Error("login does not accept options");
    return { command: "login" };
  }

  if (command !== "verify" && command !== "run") {
    throw new Error("Command must be login, verify, or run");
  }

  const allowed = command === "verify"
    ? new Set(["--blog-url"])
    : new Set(["--workspace", "--blog-url", "--speed", "--max-posts"]);
  const options = parseOptions(rest, allowed);
  const rawBlogUrl = options.get("--blog-url");
  if (!rawBlogUrl) throw new Error("--blog-url is required");
  const blogUrl = normalizeTistoryBlogUrl(rawBlogUrl);

  if (command === "verify") return { command, blogUrl };

  const workspacePath = options.get("--workspace");
  if (!workspacePath) throw new Error("--workspace is required");
  if (!path.isAbsolute(workspacePath)) throw new Error("--workspace must be an absolute path");

  const rawSpeed = options.get("--speed") ?? "normal";
  if (!isTypingSpeed(rawSpeed)) throw new Error("--speed must be fast, normal, or slow");

  const rawMaxPosts = options.get("--max-posts");
  const maxPosts = rawMaxPosts === undefined ? undefined : Number(rawMaxPosts);
  if (maxPosts !== undefined && (!Number.isInteger(maxPosts) || maxPosts <= 0)) {
    throw new Error("--max-posts must be a positive integer");
  }

  return {
    command,
    workspacePath,
    blogUrl,
    speed: rawSpeed,
    ...(maxPosts === undefined ? {} : { maxPosts })
  };
}

function parseOptions(values: string[], allowed: Set<string>): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--")) throw new Error(`Invalid option: ${key ?? ""}`);
    if (!allowed.has(key)) throw new Error(`Unknown option: ${key}`);
    if (options.has(key)) throw new Error(`Duplicate option: ${key}`);

    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options.set(key, value);
  }
  return options;
}

function isTypingSpeed(value: string): value is TypingSpeedName {
  return value === "fast" || value === "normal" || value === "slow";
}
