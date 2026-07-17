import fs from "node:fs/promises";
import path from "node:path";

export type BlogConfig = {
  blogUrl: string;
};

export function normalizeTistoryBlogUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Tistory blog URL is required.");
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Enter a valid Tistory blog URL.");
  }

  const hostname = url.hostname.toLowerCase();
  const isTistory = hostname === "tistory.com" || hostname.endsWith(".tistory.com");
  if (url.protocol !== "https:" || !isTistory) {
    throw new Error("Only HTTPS tistory.com blog URLs are allowed.");
  }
  if (url.username || url.password || url.port || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error("Enter only the root Tistory blog URL without credentials, path, query, or fragment.");
  }
  return `https://${hostname}`;
}

export async function readBlogConfig(configPath: string): Promise<BlogConfig | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as Partial<BlogConfig>;
    if (typeof parsed.blogUrl !== "string") return null;
    return { blogUrl: normalizeTistoryBlogUrl(parsed.blogUrl) };
  } catch {
    return null;
  }
}

export async function writeBlogConfig(configPath: string, config: BlogConfig): Promise<void> {
  const normalized: BlogConfig = { blogUrl: normalizeTistoryBlogUrl(config.blogUrl) };
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, configPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
