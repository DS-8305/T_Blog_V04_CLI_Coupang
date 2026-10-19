import path from "node:path";

export type ImageSearchEngine = "google" | "naver" | "both";
export type ImageDownloadMode = "original-only" | "original-preferred" | "thumbnail";
export type ImageSizeProfile = "blog" | "legacy-thumbnail" | "video-landscape" | "video-portrait" | "custom";
export type ImageBackend = "browser" | "api";
export type ImageSearchPeriod = "day" | "week" | "month" | "year";
export type ImageUsageRights = "creative-commons" | "commercial";

export type ImageCollectArgs = {
  postPath: string;
  keyword?: string;
  engine: ImageSearchEngine;
  limit?: number;
  downloadMode?: ImageDownloadMode;
  profile?: ImageSizeProfile;
  minWidth?: number;
  minHeight?: number;
  minLongEdge?: number;
  backend: ImageBackend;
  showBrowser?: boolean;
  headless?: boolean;
  period?: ImageSearchPeriod;
  usageRights?: ImageUsageRights;
  names?: string[];
  allowPartial: boolean;
  remapOnly: boolean;
  pythonPath?: string;
};

const valueOptions = new Set([
  "--post",
  "--keyword",
  "--engine",
  "--limit",
  "--download-mode",
  "--profile",
  "--min-width",
  "--min-height",
  "--min-long-edge",
  "--backend",
  "--period",
  "--usage-rights",
  "--names",
  "--python"
]);

const booleanFlags = new Set([
  "--show-browser",
  "--headless",
  "--allow-partial",
  "--remap"
]);

const validEngines = new Set<ImageSearchEngine>(["google", "naver", "both"]);
const validDownloadModes = new Set<ImageDownloadMode>(["original-only", "original-preferred", "thumbnail"]);
const validProfiles = new Set<ImageSizeProfile>(["blog", "legacy-thumbnail", "video-landscape", "video-portrait", "custom"]);
const validBackends = new Set<ImageBackend>(["browser", "api"]);
const validPeriods = new Set<ImageSearchPeriod>(["day", "week", "month", "year"]);
const validUsageRights = new Set<ImageUsageRights>(["creative-commons", "commercial"]);

export function parseImageCollectArgs(argv: string[]): ImageCollectArgs {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Invalid option: ${token ?? ""}`);
    }
    if (booleanFlags.has(token)) {
      if (flags.has(token)) throw new Error(`Duplicate option: ${token}`);
      flags.add(token);
      continue;
    }
    if (!valueOptions.has(token)) {
      throw new Error(`Unknown option: ${token}`);
    }
    if (options.has(token)) {
      throw new Error(`Duplicate option: ${token}`);
    }
    const nextValue = values[index + 1];
    if (nextValue === undefined || nextValue.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    options.set(token, nextValue);
    index += 1;
  }

  if (flags.has("--show-browser") && flags.has("--headless")) {
    throw new Error("--show-browser and --headless cannot be used together");
  }

  const postPath = options.get("--post")?.trim();
  if (!postPath) throw new Error("--post is required");
  if (!path.isAbsolute(postPath)) throw new Error("--post must be an absolute path");

  const engineRaw = (options.get("--engine")?.trim() ?? "google") as ImageSearchEngine;
  if (!validEngines.has(engineRaw)) {
    throw new Error("--engine must be google, naver, or both");
  }

  const backendRaw = (options.get("--backend")?.trim() ?? "browser") as ImageBackend;
  if (!validBackends.has(backendRaw)) {
    throw new Error("--backend must be browser or api");
  }

  const downloadModeRaw = options.get("--download-mode")?.trim() as ImageDownloadMode | undefined;
  if (downloadModeRaw !== undefined && !validDownloadModes.has(downloadModeRaw)) {
    throw new Error("--download-mode must be original-only, original-preferred, or thumbnail");
  }
  if (engineRaw === "naver" && downloadModeRaw && downloadModeRaw !== "thumbnail") {
    throw new Error("Naver engine only supports --download-mode thumbnail");
  }

  const profileRaw = options.get("--profile")?.trim() as ImageSizeProfile | undefined;
  if (profileRaw !== undefined && !validProfiles.has(profileRaw)) {
    throw new Error("--profile must be blog, legacy-thumbnail, video-landscape, video-portrait, or custom");
  }

  const periodRaw = options.get("--period")?.trim() as ImageSearchPeriod | undefined;
  if (periodRaw !== undefined && !validPeriods.has(periodRaw)) {
    throw new Error("--period must be day, week, month, or year");
  }

  const usageRightsRaw = options.get("--usage-rights")?.trim() as ImageUsageRights | undefined;
  if (usageRightsRaw !== undefined && !validUsageRights.has(usageRightsRaw)) {
    throw new Error("--usage-rights must be creative-commons or commercial");
  }

  const limit = parseOptionalInt(options.get("--limit"), "--limit", 1);
  const minWidth = parseOptionalInt(options.get("--min-width"), "--min-width", 1);
  const minHeight = parseOptionalInt(options.get("--min-height"), "--min-height", 1);
  const minLongEdge = parseOptionalInt(options.get("--min-long-edge"), "--min-long-edge", 0);

  const keywordRaw = options.get("--keyword")?.trim();
  if (options.has("--keyword") && !keywordRaw) {
    throw new Error("--keyword cannot be blank");
  }

  const namesRaw = options.get("--names");
  const names = namesRaw === undefined
    ? undefined
    : namesRaw.split(",").map((item) => item.trim()).filter(Boolean);
  if (names !== undefined && names.length === 0) {
    throw new Error("--names must include at least one image name");
  }

  const pythonPath = options.get("--python")?.trim();
  if (options.has("--python") && !pythonPath) {
    throw new Error("--python cannot be blank");
  }

  return {
    postPath,
    ...(keywordRaw ? { keyword: keywordRaw } : {}),
    engine: engineRaw,
    ...(limit !== undefined ? { limit } : {}),
    ...(downloadModeRaw ? { downloadMode: downloadModeRaw } : {}),
    ...(profileRaw ? { profile: profileRaw } : {}),
    ...(minWidth !== undefined ? { minWidth } : {}),
    ...(minHeight !== undefined ? { minHeight } : {}),
    ...(minLongEdge !== undefined ? { minLongEdge } : {}),
    backend: backendRaw,
    ...(flags.has("--show-browser") ? { showBrowser: true } : {}),
    ...(flags.has("--headless") ? { headless: true } : {}),
    ...(periodRaw ? { period: periodRaw } : {}),
    ...(usageRightsRaw ? { usageRights: usageRightsRaw } : {}),
    ...(names ? { names } : {}),
    allowPartial: flags.has("--allow-partial"),
    remapOnly: flags.has("--remap"),
    ...(pythonPath ? { pythonPath } : {})
  };
}

function parseOptionalInt(raw: string | undefined, flagName: string, minimum: number): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${flagName} must be an integer >= ${minimum}`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${flagName} must be an integer >= ${minimum}`);
  }
  return parsed;
}
