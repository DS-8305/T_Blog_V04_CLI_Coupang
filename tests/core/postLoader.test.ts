import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadPosts } from "../../src/core/postLoader";

describe("loadPosts", () => {
  it("loads valid post folders under posts", async () => {
    const workspace = path.resolve("tests/fixtures/valid-workspace");
    const posts = await loadPosts(workspace);

    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe("001-first-post");
    expect(posts[0].status).toBe("pending");
    expect(posts[0].parsed.title).toBe("First post title");
    expect(posts[0].parsed.errors).toEqual([]);
  });

  it("loads Mato-style direct post folders with a single txt file", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-mato-style-"));
    const postFolder = path.join(workspace, "001-direct-post");
    await fs.mkdir(postFolder, { recursive: true });
    await fs.writeFile(
      path.join(postFolder, "direct-post.txt"),
      "[TITLE]Direct title[/TITLE]\n\nDirect body",
      "utf8"
    );

    const posts = await loadPosts(workspace);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      id: "001-direct-post",
      folderPath: postFolder,
      contentPath: path.join(postFolder, "direct-post.txt"),
      status: "pending"
    });
    expect(posts[0].parsed.title).toBe("Direct title");
  });

  it("loads the manual stability suite as six valid posts", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-stability-suite-"));
    for (const id of [
      "001-session-reuse",
      "002-marker-coverage",
      "003-sequential-draft",
      "004-quote2-only",
      "005-quote2-image-flow",
      "006-title-body-focus"
    ]) {
      const postFolder = path.join(workspace, id);
      await fs.mkdir(path.join(postFolder, "images"), { recursive: true });
      await fs.writeFile(
        path.join(postFolder, "content.txt"),
        [
          `[TITLE]${id}[/TITLE]`,
          "",
          "Normal paragraph.",
          "",
          "[QUOTE]Quote sentence.[/QUOTE]",
          "",
          "[HR]",
          "",
          "[IMAGE:images/hero.png]"
        ].join("\n"),
        "utf8"
      );
      await fs.writeFile(path.join(postFolder, "images", "hero.png"), "image", "utf8");
    }

    const posts = await loadPosts(workspace);

    expect(posts.map((post) => post.id)).toEqual([
      "001-session-reuse",
      "002-marker-coverage",
      "003-sequential-draft",
      "004-quote2-only",
      "005-quote2-image-flow",
      "006-title-body-focus"
    ]);
    expect(posts.every((post) => post.status === "pending")).toBe(true);
  });

  it("skips Mato-style folders that already have a success marker", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-mato-done-"));
    const doneFolder = path.join(workspace, "001-done");
    const pendingFolder = path.join(workspace, "002-pending");
    await fs.mkdir(doneFolder, { recursive: true });
    await fs.mkdir(pendingFolder, { recursive: true });
    await fs.writeFile(path.join(doneFolder, "_SUCCESS.done"), "", "utf8");
    await fs.writeFile(path.join(doneFolder, "done.txt"), "[TITLE]Done[/TITLE]\n\nDone", "utf8");
    await fs.writeFile(path.join(pendingFolder, "pending.txt"), "[TITLE]Pending[/TITLE]\n\nPending", "utf8");

    const posts = await loadPosts(workspace);

    expect(posts.map((post) => post.id)).toEqual(["002-pending"]);
  });

  it("marks posts with parser errors as validation_error", async () => {
    const workspace = path.resolve("tests/fixtures/invalid-workspace");
    const posts = await loadPosts(workspace);

    expect(posts).toHaveLength(1);
    expect(posts[0].status).toBe("validation_error");
    expect(posts[0].parsed.errors[0].code).toBe("missing_title");
  });

  it("marks missing content files as validation_error without stopping other posts", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-missing-content-"));
    await fs.mkdir(path.join(workspace, "posts", "001-missing"), { recursive: true });
    await fs.mkdir(path.join(workspace, "posts", "002-valid", "images"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, "posts", "002-valid", "content.txt"),
      "[TITLE]Valid[/TITLE]\n\nBody",
      "utf8"
    );

    const posts = await loadPosts(workspace);

    expect(posts.map((post) => post.id)).toEqual(["001-missing", "002-valid"]);
    expect(posts[0].status).toBe("validation_error");
    expect(posts[0].parsed.errors).toContainEqual({
      code: "missing_content",
      message: "content.txt does not exist or cannot be read."
    });
    expect(posts[1].status).toBe("pending");
  });

  it("returns an empty list when posts folder does not exist", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-no-posts-"));
    await expect(loadPosts(workspace)).resolves.toEqual([]);
  });

  it("throws when posts path exists but is not a directory", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-bad-posts-"));
    await fs.writeFile(path.join(workspace, "posts"), "not a directory", "utf8");
    await expect(loadPosts(workspace)).rejects.toThrow();
  });

  it("marks missing, non-file, and escaping images as validation errors", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-image-errors-"));
    const postFolder = path.join(workspace, "posts", "001-images");
    await fs.mkdir(path.join(postFolder, "images", "directory.png"), { recursive: true });
    await fs.writeFile(
      path.join(postFolder, "content.txt"),
      [
        "[TITLE]Images[/TITLE]",
        "",
        "[IMAGE:images/missing.png]",
        "[IMAGE:images/directory.png]",
        "[IMAGE:../outside.png]"
      ].join("\n"),
      "utf8"
    );

    const posts = await loadPosts(workspace);

    expect(posts[0].status).toBe("validation_error");
    expect(posts[0].parsed.errors).toEqual(
      expect.arrayContaining([
        {
          code: "missing_image",
          message: "Image file does not exist: images/missing.png"
        },
        {
          code: "invalid_image",
          message: "Image path is not a file: images/directory.png"
        },
        {
          code: "invalid_image_path",
          message: "Image path must stay inside the post folder: ../outside.png"
        }
      ])
    );
  });

  it("rejects symlinked images that resolve outside the post folder", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-symlink-image-"));
    const postFolder = path.join(workspace, "posts", "001-symlink");
    const outsideFolder = path.join(workspace, "outside");
    await fs.mkdir(path.join(postFolder, "images"), { recursive: true });
    await fs.mkdir(outsideFolder, { recursive: true });
    await fs.writeFile(path.join(outsideFolder, "outside.png"), "fake image", "utf8");
    try {
      await fs.symlink(path.join(outsideFolder, "outside.png"), path.join(postFolder, "images", "hero.png"));
    } catch (error) {
      if (isNodeError(error) && (error.code === "EPERM" || error.code === "EACCES")) {
        return;
      }
      throw error;
    }
    await fs.writeFile(
      path.join(postFolder, "content.txt"),
      "[TITLE]Symlink[/TITLE]\n\n[IMAGE:images/hero.png]",
      "utf8"
    );

    const posts = await loadPosts(workspace);

    expect(posts[0].status).toBe("validation_error");
    expect(posts[0].parsed.errors).toContainEqual({
      code: "invalid_image_path",
      message: "Image path must stay inside the post folder: images/hero.png"
    });
  });
});

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
