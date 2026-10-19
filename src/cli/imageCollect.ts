import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageCollectArgs } from "./imageCollectArgs";

export type CollectedImageRecord = {
  index: number;
  relativePath: string;
  marker: string;
  engine: string;
  width: number;
  height: number;
  byteSize: number;
  contentHash: string;
  sourceUrl: string;
  downloadedUrl: string;
  licenseUrl: string;
  title: string;
  downloadKind: string;
};

export type ImageCollectionManifest = {
  version: 1;
  keyword: string;
  engine: string;
  collectedAt: string;
  images: CollectedImageRecord[];
};

export type PythonCollectorInvocation = {
  pythonExecutable: string;
  collectorRoot: string;
  args: string[];
  outputRoot: string;
  onLog?: (message: string) => void;
};

export type ImageCollectDependencies = {
  runPythonCollector?: (invocation: PythonCollectorInvocation) => Promise<{ exitCode: number; stderr: string }>;
  resolvePython?: (explicitPython?: string, collectorRoot?: string) => Promise<string>;
  resolveCollectorRoot?: () => Promise<string>;
  now?: () => Date;
  onLog?: (message: string) => void;
};

type RawImageCollectorRecord = {
  status?: string;
  file_name?: string;
  engine?: string;
  width?: number;
  height?: number;
  byte_size?: number;
  content_hash?: string;
  source_url?: string;
  downloaded_url?: string;
  license_url?: string;
  title?: string;
  download_kind?: string;
};

type RawImageCollectorJob = {
  keyword?: string;
  engine?: string;
  folder?: string;
  status?: string;
  error?: string;
  records?: RawImageCollectorRecord[];
};

type RawImageCollectorRun = {
  schema_version?: number;
  run_id?: string;
  status?: string;
  jobs?: Record<string, RawImageCollectorJob>;
};

export async function collectPostImages(
  options: ImageCollectArgs,
  deps: ImageCollectDependencies = {}
): Promise<ImageCollectionManifest> {
  if (!path.isAbsolute(options.postPath)) {
    throw new Error("--post must be an absolute path");
  }
  const postRoot = path.resolve(options.postPath);
  await fs.mkdir(postRoot, { recursive: true });

  if (options.remapOnly) {
    return remapCollectedImagesToContentMarkers(postRoot);
  }

  const keyword = await resolvePostSearchKeyword(postRoot, options.keyword);
  const markerPaths = await extractPostImageMarkers(postRoot);
  const explicitPaths = normalizeExplicitImageNames(postRoot, options.names);

  const requiredCount = markerPaths.length > 0
    ? markerPaths.length
    : explicitPaths.length > 0
      ? explicitPaths.length
      : 0;

  const targetCount = options.limit ?? (requiredCount > 0 ? requiredCount : 4);
  if (markerPaths.length > 0 && targetCount < markerPaths.length) {
    throw new Error(
      `Requested --limit (${targetCount}) is smaller than the ${markerPaths.length} [IMAGE:...] markers in content.txt.`
    );
  }
  if (explicitPaths.length > 0 && options.limit !== undefined && targetCount < explicitPaths.length) {
    throw new Error(
      `Requested --limit (${targetCount}) is smaller than the ${explicitPaths.length} --names entries.`
    );
  }

  const targetRelativePaths = buildTargetRelativePaths(postRoot, markerPaths, explicitPaths, targetCount);
  const collectorRoot = await (deps.resolveCollectorRoot ?? resolveDefaultCollectorRoot)();
  const pythonExecutable = await (deps.resolvePython ?? resolveDefaultPythonExecutable)(options.pythonPath, collectorRoot);
  const tempOutputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tistory-image-collector-"));

  try {
    const cliArgs = buildPythonCollectorArgs(options, keyword, targetCount, tempOutputRoot);
    const runCollector = deps.runPythonCollector ?? runDefaultPythonCollector;
    const { exitCode, stderr } = await runCollector({
      pythonExecutable,
      collectorRoot,
      args: cliArgs,
      outputRoot: tempOutputRoot,
      onLog: deps.onLog
    });

    const run = await readCollectorRunOutput(tempOutputRoot);
    if (!run) {
      const detail = stderr.trim() || `ImageCollector exited with code ${exitCode}`;
      throw new Error(`Image collection failed before creating a run manifest: ${detail}`);
    }

    const savedItems = collectSavedImagesFromRun(run.runDir, run.data);
    if (savedItems.length < markerPaths.length) {
      const jobErrors = collectJobErrors(run.data);
      throw new Error(
        `Collected ${savedItems.length} image(s), but content.txt requires ${markerPaths.length} [IMAGE:...] file(s).` +
        (jobErrors ? ` (${jobErrors})` : "")
      );
    }

    if (savedItems.length === 0 || (savedItems.length < targetCount && !options.allowPartial)) {
      const jobErrors = collectJobErrors(run.data) || stderr.trim() || `status=${run.data.status ?? "unknown"}`;
      throw new Error(
        `Collected ${savedItems.length}/${targetCount} image(s) for "${keyword}": ${jobErrors}`
      );
    }

    const selectedItems = savedItems.slice(0, targetRelativePaths.length);
    const images: CollectedImageRecord[] = [];

    for (let index = 0; index < selectedItems.length; index += 1) {
      const item = selectedItems[index]!;
      const relativePath = targetRelativePaths[index]!;
      const destinationPath = path.resolve(postRoot, relativePath);
      assertWithinPostFolder(postRoot, destinationPath, relativePath);

      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(item.filePath, destinationPath);

      const normalizedRelative = toPosixRelativePath(postRoot, destinationPath);
      images.push({
        index: index + 1,
        relativePath: normalizedRelative,
        marker: `[IMAGE:${normalizedRelative}]`,
        engine: item.record.engine ?? options.engine,
        width: item.record.width ?? 0,
        height: item.record.height ?? 0,
        byteSize: item.record.byte_size ?? 0,
        contentHash: item.record.content_hash ?? "",
        sourceUrl: item.record.source_url ?? "",
        downloadedUrl: item.record.downloaded_url ?? "",
        licenseUrl: item.record.license_url ?? "",
        title: item.record.title ?? "",
        downloadKind: item.record.download_kind ?? ""
      });
    }

    const manifest: ImageCollectionManifest = {
      version: 1,
      keyword,
      engine: options.engine,
      collectedAt: (deps.now ?? (() => new Date()))().toISOString(),
      images
    };

    await writeImageCollectionManifests(postRoot, manifest);
    return manifest;
  } finally {
    await fs.rm(tempOutputRoot, { recursive: true, force: true });
  }
}

export async function remapCollectedImagesToContentMarkers(
  postFolder: string,
  contentOverride?: string
): Promise<ImageCollectionManifest> {
  const postRoot = path.resolve(postFolder);
  const manifestPath = path.join(postRoot, "image-collection.json");
  let manifest: ImageCollectionManifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ImageCollectionManifest;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`No image-collection.json found in ${postRoot}. Run image:collect first.`);
    }
    throw error;
  }

  const markerPaths = contentOverride !== undefined
    ? extractImageMarkersFromContent(contentOverride, postRoot)
    : await extractPostImageMarkers(postRoot);

  if (markerPaths.length === 0) {
    return manifest;
  }
  if (manifest.images.length < markerPaths.length) {
    throw new Error(
      `Collected images (${manifest.images.length}) are fewer than the ${markerPaths.length} [IMAGE:...] markers in content.txt.`
    );
  }

  const updatedImages: CollectedImageRecord[] = [];
  for (let index = 0; index < manifest.images.length; index += 1) {
    const existing = manifest.images[index]!;
    const sourcePath = path.resolve(postRoot, existing.relativePath);
    assertWithinPostFolder(postRoot, sourcePath, existing.relativePath);

    const targetRelative = markerPaths[index] ?? existing.relativePath;
    const targetPath = path.resolve(postRoot, targetRelative);
    assertWithinPostFolder(postRoot, targetPath, targetRelative);

    if (sourcePath !== targetPath) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }

    const normalizedRelative = toPosixRelativePath(postRoot, targetPath);
    updatedImages.push({
      ...existing,
      index: index + 1,
      relativePath: normalizedRelative,
      marker: `[IMAGE:${normalizedRelative}]`
    });
  }

  const updatedManifest: ImageCollectionManifest = {
    ...manifest,
    images: updatedImages
  };
  await writeImageCollectionManifests(postRoot, updatedManifest);
  return updatedManifest;
}

export async function resolvePostSearchKeyword(
  postFolder: string,
  explicitKeyword?: string
): Promise<string> {
  if (explicitKeyword?.trim()) {
    return explicitKeyword.trim();
  }

  for (const filename of ["profile-task.json", "connector-source.json", "sheet-source.json"]) {
    const candidatePath = path.join(postFolder, filename);
    try {
      const parsed = JSON.parse(await fs.readFile(candidatePath, "utf8")) as {
        keyword?: unknown;
        searchKey?: unknown;
        name?: unknown;
        row?: { searchKey?: unknown; name?: unknown; keyword?: unknown };
      };
      const candidates = [
        parsed.row?.searchKey,
        parsed.searchKey,
        parsed.keyword,
        parsed.row?.keyword,
        parsed.row?.name,
        parsed.name
      ];
      for (const value of candidates) {
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }

  throw new Error(
    "Provide --keyword or run image:collect on a post folder containing profile-task.json, connector-source.json, or sheet-source.json."
  );
}

export async function extractPostImageMarkers(postFolder: string): Promise<string[]> {
  const contentPath = path.join(postFolder, "content.txt");
  try {
    const content = await fs.readFile(contentPath, "utf8");
    return extractImageMarkersFromContent(content, postFolder);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function extractImageMarkersFromContent(content: string, postFolder: string): string[] {
  const postRoot = path.resolve(postFolder);
  const seen = new Set<string>();
  const markers: string[] = [];

  for (const match of content.matchAll(/\[IMAGE:([^\]]+)\]/g)) {
    const rawRelative = match[1]?.trim() ?? "";
    if (!rawRelative) {
      throw new Error(`Malformed image marker: ${match[0]}`);
    }
    const resolved = path.resolve(postRoot, rawRelative);
    assertWithinPostFolder(postRoot, resolved, rawRelative);
    const normalized = toPosixRelativePath(postRoot, resolved);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      markers.push(normalized);
    }
  }

  return markers;
}

function normalizeExplicitImageNames(postRoot: string, names?: string[]): string[] {
  if (!names || names.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of names) {
    const trimmed = raw.trim();
    const withFolder = trimmed.includes("/") || trimmed.includes("\\")
      ? trimmed
      : path.posix.join("images", trimmed);
    const withExtension = withFolder.toLowerCase().endsWith(".png")
      ? withFolder
      : `${withFolder}.png`;
    const resolved = path.resolve(postRoot, withExtension);
    assertWithinPostFolder(postRoot, resolved, raw);
    const normalized = toPosixRelativePath(postRoot, resolved);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function buildTargetRelativePaths(
  postRoot: string,
  markerPaths: string[],
  explicitPaths: string[],
  targetCount: number
): string[] {
  const seed = markerPaths.length > 0 ? markerPaths : explicitPaths;
  const targets = [...seed];
  const used = new Set(targets.map((item) => item.toLowerCase()));
  let sequence = 1;

  while (targets.length < targetCount) {
    const candidate = `images/${String(sequence).padStart(2, "0")}-image.png`;
    sequence += 1;
    const resolved = path.resolve(postRoot, candidate);
    assertWithinPostFolder(postRoot, resolved, candidate);
    const normalized = toPosixRelativePath(postRoot, resolved);
    if (!used.has(normalized.toLowerCase())) {
      used.add(normalized.toLowerCase());
      targets.push(normalized);
    }
  }

  return targets;
}

function buildPythonCollectorArgs(
  options: ImageCollectArgs,
  keyword: string,
  limit: number,
  outputRoot: string
): string[] {
  const args = [
    "-m",
    "image_collector",
    "--keyword",
    keyword,
    "--engine",
    options.engine,
    "--limit",
    String(limit),
    "--output-dir",
    outputRoot,
    "--backend",
    options.backend
  ];

  if (options.downloadMode) {
    args.push("--download-mode", options.downloadMode);
  }
  if (options.profile) {
    args.push("--profile", options.profile);
  }
  if (options.minWidth !== undefined) {
    args.push("--min-width", String(options.minWidth));
  }
  if (options.minHeight !== undefined) {
    args.push("--min-height", String(options.minHeight));
  }
  if (options.minLongEdge !== undefined) {
    args.push("--min-long-edge", String(options.minLongEdge));
  }
  if (options.showBrowser) {
    args.push("--show-browser");
  } else if (options.headless) {
    args.push("--headless");
  }
  if (options.period) {
    args.push("--period", options.period);
  }
  if (options.usageRights) {
    args.push("--usage-rights", options.usageRights);
  }

  return args;
}

async function resolveDefaultCollectorRoot(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDirectory, ".."),
    path.resolve(moduleDirectory, "../..")
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(path.join(candidate, "image_collector", "__init__.py"));
      if (stat.isFile()) return candidate;
    } catch {
      // Check next candidate layout.
    }
  }

  throw new Error("Could not locate image_collector Python package in repository root.");
}

async function resolveDefaultPythonExecutable(
  explicitPython: string | undefined,
  collectorRoot: string
): Promise<string> {
  if (explicitPython?.trim()) return explicitPython.trim();
  if (process.env.IMAGE_COLLECTOR_PYTHON?.trim()) {
    return process.env.IMAGE_COLLECTOR_PYTHON.trim();
  }

  const venvCandidates = process.platform === "win32"
    ? [path.join(collectorRoot, ".venv", "Scripts", "python.exe")]
    : [path.join(collectorRoot, ".venv", "bin", "python")];

  for (const candidate of venvCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Fall back to system Python on PATH.
    }
  }

  return "python";
}

async function runDefaultPythonCollector(
  invocation: PythonCollectorInvocation
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.pythonExecutable, invocation.args, {
      cwd: invocation.collectorRoot,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let stdoutBuffer = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) invocation.onLog?.(line.trim());
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to launch Python (${invocation.pythonExecutable}): ${error.message}`));
    });

    child.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        invocation.onLog?.(stdoutBuffer.trim());
      }
      resolve({ exitCode: code ?? 1, stderr });
    });
  });
}

async function readCollectorRunOutput(
  outputRoot: string
): Promise<{ runDir: string; data: RawImageCollectorRun } | null> {
  let entries;
  try {
    entries = await fs.readdir(outputRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const runFolders = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run_"))
    .map((entry) => entry.name)
    .sort();

  const latestRun = runFolders.at(-1);
  if (!latestRun) return null;

  const runDir = path.join(outputRoot, latestRun);
  try {
    const raw = await fs.readFile(path.join(runDir, "run.json"), "utf8");
    return { runDir, data: JSON.parse(raw) as RawImageCollectorRun };
  } catch {
    return null;
  }
}

function collectSavedImagesFromRun(
  runDir: string,
  runData: RawImageCollectorRun
): Array<{ filePath: string; record: RawImageCollectorRecord }> {
  const results: Array<{ filePath: string; record: RawImageCollectorRecord }> = [];
  const jobs = Object.values(runData.jobs ?? {});

  for (const job of jobs) {
    const jobFolder = job.folder ?? "";
    for (const record of job.records ?? []) {
      if (record.status !== "saved" || !record.file_name) continue;
      results.push({
        filePath: path.join(runDir, jobFolder, record.file_name),
        record: {
          ...record,
          engine: record.engine ?? job.engine
        }
      });
    }
  }

  return results;
}

function collectJobErrors(runData: RawImageCollectorRun): string {
  const messages: string[] = [];
  for (const job of Object.values(runData.jobs ?? {})) {
    if (job.error?.trim()) {
      messages.push(`${job.engine ?? "engine"}: ${job.error.trim()}`);
    }
  }
  return messages.join("; ");
}

async function writeImageCollectionManifests(
  postRoot: string,
  manifest: ImageCollectionManifest
): Promise<void> {
  const imagesDir = path.join(postRoot, "images");
  await fs.mkdir(imagesDir, { recursive: true });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  await fs.writeFile(path.join(postRoot, "image-collection.json"), serialized, "utf8");
  await fs.writeFile(path.join(imagesDir, "metadata.json"), serialized, "utf8");
}

export function assertWithinPostFolder(postRoot: string, candidatePath: string, label: string): void {
  const relative = path.relative(postRoot, candidatePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Image path must stay inside the post folder: ${label}`);
  }
}

function toPosixRelativePath(postRoot: string, targetPath: string): string {
  return path.relative(postRoot, targetPath).split(path.sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
