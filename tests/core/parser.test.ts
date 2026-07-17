import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseContent } from "../../src/core/parser";

const postFolder = path.resolve("tests/fixtures/valid-workspace/posts/001-first-post");

describe("parseContent", () => {
  it("parses title and supported editor events", () => {
    const input = `[TITLE]First post title[/TITLE]

Normal paragraph text.

[BOLD]Bold sentence.[/BOLD]

[QUOTE]
Quoted text.
Multiple lines are allowed.
[/QUOTE]

[HR]

[IMAGE:images/hero.png]

Text after image.`;

    const result = parseContent(input, postFolder);

    expect(result.errors).toEqual([]);
    expect(result.title).toBe("First post title");
    expect(result.events).toEqual([
      { type: "setTitle", text: "First post title" },
      { type: "typeText", text: "Normal paragraph text." },
      { type: "typeBold", text: "Bold sentence." },
      { type: "insertQuote", text: "Quoted text.\nMultiple lines are allowed." },
      { type: "insertDivider" },
      {
        type: "insertImage",
        relativePath: "images/hero.png",
        absolutePath: path.join(postFolder, "images/hero.png")
      },
      { type: "typeText", text: "Text after image." }
    ]);
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
    const result = parseContent("[TITLE]A[/TITLE]\nText[/BOLD]\n[QUOTE]quote[/BOLD]\n[/TITLE]", postFolder);
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
        message: "Missing closing tag: [/QUOTE]"
      }
    ]);
  });

  it("normalizes repeated CRLF line breaks in plain text", () => {
    const result = parseContent("[TITLE]A[/TITLE]\r\nFirst\r\n\r\n\r\nSecond", postFolder);
    expect(result.events).toContainEqual({ type: "typeText", text: "First\n\nSecond" });
  });
});
