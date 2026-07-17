import path from "node:path";
import type { EditorEvent, ParsedPost, PostMetadata, PublicationMode, ValidationError } from "../shared/types";

const pairedTags = ["TITLE", "PUBLISH", "CATEGORY", "TAGS", "SCHEDULE", "BOLD", "H2", "QUOTE"] as const;
const supportedTags = new Set(["TITLE", "PUBLISH", "CATEGORY", "TAGS", "SCHEDULE", "BOLD", "H2", "QUOTE", "HR", "IMAGE"]);
const metadataTags = ["TITLE", "PUBLISH", "CATEGORY", "TAGS", "SCHEDULE"] as const;
const publicationModes = new Set<PublicationMode>(["draft", "public", "scheduled"]);

export function parseContent(content: string, postFolder: string, now = new Date()): ParsedPost {
  const errors: ValidationError[] = [];
  const events: EditorEvent[] = [];
  const title = readPairedValue(content, "TITLE") ?? "";

  if (!title) {
    errors.push({
      code: "missing_title",
      message: "content.txt must include [TITLE]...[/TITLE]."
    });
  }

  errors.push(...validatePairedTags(content));

  if (/\[\/?QUOTE\]/.test(content)) {
    errors.push({
      code: "unsupported_quote",
      message: "[QUOTE] is not supported. Replace it with [H2]...[/H2]."
    });
  }

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

  const metadata = parseMetadata(content, now, errors);
  const body = removeMetadata(content).trim();
  const tokenPattern = /\[BOLD\]([\s\S]*?)\[\/BOLD\]|\[H2\]([\s\S]*?)\[\/H2\]|\[HR\]|\[IMAGE:([^\]]+)\]/g;
  let cursor = 0;

  for (const match of body.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    pushTextEvent(events, body.slice(cursor, index));

    if (match[1] !== undefined) {
      events.push({ type: "typeBold", text: match[1].trim() });
    } else if (match[2] !== undefined) {
      events.push({ type: "typeHeading1", text: match[2].trim() });
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
  return { title, metadata, events, errors };
}

function parseMetadata(content: string, now: Date, errors: ValidationError[]): PostMetadata {
  const publicationValue = readPairedValue(content, "PUBLISH");
  let publication: PublicationMode = "draft";
  if (publicationValue) {
    if (publicationModes.has(publicationValue as PublicationMode)) {
      publication = publicationValue as PublicationMode;
    } else {
      errors.push({
        code: "invalid_publication",
        message: "[PUBLISH] must be draft, public, or scheduled."
      });
    }
  }

  const category = readPairedValue(content, "CATEGORY") || null;
  const tags = (readPairedValue(content, "TAGS") ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const scheduleValue = readPairedValue(content, "SCHEDULE");
  let scheduledAt: string | null = null;

  if (publication === "scheduled") {
    if (!scheduleValue) {
      errors.push({
        code: "missing_schedule",
        message: "Scheduled posts require [SCHEDULE]YYYY-MM-DD HH:mm[/SCHEDULE]."
      });
    } else {
      scheduledAt = normalizeSchedule(scheduleValue);
      if (!scheduledAt) {
        errors.push({
          code: "invalid_schedule",
          message: "[SCHEDULE] must use a valid YYYY-MM-DD HH:mm time in Asia/Seoul."
        });
      } else if (new Date(scheduledAt).getTime() <= now.getTime()) {
        errors.push({
          code: "past_schedule",
          message: "Scheduled publication time must be in the future."
        });
      }
    }
  } else if (scheduleValue) {
    errors.push({
      code: "unexpected_schedule",
      message: "[SCHEDULE] is only valid when [PUBLISH] is scheduled."
    });
  }

  return { publication, category, tags, scheduledAt };
}

function normalizeSchedule(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:00+09:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (values.year !== year || values.month !== month || values.day !== day || values.hour !== hour || values.minute !== minute) {
    return null;
  }
  return normalized;
}

function readPairedValue(content: string, tag: (typeof pairedTags)[number]): string | null {
  const match = content.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  return match?.[1].trim() ?? null;
}

function removeMetadata(content: string): string {
  let body = content;
  for (const tag of metadataTags) {
    body = body.replace(new RegExp(`\\[${tag}\\][\\s\\S]*?\\[\\/${tag}\\]`, "g"), "");
  }
  return body;
}

function pushTextEvent(events: EditorEvent[], text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized) {
    events.push({ type: "typeText", text: normalized });
  }
}

function isMalformedSupportedTag(tag: string, rawTag: string): boolean {
  if (pairedTags.includes(tag as (typeof pairedTags)[number])) {
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

  for (const match of content.matchAll(/\[(\/)?(TITLE|PUBLISH|CATEGORY|TAGS|SCHEDULE|BOLD|H2|QUOTE)\]/g)) {
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
