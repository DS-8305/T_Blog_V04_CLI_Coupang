import fs from "node:fs/promises";
import type { PostJob, ValidationError } from "../shared/types";

const allowedPairedMarkers = new Set(["TITLE", "H2", "BOLD"]);

export async function applyCliDraftPolicy(jobs: PostJob[]): Promise<PostJob[]> {
  return Promise.all(jobs.map(async (job) => {
    const content = await fs.readFile(job.contentPath, "utf8");
    const errors = [
      ...job.parsed.errors,
      ...findForbiddenMarkerErrors(content)
    ];

    return {
      ...job,
      status: errors.length > 0 ? "validation_error" as const : job.status,
      parsed: {
        ...job.parsed,
        metadata: {
          publication: "draft" as const,
          category: null,
          tags: [],
          scheduledAt: null
        },
        errors
      }
    };
  }));
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
