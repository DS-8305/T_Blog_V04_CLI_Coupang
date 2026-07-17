import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseContent } from "../../src/core/parser";

const postFolder = path.resolve("tests/fixtures/valid-workspace/posts/001-first-post");

describe("parseContent", () => {
  it("parses Tistory metadata and supported editor events", () => {
    const input = `[TITLE]First post title[/TITLE]
[PUBLISH]scheduled[/PUBLISH]
[CATEGORY]여행[/CATEGORY]
[TAGS]서울, 맛집,  주말여행  [/TAGS]
[SCHEDULE]2026-07-20 09:00[/SCHEDULE]

Normal paragraph text.

[BOLD]Bold sentence.[/BOLD]

[H2]첫 번째 소제목[/H2]

[HR]

[IMAGE:images/hero.png]

Text after image.`;

    const result = parseContent(input, postFolder, new Date("2026-07-17T00:00:00+09:00"));

    expect(result.errors).toEqual([]);
    expect(result.title).toBe("First post title");
    expect(result.metadata).toEqual({
      publication: "scheduled",
      category: "여행",
      tags: ["서울", "맛집", "주말여행"],
      scheduledAt: "2026-07-20T09:00:00+09:00"
    });
    expect(result.events).toEqual([
      { type: "setTitle", text: "First post title" },
      { type: "typeText", text: "Normal paragraph text." },
      { type: "typeBold", text: "Bold sentence." },
      { type: "typeHeading1", text: "첫 번째 소제목" },
      { type: "insertDivider" },
      {
        type: "insertImage",
        relativePath: "images/hero.png",
        absolutePath: path.join(postFolder, "images/hero.png")
      },
      { type: "typeText", text: "Text after image." }
    ]);
  });

  it("defaults publication metadata to a draft", () => {
    const result = parseContent("[TITLE]A[/TITLE]\nBody", postFolder);

    expect(result.metadata).toEqual({
      publication: "draft",
      category: null,
      tags: [],
      scheduledAt: null
    });
  });

  it("requires a schedule for scheduled publication", () => {
    const result = parseContent("[TITLE]A[/TITLE]\n[PUBLISH]scheduled[/PUBLISH]\nBody", postFolder);

    expect(result.errors).toContainEqual({
      code: "missing_schedule",
      message: "Scheduled posts require [SCHEDULE]YYYY-MM-DD HH:mm[/SCHEDULE]."
    });
  });

  it("rejects a past scheduled publication time in Asia/Seoul", () => {
    const result = parseContent(
      "[TITLE]A[/TITLE]\n[PUBLISH]scheduled[/PUBLISH]\n[SCHEDULE]2026-07-16 09:00[/SCHEDULE]",
      postFolder,
      new Date("2026-07-17T00:00:00+09:00")
    );

    expect(result.errors).toContainEqual({
      code: "past_schedule",
      message: "Scheduled publication time must be in the future."
    });
  });

  it("rejects schedule metadata for a non-scheduled post", () => {
    const result = parseContent(
      "[TITLE]A[/TITLE]\n[PUBLISH]public[/PUBLISH]\n[SCHEDULE]2026-07-20 09:00[/SCHEDULE]",
      postFolder
    );

    expect(result.errors).toContainEqual({
      code: "unexpected_schedule",
      message: "[SCHEDULE] is only valid when [PUBLISH] is scheduled."
    });
  });

  it("rejects QUOTE with H2 migration guidance", () => {
    const result = parseContent("[TITLE]A[/TITLE]\n[QUOTE]old subtitle[/QUOTE]", postFolder);

    expect(result.errors).toContainEqual({
      code: "unsupported_quote",
      message: "[QUOTE] is not supported. Replace it with [H2]...[/H2]."
    });
  });

  it("reports missing title", () => {
    const result = parseContent("Body only", postFolder);
    expect(result.errors).toContainEqual({
      code: "missing_title",
      message: "content.txt must include [TITLE]...[/TITLE]."
    });
  });

  it("reports unsupported tags", () => {
    const result = parseContent("[TITLE]A[/TITLE]\n[COLOR:red]bad[/COLOR]", postFolder);
    expect(result.errors).toEqual([
      {
      code: "unsupported_tag",
      message: "Unsupported tag: COLOR"
      }
    ]);
  });

  it("reports malformed supported markers", () => {
    const result = parseContent("[TITLE]A[/TITLE]\n[IMAGE]\n[IMAGE:]\n[IMAGE:   ]\n[image:hero.png]\n[Bold]text[/Bold]\n[BOLD:]bad[/BOLD:]", postFolder);
    expect(result.errors).toEqual([
      {
        code: "malformed_tag",
        message: "Malformed tag: [IMAGE]"
      },
      {
        code: "malformed_tag",
        message: "Malformed tag: [IMAGE:]"
      },
      {
        code: "malformed_tag",
        message: "Malformed tag: [IMAGE:   ]"
      },
      {
        code: "unsupported_tag",
        message: "Unsupported tag: image"
      },
      {
        code: "unsupported_tag",
        message: "Unsupported tag: Bold"
      },
      {
        code: "malformed_tag",
        message: "Malformed tag: [BOLD:]"
      },
      {
        code: "malformed_tag",
        message: "Malformed tag: [/BOLD:]"
      }
    ]);
  });

  it("reports malformed closing markers", () => {
    const result = parseContent("[TITLE]A[/TITLE]\nText[/bold][/Bold][/IMAGE]", postFolder);
    expect(result.errors).toEqual([
      {
        code: "unsupported_tag",
        message: "Unsupported tag: bold"
      },
      {
        code: "unsupported_tag",
        message: "Unsupported tag: Bold"
      },
      {
        code: "malformed_tag",
        message: "Malformed tag: [/IMAGE]"
      }
    ]);
  });

  it("reports unclosed paired tags", () => {
    const result = parseContent("[TITLE]A[/TITLE]\n[BOLD]open", postFolder);
    expect(result.errors).toContainEqual({
      code: "unclosed_tag",
      message: "Missing closing tag: [/BOLD]"
    });
  });

  it("reports unmatched paired closing tags", () => {
    const result = parseContent("[TITLE]A[/TITLE]\nText[/BOLD]\n[H2]heading[/BOLD]\n[/TITLE]", postFolder);
    expect(result.errors).toEqual([
      {
        code: "unmatched_closing_tag",
        message: "Unexpected closing tag: [/BOLD]"
      },
      {
        code: "unmatched_closing_tag",
        message: "Unexpected closing tag: [/BOLD]"
      },
      {
        code: "unmatched_closing_tag",
        message: "Unexpected closing tag: [/TITLE]"
      },
      {
        code: "unclosed_tag",
        message: "Missing closing tag: [/H2]"
      }
    ]);
  });

  it("normalizes repeated CRLF line breaks in plain text", () => {
    const result = parseContent("[TITLE]A[/TITLE]\r\nFirst\r\n\r\n\r\nSecond", postFolder);
    expect(result.events).toContainEqual({ type: "typeText", text: "First\n\nSecond" });
  });
});
