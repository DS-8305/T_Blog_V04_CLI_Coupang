import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PostJob, ValidationError } from "../shared/types";

const allowedPairedMarkers = new Set(["TITLE", "H2", "BOLD"]);
const disclosureAssetRelativePath = "assets/cli/coupang-partners-disclosure.png";

export async function applyCliDraftPolicy(jobs: PostJob[]): Promise<PostJob[]> {
  const disclosureImagePath = await resolveDisclosureImagePath();

  return Promise.all(jobs.map(async (job) => {
    const content = await fs.readFile(job.contentPath, "utf8");
    const athleteTags = await readConnectedAthleteTags(job.folderPath);
    const errors = [
      ...job.parsed.errors,
      ...findForbiddenMarkerErrors(content)
    ];

    const titleEventIndex = job.parsed.events.findIndex((event) => event.type === "setTitle");
    const insertionIndex = titleEventIndex < 0 ? 0 : titleEventIndex + 1;
    const events = [...job.parsed.events];
    events.splice(insertionIndex, 0, {
      type: "insertImage",
      relativePath: disclosureAssetRelativePath,
      absolutePath: disclosureImagePath
    });

    return {
      ...job,
      injectCoupangWidgets: true,
      status: errors.length > 0 ? "validation_error" as const : job.status,
      parsed: {
        ...job.parsed,
        events,
        metadata: {
          publication: "draft" as const,
          category: null,
          tags: athleteTags,
          scheduledAt: null
        },
        errors
      }
    };
  }));
}

async function readConnectedAthleteTags(postFolder: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(postFolder, "connector-source.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const source = JSON.parse(raw) as {
    personId?: unknown;
    row?: { personId?: unknown; majorType?: unknown; name?: unknown };
    sourceRow?: unknown[];
  };
  const row = source.row ?? (Array.isArray(source.sourceRow) ? {
    personId: source.sourceRow[0], majorType: source.sourceRow[1], name: source.sourceRow[3]
  } : undefined);
  if (row?.majorType !== "운동선수") return [];

  const name = typeof row.name === "string" ? row.name.trim() : "";
  const personId = typeof row.personId === "string" ? row.personId.trim() : "";
  if (!name || !personId || (source.personId !== undefined && personId !== source.personId)) {
    throw new Error("Connected athlete tags require a matching connector-source.json athlete name and personId.");
  }
  return [`${name}프로필`, `${name}성적`, `${name}연봉`, `${name}나이`];
}

async function resolveDisclosureImagePath(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDirectory, "../", disclosureAssetRelativePath),
    path.resolve(moduleDirectory, "../../", disclosureAssetRelativePath)
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the source-layout path after the bundled CLI path.
    }
  }

  throw new Error(`Required CLI disclosure image is missing: ${disclosureAssetRelativePath}`);
}

function findForbiddenMarkerErrors(content: string): ValidationError[] {
  const found = new Set<string>();
  for (const match of content.matchAll(/\[([^\]\r\n]*)\]/g)) {
    const markerBody = match[1];
    const nameMatch = markerBody.trimStart().match(/^\/?\s*([A-Za-z][A-Za-z0-9]*)/);
    if (!nameMatch) continue;

    const tag = nameMatch[1];
    const rawMarker = match[0];
    if (!isAllowedMarker(tag, rawMarker)) found.add(tag);
  }

  return [...found].map((tag) => ({
    code: "cli_unsupported_marker",
    message: `Tistory draft CLI does not allow [${tag}] markers.`
  }));
}

function isAllowedMarker(tag: string, rawMarker: string): boolean {
  if (allowedPairedMarkers.has(tag)) {
    return rawMarker === `[${tag}]` || rawMarker === `[/${tag}]`;
  }
  if (tag === "HR") return rawMarker === "[HR]";
  if (tag === "IMAGE") {
    const match = rawMarker.match(/^\[IMAGE:([^\]]+)\]$/);
    return Boolean(match?.[1].trim());
  }
  return false;
}
