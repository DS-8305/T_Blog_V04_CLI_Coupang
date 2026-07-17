import { beforeEach, describe, expect, it, vi } from "vitest";

const playwrightMocks = vi.hoisted(() => ({
  connectOverCDP: vi.fn()
}));

vi.mock("playwright", () => ({
  chromium: { connectOverCDP: playwrightMocks.connectOverCDP }
}));

import { TistoryBlogAutomation } from "../../src/automation/TistoryBlogAutomation";
import { tistorySelectors } from "../../src/automation/tistorySelectors";
import type { TypingSpeedProfile } from "../../src/shared/types";

const speed: TypingSpeedProfile = { keyDelayMs: 1, linePauseMs: 1, blockPauseMs: 1 };

describe("TistoryBlogAutomation session verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches to existing Chrome and verifies the configured blog editor", async () => {
    const harness = createHarness({ visibleSelectors: [tistorySelectors.editorReady[0]] });
    playwrightMocks.connectOverCDP.mockResolvedValue(harness.browser);
    const automation = TistoryBlogAutomation.attach(
      "http://127.0.0.1:9222",
      "https://sample.tistory.com"
    );

    await expect(automation.verifySession()).resolves.toEqual({ ok: true });
    expect(playwrightMocks.connectOverCDP).toHaveBeenCalledWith(
      "http://127.0.0.1:9222",
      { noDefaults: true }
    );
    expect(harness.page.goto).toHaveBeenCalledWith(
      "https://sample.tistory.com/manage/newpost",
      { waitUntil: "domcontentloaded" }
    );

    await automation.close();
    expect(harness.browser.close).not.toHaveBeenCalled();
  });

  it("reports a Kakao login surface as a missing session", async () => {
    const harness = createHarness({
      finalUrl: "https://accounts.kakao.com/login/",
      visibleSelectors: [tistorySelectors.loginForm[0]]
    });
    playwrightMocks.connectOverCDP.mockResolvedValue(harness.browser);

    const result = await TistoryBlogAutomation
      .attach("http://127.0.0.1:9222", "https://sample.tistory.com")
      .verifySession();

    expect(result).toMatchObject({ ok: false, reason: "missing" });
  });

  it("gives a Tistory or Kakao security challenge priority", async () => {
    const harness = createHarness({
      visibleSelectors: [tistorySelectors.editorReady[0]],
      bodyText: "추가 보안 확인이 필요합니다 CAPTCHA"
    });
    playwrightMocks.connectOverCDP.mockResolvedValue(harness.browser);

    const result = await TistoryBlogAutomation
      .attach("http://127.0.0.1:9222", "https://sample.tistory.com")
      .verifySession();

    expect(result).toMatchObject({ ok: false, reason: "security" });
  });

  it("reports missing write permission as a profile error", async () => {
    const harness = createHarness({ bodyText: "이 블로그에 대한 권한이 없습니다" });
    playwrightMocks.connectOverCDP.mockResolvedValue(harness.browser);

    const result = await TistoryBlogAutomation
      .attach("http://127.0.0.1:9222", "https://sample.tistory.com")
      .verifySession();

    expect(result).toMatchObject({ ok: false, reason: "profile_error" });
  });
});

describe("TistoryBlogAutomation editor events", () => {
  it("enters an H2 block through Tistory's 제목1 format control", async () => {
    const actions: string[] = [];
    const page = createEditorPage(actions);
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, { type: "typeHeading1", text: "첫 소제목" }, speed);

    expect(actions).toEqual([
      `click:${tistorySelectors.body[0]}`,
      `click:${tistorySelectors.formatMenu[0]}`,
      `click:${tistorySelectors.heading1[0]}`,
      "type:첫 소제목",
      "press:Enter"
    ]);
  });

  it("uploads an image once and waits for the rendered image", async () => {
    const actions: string[] = [];
    const page = createEditorPage(actions);
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, {
      type: "insertImage",
      relativePath: "images/hero.png",
      absolutePath: "C:\\post\\images\\hero.png"
    }, speed);

    expect(actions).toContain("upload:C:\\post\\images\\hero.png");
    expect(actions.filter((action) => action.startsWith("upload:"))).toHaveLength(1);
    expect(actions).toContain("wait:image:0");
  });
});

function createEditorPage(actions: string[]) {
  const visible = new Set<string>([
    tistorySelectors.title[0],
    tistorySelectors.body[0],
    tistorySelectors.formatMenu[0],
    tistorySelectors.heading1[0],
    tistorySelectors.divider[0]
  ]);
  const makeLocator = (selector: string) => ({
    first: () => makeLocator(selector),
    isVisible: vi.fn(async () => visible.has(selector)),
    count: vi.fn(async () => selector === tistorySelectors.imageInput[0] ? 1 : 0),
    click: vi.fn(async () => { actions.push(`click:${selector}`); }),
    fill: vi.fn(async (value: string) => { actions.push(`fill:${selector}:${value}`); }),
    setInputFiles: vi.fn(async (value: string) => { actions.push(`upload:${value}`); }),
    locator: vi.fn((child: string) => ({
      count: vi.fn(async () => 0),
      nth: vi.fn((index: number) => ({
        waitFor: vi.fn(async () => { actions.push(`wait:${child === "img" ? "image" : child}:${index}`); })
      }))
    }))
  });
  return {
    locator: vi.fn((selector: string) => makeLocator(selector)),
    keyboard: {
      type: vi.fn(async (text: string) => { actions.push(`type:${text}`); }),
      press: vi.fn(async (key: string) => { actions.push(`press:${key}`); })
    }
  };
}

function createHarness(options: {
  finalUrl?: string;
  visibleSelectors?: string[];
  bodyText?: string;
} = {}) {
  let currentUrl = "about:blank";
  const visible = new Set(options.visibleSelectors ?? []);
  const page = {
    isClosed: vi.fn(() => false),
    url: vi.fn(() => currentUrl),
    goto: vi.fn(async (url: string) => {
      currentUrl = options.finalUrl ?? url;
    }),
    locator: vi.fn((selector: string) => ({
      first: () => ({
        isVisible: vi.fn(async () => visible.has(selector)),
        innerText: vi.fn(async () => selector === "body" ? options.bodyText ?? "" : "")
      })
    }))
  };
  const context = {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page)
  };
  const browser = {
    contexts: vi.fn(() => [context]),
    close: vi.fn(async () => undefined)
  };
  return { browser, context, page };
}
