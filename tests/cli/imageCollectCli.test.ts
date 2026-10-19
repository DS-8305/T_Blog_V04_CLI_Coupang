import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { imageCollectMain } from "../../src/cli/imageCollectCli";
import { collectPostImages, type PythonCollectorInvocation } from "../../src/cli/imageCollect";
import { parseImageCollectArgs } from "../../src/cli/imageCollectArgs";
import { loadPosts } from "../../src/core/postLoader";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-collect-test-"));
  tempDirs.push(dir);
  return dir;
}

function fakeCollectorRunner(count: number, engine = "google") {
  const invocations: PythonCollectorInvocation[] = [];
  const runPythonCollector = async (invocation: PythonCollectorInvocation) => {
    invocations.push(invocation);
    const runDir = path.join(invocation.outputRoot, "run_20261019T060000Z_abc123");
    const jobFolder = `kw_sample/${engine}`;
    const targetFolder = path.join(runDir, jobFolder);
    await fs.mkdir(targetFolder, { recursive: true });

    const records = [];
    for (let index = 1; index <= count; index += 1) {
      const fileName = `image_${String(index).padStart(2, "0")}.png`;
      const pngBytes = Buffer.from(`fake-png-${index}`);
      await fs.writeFile(path.join(targetFolder, fileName), pngBytes);
      records.push({
        status: "saved",
        file_name: fileName,
        engine,
        width: 1200,
        height: 800,
        byte_size: pngBytes.length,
        content_hash: `hash-${index}`,
        source_url: `https://example.org/post/${index}`,
        downloaded_url: `https://img.example.org/${index}.png`,
        license_url: "",
        title: `Sample ${index}`,
        download_kind: "original"
      });
    }

    await fs.writeFile(
      path.join(runDir, "run.json"),
      JSON.stringify({
        schema_version: 2,
        run_id: "run_20261019T060000Z_abc123",
        status: "success",
        jobs: {
          job1: {
            keyword: "테스트",
            engine,
            folder: jobFolder,
            status: "success",
            error: "",
            records
          }
        }
      }),
      "utf8"
    );

    return { exitCode: 0, stderr: "" };
  };

  return { invocations, runPythonCollector };
}

describe("image:collect CLI and mapping", () => {
  it("maps collected Google images directly to [IMAGE:...] markers in content.txt and passes postLoader validation", async () => {
    const workspace = await makeWorkspace();
    const postFolder = path.join(workspace, "posts", "001-sample-post");
    await fs.mkdir(postFolder, { recursive: true });
    await fs.writeFile(
      path.join(postFolder, "content.txt"),
      [
        "[TITLE]테스트 제목[/TITLE]",
        "도입부입니다.",
        "[HR]",
        "[H2]첫째 소제목[/H2]",
        "[IMAGE:images/01-overview.png]",
        "첫째 본문입니다.",
        "[HR]",
        "[H2]둘째 소제목[/H2]",
        "[IMAGE:images/02-details.png]",
        "둘째 본문입니다."
      ].join("\n"),
      "utf8"
    );

    const { invocations, runPythonCollector } = fakeCollectorRunner(2);
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = await imageCollectMain(
      ["--post", postFolder, "--keyword", "테스트 키워드"],
      {
        runPythonCollector,
        log: (msg) => logs.push(msg),
        error: (msg) => errors.push(msg)
      }
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(invocations[0]?.args).toContain("google");
    expect(invocations[0]?.args).toContain("2");

    expect(await fs.readFile(path.join(postFolder, "images", "01-overview.png"), "utf8")).toBe("fake-png-1");
    expect(await fs.readFile(path.join(postFolder, "images", "02-details.png"), "utf8")).toBe("fake-png-2");

    const jobs = await loadPosts(workspace);
    expect(jobs[0]?.status).toBe("pending");
    expect(jobs[0]?.parsed.errors).toEqual([]);
  });

  it("auto-resolves keyword from profile-task.json or sheet-source.json when --keyword is omitted", async () => {
    const workspace = await makeWorkspace();
    const postFolder = path.join(workspace, "posts", "000019-한승택-프로필");
    await fs.mkdir(postFolder, { recursive: true });
    await fs.writeFile(
      path.join(postFolder, "profile-task.json"),
      JSON.stringify({
        version: 1,
        personId: "SP000018",
        name: "한승택",
        searchKey: "한승택 야구선수 KIA",
        keyword: "한승택 프로필"
      }),
      "utf8"
    );

    const { invocations, runPythonCollector } = fakeCollectorRunner(2);
    const manifest = await collectPostImages(
      parseImageCollectArgs(["--post", postFolder, "--limit", "2"]),
      { runPythonCollector }
    );

    expect(manifest.keyword).toBe("한승택 야구선수 KIA");
    expect(invocations[0]?.args).toContain("한승택 야구선수 KIA");
    expect(manifest.images.map((img) => img.relativePath)).toEqual([
      "images/01-image.png",
      "images/02-image.png"
    ]);
  });

  it("supports --remap to bind previously collected images to newly written [IMAGE:...] markers", async () => {
    const workspace = await makeWorkspace();
    const postFolder = path.join(workspace, "posts", "002-remap-post");
    const { runPythonCollector } = fakeCollectorRunner(2);

    await collectPostImages(
      parseImageCollectArgs(["--post", postFolder, "--keyword", "테스트", "--limit", "2"]),
      { runPythonCollector }
    );

    await fs.writeFile(
      path.join(postFolder, "content.txt"),
      "[TITLE]제목[/TITLE]\n[HR]\n[H2]소제목1[/H2]\n[IMAGE:images/custom-first.png]\n본문\n[HR]\n[H2]소제목2[/H2]\n[IMAGE:images/custom-second.png]\n본문",
      "utf8"
    );

    const remapped = await collectPostImages(
      parseImageCollectArgs(["--post", postFolder, "--remap"]),
      {}
    );

    expect(remapped.images.map((item) => item.relativePath)).toEqual([
      "images/custom-first.png",
      "images/custom-second.png"
    ]);
    expect(await fs.readFile(path.join(postFolder, "images", "custom-first.png"), "utf8")).toBe("fake-png-1");
    expect(await fs.readFile(path.join(postFolder, "images", "custom-second.png"), "utf8")).toBe("fake-png-2");
  });

  it("rejects image markers escaping the post folder", async () => {
    const workspace = await makeWorkspace();
    const postFolder = path.join(workspace, "posts", "003-invalid-marker");
    await fs.mkdir(postFolder, { recursive: true });
    await fs.writeFile(
      path.join(postFolder, "content.txt"),
      "[TITLE]제목[/TITLE]\n[IMAGE:../outside.png]",
      "utf8"
    );

    const { runPythonCollector } = fakeCollectorRunner(1);
    await expect(
      collectPostImages(
        parseImageCollectArgs(["--post", postFolder, "--keyword", "테스트"]),
        { runPythonCollector }
      )
    ).rejects.toThrow(/must stay inside the post folder/);
  });
});
