import { describe, expect, it } from "vitest";
import fs from "node:fs";
import config from "../../vite.config";

describe("Vite configuration", () => {
  it("uses relative asset paths for Electron file loading", () => {
    expect(config.base).toBe("./");
  });

  it("uses Tistory product metadata and visible shell branding", () => {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const html = fs.readFileSync("index.html", "utf8");
    const app = fs.readFileSync("src/renderer/App.tsx", "utf8");

    expect(packageJson.name).toBe("tistory-blog-auto-v01");
    expect(packageJson.description).toContain("Tistory Blog");
    expect(packageJson.build.appId).toBe("com.ds8305.tistoryblogv01");
    expect(packageJson.build.productName).toBe("Tistory Blog Automation");
    expect(html).toContain("<title>Tistory Blog Automation</title>");
    expect(app).toContain("<h1>Tistory Blog Automation</h1>");
  });
});
