import { chromium, type Browser, type BrowserContext, type Frame, type Locator, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import type { AutomationEngine, AutomationResult, AutomationRunOptions } from "./AutomationEngine";
import { getTypingSpeedProfile } from "../core/typingSpeed";
import type { EditorEvent, PostJob, SessionVerificationResult, TypingSpeedProfile } from "../shared/types";
import { classifySessionEvidence, type SessionEvidence } from "./sessionEvidence";
import {
  NAVER_BLOG_WRITE_URL,
  NAVER_HOME_URL,
  NAVER_LOGIN_URL,
  editorSelectors,
  loginCookieNames,
  loginSelectors
} from "./selectors";

const MISSING_SESSION_MESSAGE = "A verified Naver session is required before saving drafts.";
const MISSING_SESSION_VERIFICATION_MESSAGE = "로그인용 Chrome에서 네이버 로그인 정보가 확인되지 않았습니다. '브라우저 열기 / 로그인'으로 다시 열어 네이버 로그인 후, Chrome 창을 열어 둔 채 로그인 확인을 누르세요.";
const SECURITY_REQUIRED_MESSAGE = "Naver requires login or security verification. Automation stopped.";
const SECURITY_CHALLENGE_SELECTORS = [
  "#captcha",
  "[id*='captcha']",
  "[class*='captcha']",
  "[data-testid*='captcha']",
  "form[action*='nidlogin'] [class*='challenge']",
  "form[action*='nidlogin'] [class*='security']"
] as const;
const SECURITY_TEXT_SURFACE_SELECTORS = [
  "form[action*='nidlogin']",
  "#nidlogin"
] as const;
const SECURITY_CHALLENGE_TEXT = /\uC790\uB3D9\uC785\uB825\s*\uBC29\uC9C0|\uCEA1\uCC28|captcha|\uBCF4\uC548\s*(?:\uBB38\uC790|\uD655\uC778)|\uCD94\uAC00\s*\uC778\uC99D|\uBCF8\uC778\s*\uC778\uC99D/i;

type ObservedSession = {
  classification: ReturnType<typeof classifySessionEvidence>;
  evidence: SessionEvidence;
};

class SessionEvidenceProbeError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), {
      cause: error instanceof Error ? error : undefined
    });
    this.name = "SessionEvidenceProbeError";
  }
}

export const browserContextOptions = {
  channel: "chrome",
  headless: false,
  locale: "ko-KR",
  viewport: { width: 1400, height: 1000 },
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking"
  ]
} satisfies NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

type BrowserConnection =
  | { mode: "persistent"; profilePath: string }
  | { mode: "attached"; cdpEndpoint: string };

export class NaverBlogAutomation implements AutomationEngine {
  private context: BrowserContext | null = null;
  private attachedBrowser: Browser | null = null;
  private page: Page | null = null;
  private sessionVerified = false;
  private preferFirstBodyAfterTitle = false;
  private preferBodyAfterQuote = false;

  private readonly connection: BrowserConnection;

  constructor(profilePathOrConnection: string | BrowserConnection) {
    this.connection = typeof profilePathOrConnection === "string"
      ? { mode: "persistent", profilePath: profilePathOrConnection }
      : profilePathOrConnection;
  }

  static attach(cdpEndpoint: string): NaverBlogAutomation {
    return new NaverBlogAutomation({ mode: "attached", cdpEndpoint });
  }

  async verifySession(): Promise<SessionVerificationResult> {
    this.sessionVerified = false;

    try {
      const page = await this.getPage();
      await page.goto(NAVER_HOME_URL, { waitUntil: "domcontentloaded" });
      const { classification } = await this.observeSession(page);

      if (classification === "authenticated") {
        this.sessionVerified = true;
        return { ok: true };
      }

      if (classification === "security") {
        return { ok: false, reason: "security", message: SECURITY_REQUIRED_MESSAGE };
      }

      return { ok: false, reason: "missing", message: MISSING_SESSION_VERIFICATION_MESSAGE };
    } catch (error) {
      return {
        ok: false,
        reason: "profile_error",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async saveDraft(job: PostJob, options: AutomationRunOptions): Promise<AutomationResult> {
    if (!this.sessionVerified || !this.page || this.page.isClosed()) {
      this.sessionVerified = false;
      return {
        ok: false,
        retryable: false,
        reason: "missing_session",
        message: MISSING_SESSION_MESSAGE
      };
    }

    try {
      const profile = getTypingSpeedProfile(options.speed);
      const page = this.page;
      await page.goto(NAVER_BLOG_WRITE_URL, { waitUntil: "domcontentloaded" });

      const postNavigationFailure = this.failureForObservedSession(await this.observeSession(page));
      if (postNavigationFailure) {
        return postNavigationFailure;
      }

      await this.dismissExistingDraftDialog(page);
      try {
        await this.waitForEditor(page);
      } catch (error) {
        const readinessFailure = this.failureForObservedSession(await this.observeSession(page));
        if (readinessFailure) {
          return readinessFailure;
        }
        throw error;
      }

      for (const event of job.parsed.events) {
        await this.executeEvent(page, event, profile, job.id, options.onLog);
      }

      options.onLog?.(`${job.id}: saving draft`);
      if (!await this.clickDraftSave(page)) {
        await this.clickButtonByNames(page, editorSelectors.draftSaveButtonNames);
      }
      await page.waitForTimeout(profile.blockPauseMs);
      return { ok: true };
    } catch (error) {
      await this.writeFailureArtifacts(job, error);
      if (error instanceof SessionEvidenceProbeError) {
        this.sessionVerified = false;
        return {
          ok: false,
          retryable: false,
          reason: "profile_error",
          message: error.message
        };
      }

      return {
        ok: false,
        retryable: false,
        reason: "editor",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async close(): Promise<void> {
    const context = this.context;
    const attachedBrowser = this.attachedBrowser;
    this.sessionVerified = false;

    if (attachedBrowser) {
      await attachedBrowser.close();
    } else if (context) {
      await context.close();
    }

    if (this.context === context && this.attachedBrowser === attachedBrowser) {
      this.context = null;
      this.attachedBrowser = null;
      this.page = null;
    }
  }

  private async getPage(): Promise<Page> {
    if (!this.context) {
      if (this.connection.mode === "attached") {
        const attachedBrowser = await chromium.connectOverCDP(this.connection.cdpEndpoint, { noDefaults: true });
        try {
          const defaultContext = attachedBrowser.contexts()[0];
          if (!defaultContext) {
            throw new Error("No default browser context is available through the CDP connection.");
          }

          const page = defaultContext.pages()[0] ?? await defaultContext.newPage();
          page.setDefaultTimeout(15_000);
          this.attachedBrowser = attachedBrowser;
          this.context = defaultContext;
          this.page = page;
          return page;
        } catch (error) {
          if (this.attachedBrowser === attachedBrowser) {
            this.attachedBrowser = null;
            this.context = null;
            this.page = null;
          }
          await attachedBrowser.close().catch(() => undefined);
          throw error;
        }
      } else {
        this.context = await chromium.launchPersistentContext(this.connection.profilePath, browserContextOptions);
      }
    }

    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.page.setDefaultTimeout(15_000);
    return this.page;
  }

  private async waitForEditor(page: Page): Promise<void> {
    await this.dismissExistingDraftDialog(page);
    await this.firstVisible(page, editorSelectors.writeReady, 30_000);
    await this.firstVisible(page, editorSelectors.title, 30_000);
    await this.firstVisibleBody(page, 30_000);
  }

  private async executeEvent(
    page: Page,
    event: EditorEvent,
    profile: TypingSpeedProfile,
    postId: string,
    onLog?: (message: string) => void
  ): Promise<void> {
    switch (event.type) {
      case "setTitle":
        onLog?.(`${postId}: entering title`);
        await this.setTitle(page, event.text, profile);
        break;
      case "typeText":
        onLog?.(`${postId}: entering body text`);
        await this.typeInBody(page, event.text, profile);
        break;
      case "typeBold":
        onLog?.(`${postId}: entering bold text`);
        await this.clickToolbar(page, editorSelectors.bold, editorSelectors.boldButtonNames);
        await this.typeInBody(page, event.text, profile);
        await this.clickToolbar(page, editorSelectors.bold, editorSelectors.boldButtonNames);
        break;
      case "insertQuote":
        onLog?.(`${postId}: entering quote`);
        await this.insertQuote(page, event.text, profile, onLog);
        break;
      case "insertDivider":
        onLog?.(`${postId}: inserting divider`);
        await this.clickToolbar(page, editorSelectors.divider, editorSelectors.dividerButtonNames);
        await page.waitForTimeout(profile.blockPauseMs);
        break;
      case "insertImage":
        onLog?.(`${postId}: inserting image`);
        await this.insertImage(page, event.absolutePath, profile);
        break;
    }
  }

  private async setTitle(page: Page, text: string, profile: TypingSpeedProfile): Promise<void> {
    await this.dismissExistingDraftDialog(page);
    const title = await this.firstVisible(page, editorSelectors.title, 10_000);
    await this.replaceText(page, title, text, Math.min(profile.keyDelayMs, 10));
    this.preferFirstBodyAfterTitle = true;
    await title.press("Enter").catch(() => page.keyboard.press("Enter"));
    await page.waitForTimeout(profile.linePauseMs);
  }

  private async typeInBody(
    page: Page,
    text: string,
    profile: TypingSpeedProfile,
    options: { resetFormatting?: boolean; enterAfterTyping?: boolean } = {}
  ): Promise<void> {
    await this.dismissExistingDraftDialog(page);
    const enterAfterTyping = options.enterAfterTyping !== false;

    if (this.preferBodyAfterQuote) {
      await this.typeInBodyAfterQuote(page, text, profile, enterAfterTyping);
      return;
    }

    if (this.preferFirstBodyAfterTitle) {
      await this.typeFirstBodyAfterTitle(page, text, profile, enterAfterTyping, options);
      return;
    }

    if (await this.typeIntoFocusedNormalBody(page, text, profile, enterAfterTyping)) {
      return;
    }

    const body = await this.firstVisibleNormalBody(page, 5_000, "last")
      .catch(() => this.firstVisibleBody(page, 10_000, "last"));
    await this.placeCursorAtEnd(body);
    if (options.resetFormatting !== false) {
      await this.resetBodyTextFormatting(page);
    }
    await body.pressSequentially(text, { delay: profile.keyDelayMs, timeout: 0 });
    if (enterAfterTyping) {
      await body.press("Enter");
    }
    await page.waitForTimeout(profile.linePauseMs);
  }

  private async replaceText(page: Page, locator: Locator, text: string, delayMs: number): Promise<void> {
    try {
      await locator.click({ timeout: 3_000 });
      await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await locator.press("Backspace");
      await locator.pressSequentially(text, { delay: delayMs, timeout: 0 });
    } catch (firstError) {
      try {
        const selected = await locator.evaluate((node) => {
          const element = node instanceof HTMLElement ? node : node.parentElement;
          if (!element) return false;

          const focusTarget = element.closest("[contenteditable='true']") as HTMLElement | null ?? element;
          focusTarget.focus();
          const selection = window.getSelection();
          if (!selection) return false;

          const range = document.createRange();
          range.selectNodeContents(element);
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        });
        if (!selected) throw firstError;

        await page.keyboard.press("Backspace");
        await page.keyboard.type(text, { delay: delayMs });
      } catch (selectionError) {
        try {
          await locator.fill(text, { timeout: 5_000 });
        } catch (fillError) {
          throw new Error("Failed to enter editor text.", {
            cause: fillError instanceof Error ? fillError : selectionError instanceof Error ? selectionError : firstError
          });
        }
      }
    }
  }

  private async focusNormalBody(page: Page, profile: TypingSpeedProfile): Promise<void> {
    const body = await this.firstVisibleNormalBody(page, 5_000, "last")
      .catch(() => this.firstVisibleBody(page, 5_000, "last"));

    await this.placeCursorAtEnd(body);
    await page.waitForTimeout(profile.linePauseMs);
  }

  private async insertQuote(
    page: Page,
    text: string,
    profile: TypingSpeedProfile,
    onLog?: (message: string) => void
  ): Promise<void> {
    let selectedQuote2 = await this.clickBySelectors(page, editorSelectors.quoteOption, 750);
    if (!selectedQuote2) {
      await this.openQuoteStyleMenu(page);
      selectedQuote2 = await this.clickBySelectors(page, editorSelectors.quoteOption, 3_000);
    }

    await page.waitForTimeout(300);
    onLog?.("Typing quote using current editor focus");
    await page.keyboard.type(text, { delay: profile.keyDelayMs });
    await this.focusBelowLastQuoteBlock(page, profile);
    this.preferBodyAfterQuote = true;
  }

  private async openQuoteStyleMenu(page: Page): Promise<void> {
    const quoteMenu = await this.firstVisible(page, editorSelectors.quoteMenu, 3_000)
      .catch(() => null);

    if (!quoteMenu) {
      await this.clickButtonByNames(page, editorSelectors.quoteButtonNames);
      return;
    }

    const box = await quoteMenu.boundingBox().catch(() => null);
    if (!box) {
      await quoteMenu.click({ timeout: 2_000 });
      return;
    }

    await page.mouse.click(box.x + Math.max(box.width - 6, 1), box.y + box.height / 2);
    await page.waitForTimeout(300);
  }

  private async focusBelowLastQuoteBlock(page: Page, profile: TypingSpeedProfile): Promise<void> {
    const quoteBlock = await this.lastVisibleQuoteBlock(page, 3_000).catch(() => null);
    const quoteBox = await quoteBlock?.boundingBox().catch(() => null);

    if (quoteBox) {
      const viewport = page.viewportSize();
      const x = quoteBox.x + quoteBox.width / 2;
      const yLimit = viewport ? viewport.height - 80 : quoteBox.y + quoteBox.height + 40;
      const y = Math.min(quoteBox.y + quoteBox.height + 80, yLimit);

      await page.keyboard.press("Escape").catch(() => undefined);
      await page.mouse.click(x, y);
      await page.waitForTimeout(profile.linePauseMs);
      return;
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    await this.focusNormalBody(page, profile);
  }

  private async typeFirstBodyAfterTitle(
    page: Page,
    text: string,
    profile: TypingSpeedProfile,
    enterAfterTyping: boolean,
    options: { resetFormatting?: boolean }
  ): Promise<void> {
    try {
      if (await this.typeIntoFocusedNormalBody(page, text, profile, enterAfterTyping)) {
        return;
      }

      const body = await this.firstVisibleBody(page, 10_000, "first", editorSelectors.initialBody);
      await this.placeCursorAtEnd(body);
      if (options.resetFormatting !== false) {
        await this.resetBodyTextFormatting(page);
      }
      await body.pressSequentially(text, { delay: profile.keyDelayMs, timeout: 0 });
      if (enterAfterTyping) {
        await body.press("Enter");
      }
      await page.waitForTimeout(profile.linePauseMs);
    } finally {
      this.preferFirstBodyAfterTitle = false;
    }
  }

  private async typeInBodyAfterQuote(
    page: Page,
    text: string,
    profile: TypingSpeedProfile,
    enterAfterTyping: boolean
  ): Promise<void> {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await this.typeIntoFocusedNormalBody(page, text, profile, enterAfterTyping, { afterLastQuote: true })) {
          return;
        }

        const bodyAfterQuote = await this.firstVisibleNormalBodyAfterLastQuote(page, 1_000).catch(() => null);
        if (bodyAfterQuote) {
          await this.placeCursorAtEnd(bodyAfterQuote);
          await bodyAfterQuote.pressSequentially(text, { delay: profile.keyDelayMs, timeout: 0 });
          if (enterAfterTyping) {
            await bodyAfterQuote.press("Enter");
          }
          await page.waitForTimeout(profile.linePauseMs);
          return;
        }

        await this.createNormalBodyAfterQuoteWithKeyboard(page, profile);
      }

      throw new Error("Could not focus a normal body paragraph after the last quote block.");
    } finally {
      this.preferBodyAfterQuote = false;
    }
  }

  private async typeIntoFocusedNormalBody(
    page: Page,
    text: string,
    profile: TypingSpeedProfile,
    enterAfterTyping: boolean,
    options: { afterLastQuote?: boolean } = {}
  ): Promise<boolean> {
    const hasFocus = await this.hasFocusedNormalBody(page, options);
    if (!hasFocus) return false;

    await page.keyboard.type(text, { delay: profile.keyDelayMs });
    if (enterAfterTyping) {
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(profile.linePauseMs);
    return true;
  }

  private async createNormalBodyAfterQuoteWithKeyboard(page: Page, profile: TypingSpeedProfile): Promise<void> {
    const quoteBlock = await this.lastVisibleQuoteBlock(page, 1_000).catch(() => null);
    const quoteBox = await quoteBlock?.boundingBox().catch(() => null);

    if (quoteBox) {
      const viewport = page.viewportSize();
      const x = quoteBox.x + quoteBox.width / 2;
      const yLimit = viewport ? viewport.height - 80 : quoteBox.y + quoteBox.height + 80;
      await page.mouse.click(x, Math.min(quoteBox.y + quoteBox.height + 80, yLimit)).catch(() => undefined);
      await page.waitForTimeout(150);
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowDown").catch(() => undefined);
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter").catch(() => undefined);
    await page.waitForTimeout(profile.linePauseMs);

    if (await this.hasFocusedNormalBody(page, { afterLastQuote: true })) {
      return;
    }

    await this.focusBelowLastQuoteBlock(page, profile);
  }

  private async insertImage(page: Page, absolutePath: string, profile: TypingSpeedProfile): Promise<void> {
    let fileInput = await this.firstAttached(page, editorSelectors.imageFileInput, 2_000).catch(() => null);

    if (!fileInput) {
      const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null);
      if (!await this.clickBySelectors(page, editorSelectors.imageToolbar, 5_000)) {
        await this.clickButtonByNames(page, editorSelectors.imageButtonNames);
      }
      const fileChooser = await fileChooserPromise;

      if (fileChooser) {
        await fileChooser.setFiles(absolutePath);
        await this.waitForImageInserted(page, profile);
        return;
      }

      fileInput = await this.firstAttached(page, editorSelectors.imageFileInput, 5_000);
    }

    await fileInput.setInputFiles(absolutePath, { timeout: 10_000 });
    await this.waitForImageInserted(page, profile);
  }

  private async waitForImageInserted(page: Page, profile: TypingSpeedProfile): Promise<void> {
    try {
      await this.firstAttached(page, editorSelectors.imageInsertedMarkers, 10_000);
    } catch {
      // Upload completion markers can detach while SmartEditor rebuilds the image block.
    }

    await page.waitForTimeout(profile.blockPauseMs);
  }

  private async resetBodyTextFormatting(page: Page): Promise<void> {
    const strikeButton = await this.firstVisible(page, editorSelectors.strikethrough, 2_000).catch(() => null);
    if (!strikeButton) return;

    const className = await strikeButton.getAttribute("class").catch(() => "") ?? "";
    const ariaPressed = (await strikeButton.getAttribute("aria-pressed").catch(() => "") ?? "").toLowerCase();
    if (className.includes("se-is-selected") || ariaPressed === "true") {
      await strikeButton.click({ timeout: 2_000 });
    }
  }

  private async clickToolbar(page: Page, selectors: string[], buttonNames: string[]): Promise<void> {
    if (await this.clickBySelectors(page, selectors, 3_000)) return;
    await this.clickButtonByNames(page, buttonNames);
  }

  private async clickDraftSave(page: Page): Promise<boolean> {
    const target = await this.firstVisible(page, editorSelectors.draftSave, 5_000).catch(() => null);
    if (!target) return false;

    try {
      await target.click({ timeout: 2_000 });
      return true;
    } catch {
      try {
        await target.click({ timeout: 2_000, force: true });
        return true;
      } catch {
        return false;
      }
    }
  }

  private async clickBySelectors(page: Page, selectors: string[], timeout: number): Promise<boolean> {
    const target = await this.firstVisible(page, selectors, timeout).catch(() => null);
    if (!target) return false;

    try {
      await target.click({ timeout: 2_000 });
      return true;
    } catch {
      try {
        await target.click({ timeout: 2_000, force: true });
        return true;
      } catch {
        return false;
      }
    }
  }

  private async firstAttached(page: Page, selectorCandidates: string[], timeout: number): Promise<Locator> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        for (const selector of selectorCandidates) {
          const locator = frame.locator(selector).first();
          const count = await locator.count().catch(() => 0);
          if (count > 0) {
            return locator;
          }
        }
      }

      await page.waitForTimeout(250);
    }

    throw new Error(`No attached editor element found for selectors: ${selectorCandidates.join(", ")}`);
  }

  private async firstVisible(page: Page, selectorCandidates: string[], timeout: number): Promise<Locator> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        for (const selector of selectorCandidates) {
          const locator = frame.locator(selector).first();
          try {
            const count = await locator.count();
            if (count > 0 && await this.isUsableLocator(locator)) {
              return locator;
            }
          } catch {
            // Keep trying the next candidate; dynamic editor DOMs can detach mid-check.
          }
        }
      }
      await page.waitForTimeout(250);
    }

    throw new Error(`No visible editor element found for selectors: ${selectorCandidates.join(", ")}`);
  }

  private async lastVisibleElement(page: Page, selectorCandidates: string[], timeout: number): Promise<Locator> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      let bottomCandidate: { locator: Locator; y: number } | null = null;

      for (const frame of page.frames()) {
        for (const selector of selectorCandidates) {
          const candidates = frame.locator(selector);
          const count = await candidates.count().catch(() => 0);

          for (let index = 0; index < count; index += 1) {
            const locator = candidates.nth(index);
            try {
              if (!await this.isUsableLocator(locator)) continue;
              const box = await locator.boundingBox().catch(() => null);
              if (box && (!bottomCandidate || box.y >= bottomCandidate.y)) {
                bottomCandidate = { locator, y: box.y };
              }
            } catch {
              // Keep scanning; SmartEditor can rebuild blocks during selection changes.
            }
          }
        }
      }

      if (bottomCandidate) {
        return bottomCandidate.locator;
      }

      await page.waitForTimeout(250);
    }

    throw new Error(`No visible editor element found for selectors: ${selectorCandidates.join(", ")}`);
  }

  private async lastVisibleQuoteBlock(page: Page, timeout: number): Promise<Locator> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      let bottomCandidate: { locator: Locator; bottom: number; height: number } | null = null;

      for (const frame of page.frames()) {
        for (const selector of editorSelectors.quoteBlock) {
          const candidates = frame.locator(selector);
          const count = await candidates.count().catch(() => 0);

          for (let index = 0; index < count; index += 1) {
            const locator = candidates.nth(index);
            try {
              if (!await this.isUsableLocator(locator)) continue;
              const box = await locator.boundingBox().catch(() => null);
              if (!box) continue;

              const bottom = box.y + box.height;
              const isBetter = !bottomCandidate
                || bottom > bottomCandidate.bottom
                || (Math.abs(bottom - bottomCandidate.bottom) < 4 && box.height > bottomCandidate.height);
              if (isBetter) {
                bottomCandidate = { locator, bottom, height: box.height };
              }
            } catch {
              // Keep scanning; SmartEditor can rebuild quote blocks while selected.
            }
          }
        }
      }

      if (bottomCandidate) {
        return bottomCandidate.locator;
      }

      await page.waitForTimeout(250);
    }

    throw new Error(`No visible quote block found for selectors: ${editorSelectors.quoteBlock.join(", ")}`);
  }

  private async firstVisibleBody(
    page: Page,
    timeout: number,
    placement: "first" | "last" = "first",
    selectorCandidates: string[] = editorSelectors.body
  ): Promise<Locator> {
    const title = await this.firstVisible(page, editorSelectors.title, timeout);
    const titleHandle = await title.elementHandle();
    const titleBox = await title.boundingBox().catch(() => null);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      let bottomCandidate: { locator: Locator; y: number } | null = null;

      for (const frame of page.frames()) {
        for (const selector of selectorCandidates) {
          const candidates = frame.locator(selector);
          const count = await candidates.count().catch(() => 0);

          for (let index = 0; index < count; index += 1) {
            const locator = candidates.nth(index);
            try {
              if (await this.isBodyLocator(locator, titleHandle, titleBox)) {
                if (placement === "last") {
                  const box = await locator.boundingBox().catch(() => null);
                  if (box && (!bottomCandidate || box.y >= bottomCandidate.y)) {
                    bottomCandidate = { locator, y: box.y };
                  }
                  continue;
                }
                return locator;
              }
            } catch {
              // Keep scanning; editor nodes can detach while the page is settling.
            }
          }
        }
      }

      if (bottomCandidate) {
        return bottomCandidate.locator;
      }

      await page.waitForTimeout(250);
    }

    throw new Error(`No visible body editor found for selectors: ${selectorCandidates.join(", ")}`);
  }

  private async firstVisibleNormalBody(
    page: Page,
    timeout: number,
    placement: "first" | "last" = "first"
  ): Promise<Locator> {
    const title = await this.firstVisible(page, editorSelectors.title, timeout);
    const titleHandle = await title.elementHandle();
    const titleBox = await title.boundingBox().catch(() => null);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      let bottomCandidate: { locator: Locator; y: number } | null = null;

      for (const frame of page.frames()) {
        for (const selector of editorSelectors.normalBody) {
          const candidates = frame.locator(selector);
          const count = await candidates.count().catch(() => 0);

          for (let index = 0; index < count; index += 1) {
            const locator = candidates.nth(index);
            try {
              if (!await this.isBodyLocator(locator, titleHandle, titleBox)) continue;
              if (await this.isInsideQuoteBlock(locator)) continue;

              if (placement === "last") {
                const box = await locator.boundingBox().catch(() => null);
                if (box && (!bottomCandidate || box.y >= bottomCandidate.y)) {
                  bottomCandidate = { locator, y: box.y };
                }
                continue;
              }

              return locator;
            } catch {
              // Keep scanning; editor nodes can detach while SmartEditor reshapes blocks.
            }
          }
        }
      }

      if (bottomCandidate) {
        return bottomCandidate.locator;
      }

      await page.waitForTimeout(250);
    }

    throw new Error(`No visible normal body editor found for selectors: ${editorSelectors.normalBody.join(", ")}`);
  }

  private async firstVisibleNormalBodyAfterLastQuote(page: Page, timeout: number): Promise<Locator> {
    const quoteBlock = await this.lastVisibleQuoteBlock(page, timeout);
    const quoteBox = await quoteBlock.boundingBox().catch(() => null);
    if (!quoteBox) {
      throw new Error("No visible quote block found before body re-entry.");
    }

    const title = await this.firstVisible(page, editorSelectors.title, timeout);
    const titleHandle = await title.elementHandle();
    const titleBox = await title.boundingBox().catch(() => null);
    const deadline = Date.now() + timeout;
    const minY = quoteBox.y + quoteBox.height - 2;

    while (Date.now() < deadline) {
      let bottomCandidate: { locator: Locator; y: number } | null = null;

      for (const frame of page.frames()) {
        for (const selector of editorSelectors.normalBody) {
          const candidates = frame.locator(selector);
          const count = await candidates.count().catch(() => 0);

          for (let index = 0; index < count; index += 1) {
            const locator = candidates.nth(index);
            try {
              if (!await this.isBodyLocator(locator, titleHandle, titleBox)) continue;
              if (await this.isInsideQuoteBlock(locator)) continue;

              const box = await locator.boundingBox().catch(() => null);
              if (!box || box.y < minY) continue;
              if (!bottomCandidate || box.y >= bottomCandidate.y) {
                bottomCandidate = { locator, y: box.y };
              }
            } catch {
              // Keep scanning; SmartEditor can rebuild body blocks after quote insertion.
            }
          }
        }
      }

      if (bottomCandidate) {
        return bottomCandidate.locator;
      }

      await page.waitForTimeout(250);
    }

    throw new Error("No normal body editor found after the last quote block.");
  }

  private async isBodyLocator(
    locator: Locator,
    titleHandle: Awaited<ReturnType<Locator["elementHandle"]>>,
    titleBox: Awaited<ReturnType<Locator["boundingBox"]>>
  ): Promise<boolean> {
    if (!await this.isUsableLocator(locator)) return false;
    if (await this.isSameElement(locator, titleHandle)) return false;
    if (await this.isInsideTitleBlock(locator)) return false;
    if (!titleBox) return true;

    const box = await locator.boundingBox().catch(() => null);
    if (!box) return false;
    return box.y > titleBox.y + Math.max(titleBox.height, 8);
  }

  private async isInsideQuoteBlock(locator: Locator): Promise<boolean> {
    return locator.evaluate((node) => {
      let current: Element | null = node instanceof Element ? node : null;
      while (current) {
        const className = current.getAttribute("class") ?? "";
        const dataName = current.getAttribute("data-name") ?? "";
        const dataType = current.getAttribute("data-type") ?? "";
        const ariaLabel = current.getAttribute("aria-label") ?? "";
        const placeholder = current.getAttribute("placeholder") ?? "";
        // Ancestor text includes neighboring quote content, so only element metadata can identify a quote block.
        const marker = `${className} ${dataName} ${dataType} ${ariaLabel} ${placeholder}`.toLowerCase();
        if (
          marker.includes("quotation")
          || marker.includes("quote")
          || marker.includes("cite")
          || marker.includes("citation")
          || marker.includes("source")
          || marker.includes("출처")
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }).catch(() => false);
  }

  private async hasFocusedNormalBody(page: Page, options: { afterLastQuote?: boolean } = {}): Promise<boolean> {
    let lastQuoteBottom: number | null = null;

    if (options.afterLastQuote) {
      const quoteBlock = await this.lastVisibleQuoteBlock(page, 1_000).catch(() => null);
      const quoteBox = await quoteBlock?.boundingBox().catch(() => null);
      if (!quoteBox) return false;
      lastQuoteBottom = quoteBox.y + quoteBox.height - 2;
    }

    for (const frame of page.frames()) {
      const focused = await frame.evaluate((minimumY) => {
        const selection = window.getSelection();
        const anchorElement = selection?.anchorNode instanceof Element
          ? selection.anchorNode
          : selection?.anchorNode?.parentElement;
        const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
        const current = anchorElement ?? activeElement;
        if (!current) return false;

        const paragraph = current.closest("p.se-text-paragraph");
        const editable = current.closest("[contenteditable='true']");
        if (!paragraph && !editable) return false;

        let ancestor: Element | null = current;
        while (ancestor) {
          const className = ancestor.getAttribute("class") ?? "";
          const dataName = ancestor.getAttribute("data-name") ?? "";
          const dataType = ancestor.getAttribute("data-type") ?? "";
          const ariaLabel = ancestor.getAttribute("aria-label") ?? "";
          const placeholder = ancestor.getAttribute("placeholder") ?? "";
          // A document-level ancestor can contain the quote text even when the selection is in a later body block.
          const marker = `${className} ${dataName} ${dataType} ${ariaLabel} ${placeholder}`.toLowerCase();
          if (
            marker.includes("quotation")
            || marker.includes("quote")
            || marker.includes("cite")
            || marker.includes("citation")
            || marker.includes("source")
            || marker.includes("출처")
          ) return false;
          if (marker.includes("title") || marker.includes("documenttitle")) return false;
          ancestor = ancestor.parentElement;
        }

        if (typeof minimumY === "number") {
          const box = (paragraph ?? editable)?.getBoundingClientRect();
          if (!box || box.y < minimumY) return false;
        }

        return true;
      }, lastQuoteBottom).catch(() => false);

      if (focused) return true;
    }

    return false;
  }

  private async isInsideTitleBlock(locator: Locator): Promise<boolean> {
    return locator.evaluate((node) => {
      let current: Element | null = node instanceof Element ? node : null;
      while (current) {
        const className = current.getAttribute("class") ?? "";
        const dataName = current.getAttribute("data-name") ?? "";
        const marker = `${className} ${dataName}`.toLowerCase();
        if (marker.includes("title") || marker.includes("documenttitle")) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }).catch(() => false);
  }

  private async clickLocatorCenter(page: Page, locator: Locator): Promise<void> {
    const box = await locator.boundingBox().catch(() => null);
    if (!box) return;

    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 24));
    await page.waitForTimeout(250);
  }

  private async placeCursorAtEnd(locator: Locator): Promise<void> {
    const placed = await locator.evaluate((node) => {
      const element = node instanceof HTMLElement ? node : node.parentElement;
      if (!element) return false;

      const editable = element.closest("[contenteditable='true']") as HTMLElement | null;
      const focusTarget = editable ?? element;
      focusTarget.focus();

      const selection = window.getSelection();
      if (!selection) return false;

      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }).catch(() => false);

    if (placed) return;

    await locator.click({ timeout: 2_000, force: true });
    await locator.page().keyboard.press("End");
  }

  private async clickButtonByNames(page: Page, names: string[]): Promise<void> {
    for (const frame of page.frames()) {
      for (const name of names) {
        const button = frame.getByRole("button", { name: this.exactNamePattern(name) }).first();
        try {
          const count = await button.count();
          if (count > 0 && await button.isVisible({ timeout: 500 })) {
            await button.click();
            return;
          }
        } catch {
          // Try the next accessible name.
        }
      }
    }

    throw new Error(`Could not find visible button named one of: ${names.join(", ")}`);
  }

  private async dismissExistingDraftDialog(page: Page): Promise<void> {
    const dialogPattern = /\uC791\uC131 \uC911\uC778 \uAE00|\uC791\uC131\uC911\uC778 \uAE00|\uC774\uC5B4\uC11C \uC791\uC131|\uC784\uC2DC\uC800\uC7A5/;
    const buttonNames = [
      "\uCDE8\uC18C",
      "\uB2EB\uAE30",
      "\uC544\uB2C8\uC624",
      "\uC0C8\uAE00\uC4F0\uAE30",
      "\uD655\uC778"
    ];
    const deadline = Date.now() + 5_000;

    while (Date.now() < deadline) {
      for (const frame of page.frames()) {
        const dismissed = await this.dismissPopupInFrame(frame, dialogPattern, buttonNames);
        if (dismissed) {
          await page.waitForTimeout(500);
          return;
        }

        const dialogText = frame.getByText(dialogPattern).first();
        if (await dialogText.isVisible({ timeout: 250 }).catch(() => false)) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
          return;
        }
      }

      await page.waitForTimeout(250);
    }
  }

  private async dismissPopupInFrame(frame: Frame, dialogPattern: RegExp, buttonNames: string[]): Promise<boolean> {
    const popupSelectors = [
      ".se-popup-alert-confirm",
      ".se-popup-alert",
      "[data-name*=\"se-popup-alert\"]",
      "[data-group=\"popupLayer\"]"
    ];

    for (const selector of popupSelectors) {
      const popups = frame.locator(selector).filter({ hasText: dialogPattern });
      const count = await popups.count().catch(() => 0);

      for (let index = count - 1; index >= 0; index -= 1) {
        const popup = popups.nth(index);
        if (!await popup.isVisible({ timeout: 250 }).catch(() => false)) continue;

        for (const name of buttonNames) {
          const clicked = await this.clickPopupButton(popup, name);
          if (clicked) return true;
        }
      }
    }

    return false;
  }

  private async clickPopupButton(popup: Locator, name: string): Promise<boolean> {
    const namePattern = this.exactNamePattern(name);
    const candidates = [
      popup.getByRole("button", { name: namePattern }).first(),
      popup.locator("button").filter({ hasText: namePattern }).first(),
      popup.locator("a").filter({ hasText: namePattern }).first()
    ];

    for (const button of candidates) {
      if (!await button.isVisible({ timeout: 250 }).catch(() => false)) continue;

      try {
        await button.click({ timeout: 2_000 });
        return true;
      } catch {
        const clicked = await button.evaluate((element) => {
          if (!(element instanceof HTMLElement)) return false;
          element.click();
          return true;
        }).catch(() => false);
        if (clicked) return true;
      }
    }

    return false;
  }

  private async isSameElement(locator: Locator, elementHandle: Awaited<ReturnType<Locator["elementHandle"]>>): Promise<boolean> {
    if (!elementHandle) return false;

    return locator.evaluate((node, titleNode) => node === titleNode, elementHandle).catch(() => false);
  }

  private async isUsableLocator(locator: Locator): Promise<boolean> {
    if (!await locator.isVisible({ timeout: 250 }).catch(() => false)) {
      return false;
    }

    const ariaHidden = await locator.getAttribute("aria-hidden").catch(() => null);
    if (ariaHidden === "true") {
      return false;
    }

    const box = await locator.boundingBox().catch(() => null);
    return Boolean(box && box.width > 1 && box.height > 1);
  }

  private async observeSession(page: Page): Promise<ObservedSession> {
    try {
      const evidence = await this.gatherSessionEvidence(page);
      return {
        classification: classifySessionEvidence(evidence),
        evidence
      };
    } catch (error) {
      throw new SessionEvidenceProbeError(error);
    }
  }

  private async gatherSessionEvidence(page: Page): Promise<SessionEvidence> {
    const [hasRequiredCookies, authenticatedUiVisible, loginFormVisible, securityRequirementVisible] = await Promise.all([
      this.hasNaverSessionCookies(),
      this.hasVisibleAuthenticatedUi(page),
      this.hasVisibleLoginForm(page),
      this.hasVisibleSecurityRequirement(page)
    ]);

    return {
      url: page.url(),
      hasRequiredCookies,
      authenticatedUiVisible,
      loginFormVisible,
      securityRequirementVisible
    };
  }

  private failureForObservedSession(observed: ObservedSession): AutomationResult | null {
    if (observed.classification === "authenticated") return null;

    this.sessionVerified = false;
    return {
      ok: false,
      retryable: false,
      reason: "security",
      message: SECURITY_REQUIRED_MESSAGE
    };
  }

  private async hasNaverSessionCookies(): Promise<boolean> {
    if (!this.context) return false;

    const cookies = await this.context.cookies([
      NAVER_HOME_URL,
      NAVER_BLOG_WRITE_URL,
      NAVER_LOGIN_URL,
      "https://naver.com/"
    ]);
    const cookieNames = new Set(cookies.map((cookie) => cookie.name));
    return loginCookieNames.every((name) => cookieNames.has(name));
  }

  private async hasVisibleAuthenticatedUi(page: Page): Promise<boolean> {
    for (const frame of page.frames()) {
      const logoutText = frame.getByText("로그아웃", { exact: true });
      const logoutTextCount = await logoutText.count();
      for (let index = 0; index < logoutTextCount; index += 1) {
        if (await logoutText.nth(index).isVisible({ timeout: 250 })) {
          return true;
        }
      }

      for (const selector of loginSelectors.authenticated) {
        const controls = frame.locator(selector);
        const count = await controls.count();
        for (let index = 0; index < count; index += 1) {
          if (await controls.nth(index).isVisible({ timeout: 250 })) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async hasVisibleLoginForm(page: Page): Promise<boolean> {
    for (const frame of page.frames()) {
      for (const selector of loginSelectors.form) {
        const loginFields = frame.locator(selector);
        const count = await loginFields.count();
        for (let index = 0; index < count; index += 1) {
          if (await loginFields.nth(index).isVisible({ timeout: 250 })) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async hasVisibleSecurityRequirement(page: Page): Promise<boolean> {
    for (const frame of page.frames()) {
      for (const selector of SECURITY_CHALLENGE_SELECTORS) {
        const challenges = frame.locator(selector);
        const count = await challenges.count();
        for (let index = 0; index < count; index += 1) {
          if (await challenges.nth(index).isVisible({ timeout: 500 })) {
            return true;
          }
        }
      }

      for (const selector of SECURITY_TEXT_SURFACE_SELECTORS) {
        const surfaces = frame.locator(selector);
        const count = await surfaces.count();
        for (let index = 0; index < count; index += 1) {
          const surface = surfaces.nth(index);
          if (!await surface.isVisible({ timeout: 500 })) continue;
          const text = await surface.textContent();
          if (text && SECURITY_CHALLENGE_TEXT.test(text)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private exactNamePattern(value: string): RegExp {
    return new RegExp(`^\\s*${this.escapeRegExp(value)}\\s*$`, "i");
  }

  private async writeFailureArtifacts(job: PostJob, error: unknown): Promise<void> {
    const page = this.page;
    if (!page || page.isClosed()) return;

    try {
      const diagnosticsPath = path.join(job.folderPath, "automation-diagnostics");
      await fs.mkdir(diagnosticsPath, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      await page.screenshot({
        path: path.join(diagnosticsPath, `${timestamp}-failure.png`),
        fullPage: true
      }).catch(() => undefined);

      const frameSummaries = await Promise.all(page.frames().map(async (frame, index) => ({
        index,
        url: frame.url(),
        titleCandidates: await this.countCandidates(frame, editorSelectors.title),
        bodyCandidates: await this.countCandidates(frame, editorSelectors.body),
        quoteOptionCandidates: await this.countCandidates(frame, editorSelectors.quoteOption),
        quoteMenuCandidates: await this.countCandidates(frame, editorSelectors.quoteMenu),
        quoteBlockCandidates: await this.countCandidates(frame, editorSelectors.quoteBlock)
      })));

      await fs.writeFile(
        path.join(diagnosticsPath, `${timestamp}-failure.json`),
        `${JSON.stringify({
          url: page.url(),
          error: error instanceof Error ? error.message : String(error),
          frames: frameSummaries
        }, null, 2)}\n`,
        "utf8"
      );
    } catch {
      // Diagnostics must never hide the original automation failure.
    }
  }

  private async countCandidates(frame: Frame, selectors: string[]): Promise<Array<{ selector: string; count: number }>> {
    const result: Array<{ selector: string; count: number }> = [];
    for (const selector of selectors) {
      result.push({
        selector,
        count: await frame.locator(selector).count().catch(() => 0)
      });
    }
    return result;
  }
}
