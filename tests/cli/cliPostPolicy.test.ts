import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyCliDraftPolicy } from "../../src/cli/cliPostPolicy";
import { loadPosts } from "../../src/core/postLoader";
import type { PostJob, PostStatus } from "../../src/shared/types";

describe("applyCliDraftPolicy", () => {
  it("accepts only the five CLI markers and forces draft metadata", async () => {
    const job = await createJob([
      "[TITLE]A[/TITLE]",
      "[H2]Heading[/H2]",
      "[BOLD]Important[/BOLD]",
      "[HR]",
      "[IMAGE:images/a.png]"
    ].join("\n"), "pending", {
      publication: "public",
      category: "old",
      tags: ["old"],
      scheduledAt: "2026-08-02T10:00:00+09:00"
    });

    const [result] = await applyCliDraftPolicy([job]);

    expect(result.status).toBe("pending");
    expect(result.parsed.errors).toEqual([]);
    expect(result.parsed.metadata).toEqual({
      publication: "draft",
      category: null,
      tags: [],
      scheduledAt: null
    });
    expect(job.parsed.metadata.publication).toBe("public");
  });

  it("enables the Coupang widgets for every CLI draft job", async () => {
    const job = await createJob("[TITLE]A[/TITLE]\n[H2]First[/H2]\n[H2]Second[/H2]");

    const [result] = await applyCliDraftPolicy([job]);

    expect(result.injectCoupangWidgets).toBe(true);
  });

  it("rejects every desktop-only marker once per marker name", async () => {
    const job = await createJob([
      "[TITLE]A[/TITLE]",
      "[PUBLISH]draft[/PUBLISH]",
      "[PUBLISH]public[/PUBLISH]",
      "[CATEGORY]News[/CATEGORY]",
      "[TAGS]one,two[/TAGS]",
      "[SCHEDULE]2026-08-02 10:00[/SCHEDULE]",
      "[QUOTE]Old subtitle[/QUOTE]"
    ].join("\n"));

    const [result] = await applyCliDraftPolicy([job]);

    expect(result.status).toBe("validation_error");
    expect(result.parsed.errors).toEqual([
      cliMarkerError("PUBLISH"),
      cliMarkerError("CATEGORY"),
      cliMarkerError("TAGS"),
      cliMarkerError("SCHEDULE"),
      cliMarkerError("QUOTE")
    ]);
  });

  it("rejects marker-looking syntax outside the exact five-marker allowlist", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "tistory-cli-allowlist-"));
    const postFolder = path.join(workspace, "001-invalid-markers");
    await fs.mkdir(postFolder, { recursive: true });
    await fs.writeFile(path.join(postFolder, "content.txt"), [
      "[TITLE]A[/TITLE]",
      "[H3]Not allowed[/H3]",
      "[ H4]Also not allowed[/ H4]",
      "[IMAGE :images/a.png]"
    ].join("\n"), "utf8");

    const [result] = await applyCliDraftPolicy(await loadPosts(workspace));

    expect(result.status).toBe("validation_error");
    expect(result.parsed.errors).toEqual(expect.arrayContaining([
      cliMarkerError("H3"),
      cliMarkerError("H4"),
      cliMarkerError("IMAGE")
    ]));
  });

  it("fails closed when the source content cannot be reread", async () => {
    const job = await createJob("[TITLE]A[/TITLE]\nBody");
    await fs.rm(job.contentPath);

    await expect(applyCliDraftPolicy([job])).rejects.toThrow();
  });

  it("preserves existing parser errors without mutating the original job", async () => {
    const job = await createJob("[TITLE]A[/TITLE]\n[PUBLISH]draft[/PUBLISH]");
    job.parsed.errors.push({ code: "existing", message: "Existing parser error" });

    const [result] = await applyCliDraftPolicy([job]);

    expect(result.parsed.errors).toEqual([
      { code: "existing", message: "Existing parser error" },
      cliMarkerError("PUBLISH")
    ]);
    expect(job.parsed.errors).toEqual([{ code: "existing", message: "Existing parser error" }]);
  });

  it("preserves needs_review when allowed content adds no validation error", async () => {
    const job = await createJob("[TITLE]A[/TITLE]\nBody", "needs_review");

    const [result] = await applyCliDraftPolicy([job]);

    expect(result.status).toBe("needs_review");
    expect(result.parsed.errors).toEqual([]);
  });
});

function cliMarkerError(tag: string) {
  return {
    code: "cli_unsupported_marker",
    message: `Tistory draft CLI does not allow [${tag}] markers.`
  };
}

async function createJob(
  content: string,
  status: PostStatus = "pending",
  metadata: PostJob["parsed"]["metadata"] = {
    publication: "draft",
    category: null,
    tags: [],
    scheduledAt: null
  }
): Promise<PostJob> {
  const folderPath = await fs.mkdtemp(path.join(os.tmpdir(), "tistory-cli-policy-"));
  const contentPath = path.join(folderPath, "content.txt");
  await fs.writeFile(contentPath, content, "utf8");
  return {
    id: path.basename(folderPath),
    folderPath,
    contentPath,
    status,
    parsed: {
      title: "A",
      metadata,
      events: [],
      errors: []
    }
  };
}
