import fs from "node:fs/promises";
import type { PostJob, ValidationError } from "../shared/types";

const forbiddenMarkers = new Set(["PUBLISH", "CATEGORY", "TAGS", "SCHEDULE", "QUOTE"]);

export async function applyCliDraftPolicy(jobs: PostJob[]): Promise<PostJob[]> {
  return Promise.all(jobs.map(async (job) => {
    const content = await fs.readFile(job.contentPath, "utf8").catch(() => "");
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
  for (const match of content.matchAll(/\[(?:\/)?([A-Za-z]+)(?::[^\]]*)?\]/g)) {
    const tag = match[1];
    if (forbiddenMarkers.has(tag)) found.add(tag);
  }

  return [...found].map((tag) => ({
    code: "cli_unsupported_marker",
    message: `Tistory draft CLI does not allow [${tag}] markers.`
  }));
}
