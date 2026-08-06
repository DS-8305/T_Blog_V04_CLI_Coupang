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
  it("uses the live TinyMCE toolbar attributes for 제목1 and divider controls", () => {
    expect(tistorySelectors.formatMenu[0]).toBe("[aria-label='문단모양']");
    expect(tistorySelectors.divider[0]).toBe("[aria-label='구분선']");
  });

  it("finds the body inside Tistory's editor iframe", async () => {
    const actions: string[] = [];
    const page = createIframeEditorPage(actions);
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, { type: "typeText", text: "iframe 본문" }, speed);

    expect(actions).toEqual([
      "press:iframe-body:Control+End",
      "type:iframe 본문",
      "press:Enter",
      "press:Enter"
    ]);
  });

  it("enters an H2 block through Tistory's 제목1 format control", async () => {
    const actions: string[] = [];
    const page = createEditorPage(actions);
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, { type: "typeHeading1", text: "첫 소제목" }, speed);

    expect(actions).toEqual([
      `press-on:${tistorySelectors.body[0]}:Control+End`,
      `click:${tistorySelectors.formatMenu[0]}`,
      `click:${tistorySelectors.heading1[0]}`,
      "press:Control+B",
      "type:첫 소제목",
      "press:Control+B",
      "press:Enter"
    ]);
  });

  it("selects Tistory divider style1 after opening the divider menu", async () => {
    const actions: string[] = [];
    const page = createEditorPage(actions);
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, { type: "insertDivider" }, speed);

    expect(actions).toContain("click:[role='menuitem']:has-text('구분선 style1')");
  });

  it("opens 첨부 then 사진 and assigns the image through the file chooser once", async () => {
    const actions: string[] = [];
    const page = createEditorPage(actions);
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, {
      type: "insertImage",
      relativePath: "images/hero.png",
      absolutePath: "C:\\post\\images\\hero.png"
    }, speed);

    expect(actions).toContain(`click:${tistorySelectors.attach[0]}`);
    expect(actions).toContain(`click:${tistorySelectors.photoMenuItem[0]}`);
    expect(actions).toContain("choose:C:\\post\\images\\hero.png");
    expect(actions.filter((action) => action.startsWith("choose:"))).toHaveLength(1);
    expect(actions).toContain("wait:image:0");
  });

  it("uses a visible TinyMCE attachment control when a hidden duplicate comes first", async () => {
    const actions: string[] = [];
    const page = createDuplicateAttachPage(actions);
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, {
      type: "insertImage",
      relativePath: "images/hero.png",
      absolutePath: "C:\\post\\images\\hero.png"
    }, speed);

    expect(actions).toContain("click:visible-attach");
    expect(actions).not.toContain("click:hidden-attach");
  });

  it("moves the caret after an image before entering the following body text", async () => {
    const actions: string[] = [];
    const page = createEditorPage(actions);
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, {
      type: "insertImage",
      relativePath: "images/hero.png",
      absolutePath: "C:\\post\\images\\hero.png"
    }, speed);
    await automation.executeEvent(page as never, { type: "typeText", text: "이미지 아래 본문" }, speed);

    expect(actions).toContain(`press-on:${tistorySelectors.body[0]}:Control+End`);
    expect(actions).toContain(`press-on:${tistorySelectors.body[0]}:Enter`);
    expect(actions).not.toContain(`click:${tistorySelectors.body[0]}`);
  });
});

function createDuplicateAttachPage(actions: string[]) {
  const imageCollection = {
    count: vi.fn(async () => 0),
    nth: vi.fn((index: number) => ({
      waitFor: vi.fn(async () => { actions.push(`wait:image:${index}`); })
    }))
  };
  const body = {
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => { actions.push("click:body"); }),
    press: vi.fn(async (key: string) => { actions.push(`press-on:body:${key}`); }),
    locator: vi.fn(() => imageCollection)
  };
  const hiddenAttach = {
    isVisible: vi.fn(async () => false),
    click: vi.fn(async () => { actions.push("click:hidden-attach"); })
  };
  const visibleAttach = {
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => { actions.push("click:visible-attach"); })
  };
  const photo = {
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => { actions.push("click:photo"); })
  };
  const collection = (items: Array<Record<string, unknown>>) => ({
    count: vi.fn(async () => items.length),
    first: vi.fn(() => items[0]),
    nth: vi.fn((index: number) => items[index])
  });
  return {
    frameLocator: vi.fn(() => ({ locator: vi.fn(() => collection([body])) })),
    locator: vi.fn((selector: string) => {
      if (selector === tistorySelectors.attach[0]) return collection([hiddenAttach, visibleAttach]);
      if (selector === tistorySelectors.photoMenuItem[0]) return collection([photo]);
      return collection([]);
    }),
    waitForEvent: vi.fn(async () => ({
      setFiles: vi.fn(async (value: string) => { actions.push(`choose:${value}`); })
    })),
    keyboard: { press: vi.fn(), type: vi.fn() }
  };
}

describe("TistoryBlogAutomation finalization", () => {
  it("targets Tistory's anchor-based 임시저장 action", () => {
    expect(tistorySelectors.draftButton[0]).toBe("a.action[role='button']:has-text('임시저장')");
  });

  it("confirms a draft when Tistory increments the saved-draft count", async () => {
    const page = createDraftFinalizationPage();
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");
    const job = {
      parsed: { metadata: { publication: "draft", scheduledAt: null } }
    };

    const result = await automation.finalizePost(page as never, job as never);

    expect(result).toEqual({
      outcome: "confirmed",
      status: "draft_saved",
      postUrl: "https://sample.tistory.com/manage/newpost"
    });
  });
});

function createDraftFinalizationPage() {
  let draftCount = 0;
  const locatorFor = (selector: string) => ({
    first: () => locatorFor(selector),
    nth: () => locatorFor(selector),
    count: vi.fn(async () => selector === tistorySelectors.draftButton[0] ? 1 : 0),
    isVisible: vi.fn(async () => selector === tistorySelectors.draftButton[0]),
    click: vi.fn(async () => { if (selector === tistorySelectors.draftButton[0]) draftCount += 1; }),
    getAttribute: vi.fn(async () => null),
    innerText: vi.fn(async () => String(draftCount))
  });
  return {
    locator: vi.fn((selector: string) => locatorFor(selector)),
    waitForURL: vi.fn(async () => { throw new Error("No navigation for draft save"); }),
    waitForTimeout: vi.fn(async () => undefined),
    url: vi.fn(() => "https://sample.tistory.com/manage/newpost")
  };
}

function createIframeEditorPage(actions: string[]) {
  const missingTopLevelLocator = {
    first: () => missingTopLevelLocator,
    isVisible: vi.fn(async () => false)
  };
  const iframeBodyLocator = {
    first: () => iframeBodyLocator,
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => { actions.push("click:iframe-body"); }),
    press: vi.fn(async (key: string) => { actions.push(`press:iframe-body:${key}`); })
  };
  return {
    locator: vi.fn(() => missingTopLevelLocator),
    frameLocator: vi.fn((selector: string) => ({
      locator: vi.fn(() => selector === "#editor-tistory_ifr" ? iframeBodyLocator : missingTopLevelLocator)
    })),
    keyboard: {
      type: vi.fn(async (text: string) => { actions.push(`type:${text}`); }),
      press: vi.fn(async (key: string) => { actions.push(`press:${key}`); })
    }
  };
}

function createEditorPage(actions: string[]) {
  const visible = new Set<string>([
    tistorySelectors.title[0],
    tistorySelectors.body[0],
    tistorySelectors.formatMenu[0],
    tistorySelectors.heading1[0],
    tistorySelectors.divider[0],
    tistorySelectors.dividerStyle1[0],
    tistorySelectors.attach[0],
    tistorySelectors.photoMenuItem[0]
  ]);
  const makeLocator = (selector: string) => ({
    first: () => makeLocator(selector),
    nth: () => makeLocator(selector),
    isVisible: vi.fn(async () => visible.has(selector)),
    count: vi.fn(async () => visible.has(selector) ? 1 : 0),
    click: vi.fn(async () => { actions.push(`click:${selector}`); }),
    press: vi.fn(async (key: string) => { actions.push(`press-on:${selector}:${key}`); }),
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
    frameLocator: vi.fn(() => ({
      locator: vi.fn(() => makeLocator("missing-iframe-body"))
    })),
    waitForEvent: vi.fn(async (event: string) => {
      if (event !== "filechooser") throw new Error(`Unexpected event: ${event}`);
      return { setFiles: vi.fn(async (value: string) => { actions.push(`choose:${value}`); }) };
    }),
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
