import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseImageCollectArgs } from "../../src/cli/imageCollectArgs";

const samplePostPath = path.resolve("/tmp/blog-workspace/posts/001-first-post");

describe("parseImageCollectArgs", () => {
  it("defaults to google engine and browser backend", () => {
    const parsed = parseImageCollectArgs(["--", "--post", samplePostPath, "--keyword", "한승택"]);

    expect(parsed).toEqual({
      postPath: samplePostPath,
      keyword: "한승택",
      engine: "google",
      backend: "browser",
      allowPartial: false,
      remapOnly: false
    });
  });

  it("parses explicit engine, limit, download-mode, profile, size overrides, names, and flags", () => {
    const parsed = parseImageCollectArgs([
      "--post",
      samplePostPath,
      "--keyword",
      "서울 한강",
      "--engine",
      "google",
      "--limit",
      "3",
      "--download-mode",
      "original-preferred",
      "--profile",
      "blog",
      "--min-width",
      "800",
      "--min-height",
      "600",
      "--min-long-edge",
      "1200",
      "--period",
      "month",
      "--usage-rights",
      "creative-commons",
      "--names",
      "01-overview.png, 02-detail",
      "--show-browser",
      "--allow-partial"
    ]);

    expect(parsed).toMatchObject({
      postPath: samplePostPath,
      keyword: "서울 한강",
      engine: "google",
      limit: 3,
      downloadMode: "original-preferred",
      profile: "blog",
      minWidth: 800,
      minHeight: 600,
      minLongEdge: 1200,
      period: "month",
      usageRights: "creative-commons",
      names: ["01-overview.png", "02-detail"],
      showBrowser: true,
      allowPartial: true
    });
  });

  it("rejects relative --post paths, conflicting browser flags, and unsupported naver original mode", () => {
    expect(() => parseImageCollectArgs(["--post", "relative/post"])).toThrow(/absolute path/);
    expect(() =>
      parseImageCollectArgs(["--post", samplePostPath, "--show-browser", "--headless"])
    ).toThrow(/cannot be used together/);
    expect(() =>
      parseImageCollectArgs([
        "--post",
        samplePostPath,
        "--engine",
        "naver",
        "--download-mode",
        "original-only"
      ])
    ).toThrow(/Naver engine only supports --download-mode thumbnail/);
  });
});
