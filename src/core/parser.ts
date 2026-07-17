import path from "node:path";
import type { EditorEvent, ParsedPost, ValidationError } from "../shared/types";

const pairedTags = ["TITLE", "BOLD", "QUOTE"] as const;
const supportedTags = new Set(["TITLE", "BOLD", "QUOTE", "HR", "IMAGE"]);

export function parseContent(content: string, postFolder: string): ParsedPost {
  const errors: ValidationError[] = [];
  const events: EditorEvent[] = [];
  const titleMatch = content.match(/\[TITLE\]([\s\S]*?)\[\/TITLE\]/);
  const title = titleMatch?.[1].trim() ?? "";

  if (!title) {
    errors.push({
      code: "missing_title",
      message: "content.txt must include [TITLE]...[/TITLE]."
    });
  }

  errors.push(...validatePairedTags(content));

  const reportedUnsupportedTags = new Set<string>();
  const reportedMalformedTags = new Set<string>();
  for (const match of content.matchAll(/\[(\/)?([A-Za-z]+)(?::([^\]]*))?\]/g)) {
    const tag = match[2];
    const rawTag = match[0];
    if (tag !== tag.toUpperCase() && !reportedUnsupportedTags.has(tag)) {
      reportedUnsupportedTags.add(tag);
      errors.push({
        code: "unsupported_tag",
        message: `Unsupported tag: ${tag}`
      });
    } else if (!supportedTags.has(tag) && !reportedUnsupportedTags.has(tag)) {
      reportedUnsupportedTags.add(tag);
      errors.push({
        code: "unsupported_tag",
        message: `Unsupported tag: ${tag}`
      });
    } else if (isMalformedSupportedTag(tag, rawTag) && !reportedMalformedTags.has(rawTag)) {
      reportedMalformedTags.add(rawTag);
      errors.push({
        code: "malformed_tag",
        message: `Malformed tag: ${rawTag}`
      });
    }
  }

  if (title) {
    events.push({ type: "setTitle", text: title });
  }

  const body = content.replace(/\[TITLE\][\s\S]*?\[\/TITLE\]/, "").trim();
  const tokenPattern = /\[BOLD\]([\s\S]*?)\[\/BOLD\]|\[QUOTE\]([\s\S]*?)\[\/QUOTE\]|\[HR\]|\[IMAGE:([^\]]+)\]/g;
  let cursor = 0;

  for (const match of body.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    pushTextEvent(events, body.slice(cursor, index));

    if (match[1] !== undefined) {
      events.push({ type: "typeBold", text: match[1].trim() });
    } else if (match[2] !== undefined) {
      events.push({ type: "insertQuote", text: match[2].trim() });
    } else if (match[0] === "[HR]") {
      events.push({ type: "insertDivider" });
    } else if (match[3] !== undefined) {
      const relativePath = match[3].trim();
      events.push({
        type: "insertImage",
        relativePath,
        absolutePath: path.join(postFolder, relativePath)
      });
    }

    cursor = index + match[0].length;
  }

  pushTextEvent(events, body.slice(cursor));
  return { title, events, errors };
}

function pushTextEvent(events: EditorEvent[], text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized) {
    events.push({ type: "typeText", text: normalized });
  }
}

function isMalformedSupportedTag(tag: string, rawTag: string): boolean {
  if (tag === "TITLE" || tag === "BOLD" || tag === "QUOTE") {
    return rawTag !== `[${tag}]` && rawTag !== `[/${tag}]`;
  }
  if (tag === "IMAGE") {
    const match = rawTag.match(/^\[IMAGE:([^\]]+)\]$/);
    return !match || match[1].trim().length === 0;
  }
  if (tag === "HR") {
    return rawTag !== "[HR]";
  }
  return false;
}

function validatePairedTags(content: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const stack: Array<(typeof pairedTags)[number]> = [];
  const pairedTagSet = new Set<string>(pairedTags);

  for (const match of content.matchAll(/\[(\/)?(TITLE|BOLD|QUOTE)\]/g)) {
    const isClosing = Boolean(match[1]);
    const tag = match[2] as (typeof pairedTags)[number];

    if (!isClosing) {
      stack.push(tag);
      continue;
    }

    if (stack.at(-1) === tag) {
      stack.pop();
      continue;
    }

    if (pairedTagSet.has(tag)) {
      errors.push({
        code: "unmatched_closing_tag",
        message: `Unexpected closing tag: [/${tag}]`
      });
    }
  }

  for (const tag of stack.reverse()) {
    errors.push({
      code: "unclosed_tag",
      message: `Missing closing tag: [/${tag}]`
    });
  }

  return errors;
}
