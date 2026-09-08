import fs from "node:fs/promises";
import path from "node:path";
import { parseContent } from "./parser";
import { readPostStatus } from "./statusStore";
import { readSheetSource } from '../sheets/sheetSource';
import type { PostJob, PostStatus, ValidationError } from "../shared/types";

const terminalStatuses = new Set<PostStatus>(["draft_saved", "published", "scheduled"]);

export async function loadPosts(workspacePath: string): Promise<PostJob[]> {
  const postsRoot = await resolvePostsRoot(workspacePath);
  const entries = await readPostRoot(postsRoot);
  const folderNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const jobs: PostJob[] = [];

  for (const id of folderNames) {
    const folderPath = path.join(postsRoot, id);
    if (await hasSuccessMarker(folderPath)) continue;
    const persistedStatus = await readPostStatus(folderPath);
    if (persistedStatus && terminalStatuses.has(persistedStatus.status)) continue;

    const isProfile = (await readSheetSource(folderPath))?.version === 2;
    const contentPath = isProfile ? path.join(folderPath,'content.txt') : await resolveContentPath(folderPath);
    const content = await readContent(contentPath);
    if (content === null) {
      jobs.push({
        id,
        folderPath,
        contentPath,
        parsed: {
          title: "",
          metadata: {
            publication: "draft",
            category: null,
            tags: [],
            scheduledAt: null
          },
          events: [],
          errors: [
            {
              code: "missing_content",
              message: "content.txt does not exist or cannot be read."
            }
          ]
        },
        status: "validation_error"
      });
      continue;
    }

    const parsed = parseContent(content, folderPath);
    if (!isProfile) parsed.errors.push(...validateGenerationContract(content));
    const imageErrors = await validateImages(parsed.events, folderPath);
    parsed.errors.push(...imageErrors);

    jobs.push({
      id,
      folderPath,
      contentPath,
      parsed,
      status: parsed.errors.length > 0
        ? "validation_error"
        : persistedStatus?.status === "needs_review" ? "needs_review" : "pending"
    });
  }

  return jobs;
}

function validateGenerationContract(content: string): ValidationError[] {
  const headings = [...content.matchAll(/\[H2\]([\s\S]*?)\[\/H2\]/g)];
  const imageCount = [...content.matchAll(/\[IMAGE:[^\]]+\]/g)].length;
  if (headings.length < 4 || imageCount < 4) return [];
  const body = content
    .replace(/참고한 공식 자료:[\s\S]*$/m, "")
    .replace(/\[TITLE\][\s\S]*?\[\/TITLE\]/g, "")
    .replace(/\[H2\]([\s\S]*?)\[\/H2\]/g, "$1")
    .replace(/\[(?:BOLD|HR|IMAGE)(?::[^\]]+)?\]/g, "")
    .replace(/\[\/BOLD\]/g, "")
    .trim();
  if (body.length >= 1800 && body.length <= 2000) return [];
  return [{ code: "invalid_body_length", message: `Body must be 1,800-2,000 characters excluding title, markers, and sources; received ${body.length}.` }];
}

async function resolvePostsRoot(workspacePath: string): Promise<string> {
  const nestedPostsRoot = path.join(workspacePath, "posts");
  try {
    const stat = await fs.stat(nestedPostsRoot);
    if (!stat.isDirectory()) return nestedPostsRoot;
    return nestedPostsRoot;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return workspacePath;
    }
    throw error;
  }
}

async function readPostRoot(postsRoot: string) {
  try {
    return await fs.readdir(postsRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function hasSuccessMarker(folderPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(folderPath, "_SUCCESS.done"));
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveContentPath(folderPath: string): Promise<string> {
  const preferredPath = path.join(folderPath, "content.txt");
  try {
    const stat = await fs.stat(preferredPath);
    if (stat.isFile()) return preferredPath;
  } catch {
    // Fall through to Mato-style arbitrary txt filenames.
  }

  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const txtFile = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "ko"))[0];

  return txtFile ? path.join(folderPath, txtFile) : preferredPath;
}

async function readContent(contentPath: string): Promise<string | null> {
  try {
    return await fs.readFile(contentPath, "utf8");
  } catch {
    return null;
  }
}

async function validateImages(events: PostJob["parsed"]["events"], postFolder: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const postRoot = path.resolve(postFolder);
  const realPostRoot = await fs.realpath(postRoot);

  for (const event of events) {
    if (event.type !== "insertImage") continue;

    const imagePath = path.resolve(event.absolutePath);
    if (!isWithinPostFolder(postRoot, imagePath)) {
      errors.push({
        code: "invalid_image_path",
        message: `Image path must stay inside the post folder: ${event.relativePath}`
      });
      continue;
    }

    try {
      const realImagePath = await fs.realpath(imagePath);
      if (!isWithinPostFolder(realPostRoot, realImagePath)) {
        errors.push({
          code: "invalid_image_path",
          message: `Image path must stay inside the post folder: ${event.relativePath}`
        });
        continue;
      }

      const stat = await fs.stat(imagePath);
      if (!stat.isFile()) {
        errors.push({
          code: "invalid_image",
          message: `Image path is not a file: ${event.relativePath}`
        });
      }
    } catch {
      errors.push({
        code: "missing_image",
        message: `Image file does not exist: ${event.relativePath}`
      });
    }
  }
  return errors;
}

function isWithinPostFolder(postRoot: string, candidate: string): boolean {
  const relative = path.relative(postRoot, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
