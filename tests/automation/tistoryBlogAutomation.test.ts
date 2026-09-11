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
    expect(playwrightMocks.connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:9222");
    expect(harness.page.goto).toHaveBeenCalledWith(
      "https://sample.tistory.com/manage/newpost",
      { waitUntil: "domcontentloaded" }
    );

    await automation.close();
    expect(harness.browser.close).toHaveBeenCalledOnce();
    await automation.close();
    expect(harness.browser.close).toHaveBeenCalledOnce();
  });

  it("reuses the editor opened by verification when saving a draft", async () => {
    const harness = createHarness({
      visibleSelectors: [tistorySelectors.editorReady[0], tistorySelectors.body[0]]
    });
    playwrightMocks.connectOverCDP.mockResolvedValue(harness.browser);
    const automation = TistoryBlogAutomation.attach(
      "http://127.0.0.1:9222",
      "https://sample.tistory.com"
    );
    vi.spyOn(automation, "finalizePost").mockResolvedValue({
      outcome: "confirmed",
      status: "draft_saved"
    });

    await expect(automation.verifySession()).resolves.toEqual({ ok: true });
    await expect(automation.saveDraft({
      id: "001-post",
      folderPath: "C:\\post",
      contentPath: "C:\\post\\content.txt",
      status: "pending",
      parsed: {
        title: "새 글",
        metadata: { publication: "draft", category: null, tags: [], scheduledAt: null },
        events: [],
        errors: []
      }
    }, { speed: "fast" })).resolves.toMatchObject({ outcome: "confirmed" });

    expect(harness.page.goto).toHaveBeenCalledTimes(1);
  });

  it("absorbs a dialog race when another Chrome client handles beforeunload first", async () => {
    const harness = createHarness({ visibleSelectors: [tistorySelectors.editorReady[0]] });
    playwrightMocks.connectOverCDP.mockResolvedValue(harness.browser);
    const automation = TistoryBlogAutomation.attach(
      "http://127.0.0.1:9222",
      "https://sample.tistory.com"
    );

    await expect(automation.verifySession()).resolves.toEqual({ ok: true });
    expect(harness.dialogHandlers).toHaveLength(1);

    const accept = vi.fn(async () => {
      throw new Error("No dialog is showing");
    });
    await expect(harness.dialogHandlers[0]({
      type: () => "beforeunload",
      accept,
      dismiss: vi.fn(async () => undefined)
    })).resolves.toBeUndefined();
  });

  it("waits for the iframe body when it appears after the title field", async () => {
    const harness = createHarness({
      visibleSelectors: [tistorySelectors.editorReady[0]],
      bodyVisibleAfterChecks: 5
    });
    playwrightMocks.connectOverCDP.mockResolvedValue(harness.browser);
    const automation = TistoryBlogAutomation.attach(
      "http://127.0.0.1:9222",
      "https://sample.tistory.com"
    );
    vi.spyOn(automation, "finalizePost").mockResolvedValue({
      outcome: "confirmed",
      status: "draft_saved"
    });

    await expect(automation.verifySession()).resolves.toEqual({ ok: true });
    await expect(automation.saveDraft({
      id: "001-post",
      folderPath: "C:\\post",
      contentPath: "C:\\post\\content.txt",
      status: "pending",
      parsed: {
        title: "새 글",
        metadata: { publication: "draft", category: null, tags: [], scheduledAt: null },
        events: [],
        errors: []
      }
    }, { speed: "fast" })).resolves.toMatchObject({ outcome: "confirmed" });
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
    expect(tistorySelectors.formatMenu[0]).toBe("[aria-label='문단모양'] button");
    expect(tistorySelectors.divider[0]).toBe("[aria-label='구분선'] button");
    expect(tistorySelectors.attach[0]).toBe("#mceu_0-open");
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

  it("enters an H2 block through Tistory's moving 제목1 format control", async () => {
    const actions: string[] = [];
    const page = createEditorPage(actions);
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, { type: "typeHeading1", text: "첫 소제목" }, speed);

    expect(actions).toEqual([
      `press-on:${tistorySelectors.body[0]}:Control+End`,
      `dispatch:click:${tistorySelectors.formatMenu[0]}`,
      "wait:300",
      `click:${tistorySelectors.heading1[0]}:force`,
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

    expect(actions).toContain("dispatch:click:[aria-label='구분선'] button");
    expect(actions).toContain("wait:300");
    expect(actions).toContain(`click:${tistorySelectors.dividerStyle1[0]}:force`);
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

    expect(actions).toContain(`click:${tistorySelectors.attach[0]}:force`);
    expect(actions).toContain(`evaluate:${tistorySelectors.attach[0]}`);
    expect(actions).toContain("wait:1500");
    expect(actions).toContain("wait:300");
    expect(actions).toContain(`click:${tistorySelectors.photoMenuItem[0]}:force`);
    expect(actions).toContain("choose:C:\\post\\images\\hero.png");
    expect(actions.filter((action) => action.startsWith("choose:"))).toHaveLength(1);
    expect(actions).toContain("wait:image:0");
  });

  it("waits for a dynamically rendered photo menu item", async () => {
    const actions: string[] = [];
    const page = createEditorPage(actions, {
      delayedSelector: tistorySelectors.photoMenuItem[0],
      visibleAfterCountChecks: 3
    });
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, {
      type: "insertImage",
      relativePath: "images/hero.png",
      absolutePath: "C:\\post\\images\\hero.png"
    }, speed);

    expect(actions.filter((action) => action === "wait:100")).toHaveLength(2);
    expect(actions).toContain("choose:C:\\post\\images\\hero.png");
  });

  it("retries the attachment button when its menu does not open", async () => {
    const actions: string[] = [];
    const page = createEditorPage(actions, { photoVisibleAfterAttachClicks: 2 });
    const automation = TistoryBlogAutomation.attach("http://127.0.0.1:9222", "https://sample.tistory.com");

    await automation.executeEvent(page as never, {
      type: "insertImage",
      relativePath: "images/hero.png",
      absolutePath: "C:\\post\\images\\hero.png"
    }, speed);

    expect(actions.filter((action) => action === `click:${tistorySelectors.attach[0]}:force`)).toHaveLength(2);
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

    expect(actions).toContain("click:visible-attach:force");
    expect(actions).not.toContain("click:hidden-attach:force");
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
    evaluate: vi.fn(async () => undefined),
    click: vi.fn(async () => { actions.push("click:hidden-attach:force"); })
  };
  const visibleAttach = {
    isVisible: vi.fn(async () => true),
    evaluate: vi.fn(async () => undefined),
    click: vi.fn(async () => { actions.push("click:visible-attach:force"); })
  };
  const photo = {
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => { actions.push("click:photo:force"); })
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
    waitForTimeout: vi.fn(async () => {}),
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
    expect(page.getLastClickOptions()).toEqual({ force: true });
  });
});

function createDraftFinalizationPage() {
  let draftCount = 0;
  let lastClickOptions: { force?: boolean } | undefined;
  const locatorFor = (selector: string) => ({
    first: () => locatorFor(selector),
    nth: () => locatorFor(selector),
    count: vi.fn(async () => selector === tistorySelectors.draftButton[0] ? 1 : 0),
    isVisible: vi.fn(async () => selector === tistorySelectors.draftButton[0]),
    click: vi.fn(async (options?: { force?: boolean }) => {
      lastClickOptions = options;
      if (selector === tistorySelectors.draftButton[0]) draftCount += 1;
    }),
    getAttribute: vi.fn(async () => null),
    evaluateAll: vi.fn(async (callback: (elements: unknown[]) => unknown) => callback(
      selector === tistorySelectors.draftCount[0]
        ? [{ getAttribute: () => null, textContent: String(draftCount) }] : []
    )),
    innerText: vi.fn(async () => String(draftCount))
  });
  return {
    locator: vi.fn((selector: string) => locatorFor(selector)),
    waitForURL: vi.fn(async () => { throw new Error("No navigation for draft save"); }),
    waitForTimeout: vi.fn(async () => undefined),
    url: vi.fn(() => "https://sample.tistory.com/manage/newpost"),
    getLastClickOptions: () => lastClickOptions
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

function createEditorPage(actions: string[], options: {
  delayedSelector?: string;
  visibleAfterCountChecks?: number;
  photoVisibleAfterAttachClicks?: number;
} = {}) {
  let delayedCountChecks = 0;
  let attachClicks = 0;
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
    isVisible: vi.fn(async () => {
      if (selector === tistorySelectors.photoMenuItem[0] && options.photoVisibleAfterAttachClicks) {
        return attachClicks >= options.photoVisibleAfterAttachClicks;
      }
      return visible.has(selector);
    }),
    count: vi.fn(async () => {
      if (selector === options.delayedSelector) {
        delayedCountChecks += 1;
        return delayedCountChecks >= (options.visibleAfterCountChecks ?? 1) ? 1 : 0;
      }
      return visible.has(selector) ? 1 : 0;
    }),
    click: vi.fn(async (options?: { force?: boolean }) => {
      if (selector === tistorySelectors.attach[0]) attachClicks += 1;
      actions.push(`click:${selector}${options?.force ? ":force" : ""}`);
    }),
    evaluate: vi.fn(async () => { actions.push(`evaluate:${selector}`); }),
    dispatchEvent: vi.fn(async (event: string) => { actions.push(`dispatch:${event}:${selector}`); }),
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
    waitForTimeout: vi.fn(async (milliseconds: number) => { actions.push(`wait:${milliseconds}`); }),
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
  bodyVisibleAfterChecks?: number;
} = {}) {
  let currentUrl = "about:blank";
  const visible = new Set(options.visibleSelectors ?? []);
  let bodyVisibilityChecks = 0;
  const dialogHandlers: Array<(dialog: {
    type: () => string;
    accept: () => Promise<void>;
    dismiss: () => Promise<void>;
  }) => Promise<void>> = [];
  const page = {
    isClosed: vi.fn(() => false),
    url: vi.fn(() => currentUrl),
    goto: vi.fn(async (url: string) => {
      currentUrl = options.finalUrl ?? url;
    }),
    on: vi.fn((event: string, handler: (typeof dialogHandlers)[number]) => {
      if (event === "dialog") dialogHandlers.push(handler);
    }),
    frameLocator: vi.fn(() => ({
      locator: vi.fn((selector: string) => ({
        first: () => ({
          isVisible: vi.fn(async () => {
            if (tistorySelectors.body.includes(selector as never) && options.bodyVisibleAfterChecks !== undefined) {
              bodyVisibilityChecks += 1;
              return bodyVisibilityChecks >= options.bodyVisibleAfterChecks;
            }
            return visible.has(selector);
          }),
          press: vi.fn(async () => undefined)
        })
      }))
    })),
    waitForTimeout: vi.fn(async () => undefined),
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
  return { browser, context, page, dialogHandlers };
}
