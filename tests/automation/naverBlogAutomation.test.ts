import { beforeEach, describe, expect, it, vi } from "vitest";

const playwrightMocks = vi.hoisted(() => ({
  launchPersistentContext: vi.fn(),
  connectOverCDP: vi.fn()
}));

vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext: playwrightMocks.launchPersistentContext,
    connectOverCDP: playwrightMocks.connectOverCDP
  }
}));

import { browserContextOptions, NaverBlogAutomation } from "../../src/automation/NaverBlogAutomation";
import {
  NAVER_HOME_URL,
  NAVER_BLOG_WRITE_URL,
  NAVER_LOGIN_URL,
  editorSelectors,
  loginSelectors,
  loginCookieNames
} from "../../src/automation/selectors";
import type { Locator, Page } from "playwright";
import type { AutomationEngine } from "../../src/automation/AutomationEngine";
import type { PostJob } from "../../src/shared/types";

type PageEvidence = {
  hasRequiredCookies: boolean;
  authenticatedUiMatches: readonly boolean[];
  authenticatedUiTextMatches: readonly boolean[];
  loginFormMatches: readonly boolean[];
  securityChallengeMatches: readonly boolean[];
  securitySurfaceTexts: readonly string[];
  pageWideSecurityTextMatches: readonly boolean[];
};

const authenticatedEvidence: PageEvidence = {
  hasRequiredCookies: true,
  authenticatedUiMatches: [],
  authenticatedUiTextMatches: [],
  loginFormMatches: [],
  securityChallengeMatches: [],
  securitySurfaceTexts: [],
  pageWideSecurityTextMatches: []
};

const testJob: PostJob = {
  id: "post-1",
  folderPath: ".",
  contentPath: "content.txt",
  status: "pending",
  parsed: {
    title: "",
    metadata: { publication: "draft", category: null, tags: [], scheduledAt: null },
    events: [],
    errors: []
  }
};

function createBrowserHarness(options: {
  home?: PageEvidence;
  write?: PageEvidence;
  navigationError?: Error;
  cookieProbeResults?: Array<boolean | Error>;
  loginProbeError?: Error;
  closeFailures?: Error[];
} = {}) {
  const navigations: string[] = [];
  let currentUrl = "about:blank";
  let closed = false;
  const evidenceForCurrentPage = () => currentUrl === NAVER_BLOG_WRITE_URL
    ? options.write ?? authenticatedEvidence
    : options.home ?? authenticatedEvidence;

  const cookieProbeResults = [...(options.cookieProbeResults ?? [])];
  const closeFailures = [...(options.closeFailures ?? [])];
  const locatorCollection = (matches: readonly boolean[], texts: readonly string[] = [], probeError?: Error) => {
    const item = (index: number) => ({
      count: vi.fn().mockResolvedValue(index < Math.max(matches.length, texts.length) ? 1 : 0),
      isVisible: vi.fn(async () => {
        if (probeError) throw probeError;
        return matches[index] ?? false;
      }),
      textContent: vi.fn().mockResolvedValue(texts[index] ?? "")
    });
    return {
      count: vi.fn(async () => {
        if (probeError) throw probeError;
        return Math.max(matches.length, texts.length);
      }),
      nth: vi.fn((index: number) => item(index)),
      first: vi.fn(() => item(0))
    };
  };
  const getByText = vi.fn((value: string | RegExp) => {
    const evidence = evidenceForCurrentPage();
    return value === "로그아웃"
      ? locatorCollection(evidence.authenticatedUiTextMatches)
      : locatorCollection(evidence.pageWideSecurityTextMatches);
  });
  const frame = {
    locator: vi.fn((selector: string) => {
      const evidence = evidenceForCurrentPage();
      if (loginSelectors.form.includes(selector as typeof loginSelectors.form[number])) {
        return locatorCollection(evidence.loginFormMatches, [], options.loginProbeError);
      }
      if (selector.includes("로그아웃") || selector.includes("logout")) {
        return locatorCollection(evidence.authenticatedUiMatches);
      }
      if (/captcha|challenge|security/i.test(selector) && !/form\[action/i.test(selector)) {
        return locatorCollection(evidence.securityChallengeMatches);
      }
      if (/form\[action|#nidlogin/i.test(selector)) {
        return locatorCollection(
          evidence.securitySurfaceTexts.map(() => true),
          evidence.securitySurfaceTexts
        );
      }
      return locatorCollection([]);
    }),
    getByText
  };
  const page = {
    goto: vi.fn(async (url: string) => {
      if (options.navigationError) throw options.navigationError;
      currentUrl = url;
      navigations.push(url);
    }),
    url: vi.fn(() => currentUrl),
    frames: vi.fn(() => [frame]),
    getByText,
    isClosed: vi.fn(() => closed),
    setDefaultTimeout: vi.fn(),
    waitForTimeout: vi.fn().mockResolvedValue(undefined)
  };
  const context = {
    pages: vi.fn(() => [page]),
    newPage: vi.fn().mockResolvedValue(page),
    cookies: vi.fn().mockImplementation(async () => {
      const next = cookieProbeResults.length > 0
        ? cookieProbeResults.shift()
        : evidenceForCurrentPage().hasRequiredCookies;
      if (next instanceof Error) throw next;
      return next ? loginCookieNames.map((name) => ({ name, value: "present" })) : [];
    }),
    close: vi.fn(async () => {
      const failure = closeFailures.shift();
      if (failure) throw failure;
      closed = true;
    })
  };

  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    contexts: vi.fn(() => [context])
  };

  playwrightMocks.launchPersistentContext.mockResolvedValue(context);
  playwrightMocks.connectOverCDP.mockResolvedValue(browser);
  return { browser, context, navigations, page };
}

describe("NaverBlogAutomation adapter", () => {
  beforeEach(() => {
    playwrightMocks.launchPersistentContext.mockReset();
    playwrightMocks.connectOverCDP.mockReset();
  });
  it("exports the Naver blog write URL and readable editor selectors", () => {
    expect(NAVER_BLOG_WRITE_URL).toBe("https://blog.naver.com/GoBlogWrite.naver");
    expect(editorSelectors.title).toContain('textarea[placeholder*="\uC81C\uBAA9"]');
    expect(editorSelectors.body).toContain('[contenteditable="true"]');
    expect(editorSelectors.draftSave).toContain("button[data-click-area='tpb.save']");
    expect(editorSelectors.draftSaveButtonNames).toEqual(["\uC784\uC2DC\uC800\uC7A5", "\uC800\uC7A5"]);
    expect(editorSelectors.imageButtonNames).toEqual(["\uC0AC\uC9C4", "\uC774\uBBF8\uC9C0"]);
  });

  it("includes v004-proven SmartEditor selectors", () => {
    expect(editorSelectors.writeReady).toContain("div.se-title-text");
    expect(editorSelectors.popupClose).toContain("button.se-popup-button.se-popup-button-cancel");
    expect(editorSelectors.body).toContain("div.se-module.se-module-text.__se-unit:not(.se-title-text) p.se-text-paragraph");
    expect(editorSelectors.body).toContain("div.se-component-contenteditable[contenteditable='true']");
    expect(editorSelectors.initialBody).toEqual([
      "div.se-module.se-module-text.__se-unit:not(.se-title-text) p.se-text-paragraph",
      "div.se-module.se-module-text.__se-unit:not(.se-title-text)",
      "div.se-main-container div.se-module-text:not(.se-title-text) [contenteditable='true']",
      "div.se-main-container div.se-module-text:not(.se-title-text) p.se-text-paragraph"
    ]);
    expect(editorSelectors.normalBody).toContain("p.se-text-paragraph.se-text-paragraph-align-justify");
    expect(editorSelectors.bold).toContain("button[data-group='propertyToolbar'][data-name='bold']");
    expect(editorSelectors.quoteOption[0]).toBe("button[data-role='option'][data-name='quotation'][data-value='quotation_line']");
    expect(editorSelectors.quoteOption).toContain("button[data-group='documentToolbar'][data-name='quotation'][data-value='quotation_line']");
    expect(editorSelectors.quoteOption).toContain("button[data-log='dot.quota1']");
    expect(editorSelectors.quoteMenu).toContain("button[data-name='quotation']");
    expect(editorSelectors.quoteBlock).toContain("div[class*='se-component-quotation']");
    expect(editorSelectors.divider).toContain("button[data-name='horizontalLine']");
    expect(editorSelectors.strikethrough).toContain("button[data-name='strikethrough']");
    expect(editorSelectors.imageToolbar).toContain("button[data-name='image']");
    expect(editorSelectors.imageFileInput).toContain("input[type='file'][accept*='image']");
    expect(editorSelectors.imageInsertedMarkers).toContain("div.se-module-image");
  });

  it("includes Naver SmartEditor paragraph containers as body fallbacks", () => {
    expect(editorSelectors.body).toContain(".se-main-container .se-text-paragraph");
    expect(editorSelectors.body).toContain(".se-component-content .se-text-paragraph");
    expect(editorSelectors.body).toContain(".se-module-text");
  });

  it("documents Naver login session cookies", () => {
    expect(loginCookieNames).toEqual(["NID_AUT", "NID_SES"]);
    expect(NAVER_HOME_URL).toBe("https://www.naver.com/");
    expect(NAVER_LOGIN_URL).toBe("https://nid.naver.com/nidlogin.login");
    expect(loginSelectors.form).toEqual(expect.arrayContaining(["input#id", "input#pw"]));
  });

  it("exposes explicit session verification instead of manual login", () => {
    const engine: AutomationEngine = new NaverBlogAutomation("profile-path");

    expect(engine.verifySession).toBeInstanceOf(Function);
    expect("openLoginWindow" in engine).toBe(false);
  });

  it("verifies authenticated evidence with one home navigation and retains the context", async () => {
    const { context, navigations } = createBrowserHarness();
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.verifySession()).resolves.toEqual({ ok: true });
    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledOnce();
    expect(navigations).toEqual([NAVER_HOME_URL]);
    expect(context.close).not.toHaveBeenCalled();
  });

  it("attaches over CDP to the default context and detaches without closing Chrome", async () => {
    const { browser, context } = createBrowserHarness();
    const engine = NaverBlogAutomation.attach("http://127.0.0.1:9222");

    await expect(engine.verifySession()).resolves.toEqual({ ok: true });

    expect(playwrightMocks.connectOverCDP).toHaveBeenCalledWith(
      "http://127.0.0.1:9222",
      expect.objectContaining({ noDefaults: true })
    );
    expect(browser.contexts).toHaveBeenCalledOnce();
    expect(playwrightMocks.launchPersistentContext).not.toHaveBeenCalled();

    await engine.close();

    expect(browser.close).toHaveBeenCalledOnce();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("closes an empty-context CDP connection before retrying the attach", async () => {
    const { browser, context } = createBrowserHarness();
    const emptyBrowser = {
      close: vi.fn().mockResolvedValue(undefined),
      contexts: vi.fn(() => [])
    };
    playwrightMocks.connectOverCDP
      .mockImplementationOnce(async () => emptyBrowser)
      .mockResolvedValueOnce(browser);
    const engine = NaverBlogAutomation.attach("http://127.0.0.1:9222");

    await expect(engine.verifySession()).resolves.toMatchObject({
      ok: false,
      reason: "profile_error",
      message: "No default browser context is available through the CDP connection."
    });
    await expect(engine.verifySession()).resolves.toEqual({ ok: true });

    expect(emptyBrowser.close).toHaveBeenCalledOnce();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("closes a CDP connection when acquiring its initial page fails before retrying", async () => {
    const { browser, context } = createBrowserHarness();
    const pageAccessError = new Error("Unable to access the current Chrome page");
    const failingContext = {
      pages: vi.fn(() => {
        throw pageAccessError;
      }),
      newPage: vi.fn(),
      close: vi.fn()
    };
    const failingBrowser = {
      close: vi.fn().mockResolvedValue(undefined),
      contexts: vi.fn(() => [failingContext])
    };
    playwrightMocks.connectOverCDP
      .mockResolvedValueOnce(failingBrowser)
      .mockResolvedValueOnce(browser);
    const engine = NaverBlogAutomation.attach("http://127.0.0.1:9222");

    await expect(engine.verifySession()).resolves.toMatchObject({
      ok: false,
      reason: "profile_error",
      message: pageAccessError.message
    });
    await expect(engine.verifySession()).resolves.toEqual({ ok: true });

    expect(failingBrowser.close).toHaveBeenCalledOnce();
    expect(failingContext.close).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });

  it("verifies explicit logged-in UI when legacy session cookies are absent", async () => {
    createBrowserHarness({
      home: {
        ...authenticatedEvidence,
        hasRequiredCookies: false,
        authenticatedUiMatches: [true]
      }
    });
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.verifySession()).resolves.toEqual({ ok: true });
  });

  it("verifies logout text that is not wrapped by a link or button", async () => {
    createBrowserHarness({
      home: {
        ...authenticatedEvidence,
        hasRequiredCookies: false,
        authenticatedUiTextMatches: [true]
      }
    });
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.verifySession()).resolves.toEqual({ ok: true });
  });

  it.each([
    {
      name: "missing",
      evidence: { ...authenticatedEvidence, hasRequiredCookies: false, loginFormMatches: [true] },
      reason: "missing"
    },
    {
      name: "security",
      evidence: {
        ...authenticatedEvidence,
        securityChallengeMatches: [true],
        pageWideSecurityTextMatches: [true]
      },
      reason: "security"
    }
  ] as const)("returns $name from classified session evidence without retrying", async ({ evidence, reason }) => {
    const { navigations } = createBrowserHarness({ home: evidence });
    const engine = new NaverBlogAutomation("profile-path");

    const result = await engine.verifySession();

    expect(result).toMatchObject({ ok: false, reason });
    expect(navigations).toEqual([NAVER_HOME_URL]);
    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledOnce();
  });

  it("returns profile_error when the one verification navigation fails", async () => {
    const { page } = createBrowserHarness({ navigationError: new Error("profile unavailable") });
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.verifySession()).resolves.toMatchObject({
      ok: false,
      reason: "profile_error",
      message: "profile unavailable"
    });
    expect(page.goto).toHaveBeenCalledOnce();
  });

  it("checks every login-form match instead of trusting the first hidden match", async () => {
    createBrowserHarness({
      home: { ...authenticatedEvidence, loginFormMatches: [false, true] }
    });
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.verifySession()).resolves.toMatchObject({ ok: false, reason: "missing" });
  });

  it("explains how to restore a missing manual-login session", async () => {
    createBrowserHarness({
      home: { ...authenticatedEvidence, hasRequiredCookies: false, loginFormMatches: [true] }
    });
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.verifySession()).resolves.toMatchObject({
      ok: false,
      reason: "missing",
      message: expect.stringContaining("Chrome 창을 열어 둔 채")
    });
  });

  it("fails verification closed when a login evidence probe rejects", async () => {
    createBrowserHarness({ loginProbeError: new Error("login probe failed") });
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.verifySession()).resolves.toMatchObject({
      ok: false,
      reason: "profile_error",
      message: "login probe failed"
    });
  });

  it("checks every security challenge match", async () => {
    createBrowserHarness({
      home: {
        ...authenticatedEvidence,
        securityChallengeMatches: [false, true],
        pageWideSecurityTextMatches: [false, true]
      }
    });
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.verifySession()).resolves.toMatchObject({ ok: false, reason: "security" });
  });

  it("ignores ordinary page text containing generic security words", async () => {
    createBrowserHarness({
      home: { ...authenticatedEvidence, pageWideSecurityTextMatches: [true] }
    });
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.verifySession()).resolves.toEqual({ ok: true });
  });

  it("refuses to save before verification without opening a browser", async () => {
    const engine = new NaverBlogAutomation("profile-path");

    await expect(engine.saveDraft(testJob, { speed: "fast" })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      reason: "missing_session"
    });
    expect(playwrightMocks.launchPersistentContext).not.toHaveBeenCalled();
  });

  it("navigates directly to the editor and treats a post-navigation login as security", async () => {
    const { navigations } = createBrowserHarness({
      write: { ...authenticatedEvidence, loginFormMatches: [true] }
    });
    const engine = new NaverBlogAutomation("profile-path");
    await expect(engine.verifySession()).resolves.toEqual({ ok: true });

    await expect(engine.saveDraft(testJob, { speed: "fast" })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      reason: "security"
    });
    expect(navigations).toEqual([NAVER_HOME_URL, NAVER_BLOG_WRITE_URL]);
  });

  it("treats cookie-only loss after editor navigation as security", async () => {
    createBrowserHarness({
      write: { ...authenticatedEvidence, hasRequiredCookies: false }
    });
    const engine = new NaverBlogAutomation("profile-path");
    await expect(engine.verifySession()).resolves.toEqual({ ok: true });

    await expect(engine.saveDraft(testJob, { speed: "fast" })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      reason: "security"
    });
  });

  it("returns profile_error when post-navigation evidence probing fails", async () => {
    createBrowserHarness({
      cookieProbeResults: [true, new Error("cookie probe failed"), true]
    });
    const engine = new NaverBlogAutomation("profile-path");
    await expect(engine.verifySession()).resolves.toEqual({ ok: true });

    await expect(engine.saveDraft(testJob, { speed: "fast" })).resolves.toMatchObject({
      ok: false,
      retryable: false,
      reason: "profile_error",
      message: "cookie probe failed"
    });
  });

  it("treats cookie-only loss during editor readiness as security", async () => {
    createBrowserHarness({ cookieProbeResults: [true, true, false] });
    const engine = new NaverBlogAutomation("profile-path");
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      now += 31_000;
      return now;
    });

    try {
      await expect(engine.verifySession()).resolves.toEqual({ ok: true });
      await expect(engine.saveDraft(testJob, { speed: "fast" })).resolves.toMatchObject({
        ok: false,
        retryable: false,
        reason: "security"
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("returns editor when readiness fails with authenticated session evidence", async () => {
    createBrowserHarness({ cookieProbeResults: [true, true, true] });
    const engine = new NaverBlogAutomation("profile-path");
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      now += 31_000;
      return now;
    });

    try {
      await expect(engine.verifySession()).resolves.toEqual({ ok: true });
      await expect(engine.saveDraft(testJob, { speed: "fast" })).resolves.toMatchObject({
        ok: false,
        retryable: false,
        reason: "editor"
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("returns profile_error when readiness failure evidence probing rejects", async () => {
    createBrowserHarness({
      cookieProbeResults: [true, true, new Error("readiness probe failed"), true]
    });
    const engine = new NaverBlogAutomation("profile-path");
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      now += 31_000;
      return now;
    });

    try {
      await expect(engine.verifySession()).resolves.toEqual({ ok: true });
      await expect(engine.saveDraft(testJob, { speed: "fast" })).resolves.toMatchObject({
        ok: false,
        retryable: false,
        reason: "profile_error",
        message: "readiness probe failed"
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("clears verification when the retained context closes", async () => {
    createBrowserHarness();
    const engine = new NaverBlogAutomation("profile-path");
    await expect(engine.verifySession()).resolves.toEqual({ ok: true });

    await engine.close();

    await expect(engine.saveDraft(testJob, { speed: "fast" })).resolves.toMatchObject({
      ok: false,
      reason: "missing_session"
    });
    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledOnce();
  });

  it("retains a failed-close context so close can retry the same context", async () => {
    const { context } = createBrowserHarness({
      closeFailures: [new Error("close failed")]
    });
    const engine = new NaverBlogAutomation("profile-path");
    await expect(engine.verifySession()).resolves.toEqual({ ok: true });

    await expect(engine.close()).rejects.toThrow("close failed");
    await expect(engine.saveDraft(testJob, { speed: "fast" })).resolves.toMatchObject({
      ok: false,
      reason: "missing_session"
    });
    await expect(engine.close()).resolves.toBeUndefined();

    expect(context.close).toHaveBeenCalledTimes(2);
    expect(playwrightMocks.launchPersistentContext).toHaveBeenCalledOnce();
  });

  it("uses v004 browser context stability options", () => {
    expect(browserContextOptions.locale).toBe("ko-KR");
    expect(browserContextOptions.viewport).toEqual({ width: 1400, height: 1000 });
    expect(browserContextOptions.args).toEqual(
      expect.arrayContaining([
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking"
      ])
    );
  });

  it("falls back to a selected editor range when a title locator rejects direct typing", async () => {
    const engine = new NaverBlogAutomation("profile-path");
    const keyboard = {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined)
    };
    const page = { keyboard } as unknown as Page;
    const locator = {
      click: vi.fn().mockRejectedValue(new Error("not directly editable")),
      press: vi.fn(),
      pressSequentially: vi.fn(),
      evaluate: vi.fn().mockResolvedValue(true),
      fill: vi.fn()
    } as unknown as Locator;

    await (engine as unknown as {
      replaceText(page: Page, locator: Locator, text: string, delayMs: number): Promise<void>;
    }).replaceText(page, locator, "제목", 5);

    expect(keyboard.press).toHaveBeenCalledWith("Backspace");
    expect(keyboard.type).toHaveBeenCalledWith("제목", { delay: 5 });
    expect(locator.fill).not.toHaveBeenCalled();
  });

  it("force-clicks the exact draft-save control after a normal click times out", async () => {
    const engine = new NaverBlogAutomation("profile-path");
    const saveButton = {
      click: vi.fn()
        .mockRejectedValueOnce(new Error("save button is moving"))
        .mockResolvedValueOnce(undefined)
    } as unknown as Locator;
    vi.spyOn(engine as unknown as { firstVisible(): Promise<Locator> }, "firstVisible")
      .mockResolvedValue(saveButton);

    await expect((engine as unknown as {
      clickDraftSave(page: Page): Promise<boolean>;
    }).clickDraftSave({} as Page)).resolves.toBe(true);

    expect(saveButton.click).toHaveBeenNthCalledWith(1, { timeout: 2_000 });
    expect(saveButton.click).toHaveBeenNthCalledWith(2, { timeout: 2_000, force: true });
  });

  it("force-clicks a stable toolbar target after its normal click times out", async () => {
    const engine = new NaverBlogAutomation("profile-path");
    const imageButton = {
      click: vi.fn()
        .mockRejectedValueOnce(new Error("toolbar is moving"))
        .mockResolvedValueOnce(undefined)
    } as unknown as Locator;
    vi.spyOn(engine as unknown as { firstVisible(): Promise<Locator> }, "firstVisible")
      .mockResolvedValue(imageButton);

    await expect((engine as unknown as {
      clickBySelectors(page: Page, selectors: string[], timeout: number): Promise<boolean>;
    }).clickBySelectors({} as Page, ["button[data-name='image']"], 5_000)).resolves.toBe(true);

    expect(imageButton.click).toHaveBeenNthCalledWith(1, { timeout: 2_000 });
    expect(imageButton.click).toHaveBeenNthCalledWith(2, { timeout: 2_000, force: true });
  });

});
