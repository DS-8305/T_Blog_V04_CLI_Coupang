import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeTistoryBlogUrl,
  readBlogConfig,
  writeBlogConfig
} from "../../src/core/blogConfig";

describe("blogConfig", () => {
  it("normalizes one Tistory root URL to HTTPS", () => {
    expect(normalizeTistoryBlogUrl(" sample.tistory.com/ ")).toBe("https://sample.tistory.com");
    expect(normalizeTistoryBlogUrl("https://TISTORY.com/")).toBe("https://tistory.com");
  });

  it.each([
    "http://sample.tistory.com",
    "https://example.com",
    "https://user:secret@sample.tistory.com",
    "https://sample.tistory.com/manage",
    "https://sample.tistory.com?mode=write",
    "https://sample.tistory.com#fragment"
  ])("rejects unsafe or non-root URL %s", (value) => {
    expect(() => normalizeTistoryBlogUrl(value)).toThrow();
  });

  it("persists and reads a normalized blog URL", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "blog-config-"));
    const configPath = path.join(folder, "blog-config.json");

    await writeBlogConfig(configPath, { blogUrl: "sample.tistory.com" });

    await expect(readBlogConfig(configPath)).resolves.toEqual({
      blogUrl: "https://sample.tistory.com"
    });
    await expect(fs.readdir(folder)).resolves.toEqual(["blog-config.json"]);
  });

  it("returns null for a missing or invalid configuration", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "blog-config-invalid-"));
    const configPath = path.join(folder, "blog-config.json");
    await expect(readBlogConfig(configPath)).resolves.toBeNull();
    await fs.writeFile(configPath, "{not-json", "utf8");
    await expect(readBlogConfig(configPath)).resolves.toBeNull();
  });
});
