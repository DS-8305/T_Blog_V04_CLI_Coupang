import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { AutomationEngine, AutomationResult, AutomationRunOptions } from "./AutomationEngine";
import type { EditorEvent, PostJob, SessionVerificationResult, TypingSpeedProfile } from "../shared/types";
import { getTypingSpeedProfile } from "../core/typingSpeed";
import { classifySessionEvidence } from "./sessionEvidence";
import {
  TISTORY_ACCESS_DENIED_TEXT,
  TISTORY_SECURITY_TEXT,
  tistorySelectors
} from "./tistorySelectors";

export class TistoryBlogAutomation implements AutomationEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionVerified = false;

  private constructor(
    private readonly cdpEndpoint: string,
    private readonly blogUrl: string
  ) {}

  static attach(cdpEndpoint: string, blogUrl: string): TistoryBlogAutomation {
    return new TistoryBlogAutomation(cdpEndpoint, blogUrl.replace(/\/$/, ""));
  }

  async verifySession(): Promise<SessionVerificationResult> {
    this.sessionVerified = false;
    try {
      const page = await this.getPage();
      await page.goto(`${this.blogUrl}/manage/newpost`, { waitUntil: "domcontentloaded" });
      const bodyText = await page.locator("body").first().innerText().catch(() => "");
      const evidence = {
        url: page.url(),
        editorReady: await this.anyVisible(page, tistorySelectors.editorReady),
        loginFormVisible: await this.anyVisible(page, tistorySelectors.loginForm),
        securityRequirementVisible:
          await this.anyVisible(page, tistorySelectors.securityChallenge)
          || TISTORY_SECURITY_TEXT.test(bodyText),
        accessDeniedVisible: TISTORY_ACCESS_DENIED_TEXT.test(bodyText)
      };
      const classification = classifySessionEvidence(evidence);
      if (classification === "authenticated") {
        this.sessionVerified = true;
        return { ok: true };
      }
      if (classification === "security") {
        return {
          ok: false,
          reason: "security",
          message: "Tistory or Kakao requires manual security verification."
        };
      }
      if (classification === "missing") {
        return {
          ok: false,
          reason: "missing",
          message: "Log in to Kakao in the dedicated Chrome window and keep it open."
        };
      }
      return {
        ok: false,
        reason: "profile_error",
        message: "The configured Tistory blog editor is not accessible with this account."
      };
    } catch (error) {
      return {
        ok: false,
        reason: "profile_error",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async saveDraft(job: PostJob, options: AutomationRunOptions): Promise<AutomationResult> {
    if (!this.sessionVerified) {
      return {
        outcome: "failed",
        retryable: false,
        reason: "missing_session",
        message: "A verified Tistory session is required."
      };
    }
    try {
      const page = await this.getPage();
      await page.goto(`${this.blogUrl}/manage/newpost`, { waitUntil: "domcontentloaded" });
      await this.firstEditorBody(page, 10_000);
      const speed = getTypingSpeedProfile(options.speed);
      for (const event of job.parsed.events) {
        if (options.signal?.aborted) throw new Error("Run stopped by user");
        await this.executeEvent(page, event, speed);
        options.onLog?.(`Entered ${event.type}`);
      }
      await this.applyMetadata(page, job);
      return await this.finalizePost(page, job);
    } catch (error) {
      return {
        outcome: "failed",
        retryable: false,
        reason: "editor",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async executeEvent(page: Page, event: EditorEvent, speed: TypingSpeedProfile): Promise<void> {
    if (event.type === "setTitle") {
      await (await this.firstVisible(page, tistorySelectors.title)).fill(event.text);
      return;
    }

    const body = await this.firstEditorBody(page);
    await body.click();
    if (event.type === "typeText") {
      await page.keyboard.type(event.text, { delay: speed.keyDelayMs });
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
    } else if (event.type === "typeHeading1") {
      await (await this.firstVisible(page, tistorySelectors.formatMenu)).click();
      await (await this.firstVisible(page, tistorySelectors.heading1)).click();
      await page.keyboard.type(event.text, { delay: speed.keyDelayMs });
      await page.keyboard.press("Enter");
    } else if (event.type === "typeBold") {
      await page.keyboard.press("Control+B");
      await page.keyboard.type(event.text, { delay: speed.keyDelayMs });
      await page.keyboard.press("Control+B");
      await page.keyboard.press("Enter");
    } else if (event.type === "insertDivider") {
      await (await this.firstVisible(page, tistorySelectors.divider)).click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
    } else if (event.type === "insertImage") {
      const imagesBefore = await body.locator("img").count();
      await (await this.firstVisible(page, tistorySelectors.attach)).click();
      const chooserPromise = page.waitForEvent("filechooser");
      await (await this.firstVisible(page, tistorySelectors.photoMenuItem)).click();
      const chooser = await chooserPromise;
      await chooser.setFiles(event.absolutePath);
      await body.locator("img").nth(imagesBefore).waitFor({ state: "visible", timeout: 30_000 });
      await body.click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
    }
  }

  async applyMetadata(page: Page, job: PostJob): Promise<void> {
    const { category, tags } = job.parsed.metadata;
    if (category) {
      await (await this.firstVisible(page, tistorySelectors.categoryButton)).click();
      await page.getByText(category, { exact: true }).click();
    }
    if (tags.length) {
      const input = await this.firstVisible(page, tistorySelectors.tagInput);
      for (const tag of tags) {
        await input.fill(tag);
        await page.keyboard.press("Enter");
      }
    }
  }

  async finalizePost(page: Page, job: PostJob): Promise<AutomationResult> {
    const { publication, scheduledAt } = job.parsed.metadata;
    const status = publication === "draft" ? "draft_saved" : publication === "public" ? "published" : "scheduled";
    const finalSelector = publication === "draft" ? tistorySelectors.draftButton : tistorySelectors.completeButton;
    const draftCountBefore = publication === "draft" ? await this.readDraftCount(page) : null;
    const urlBefore = page.url();

    if (publication !== "draft") {
      await (await this.firstVisible(page, tistorySelectors.completeButton)).click();
      await (await this.firstVisible(page, tistorySelectors.publicOption)).click();
      if (publication === "scheduled" && scheduledAt) {
        await (await this.firstVisible(page, tistorySelectors.scheduleOption)).click();
        const local = scheduledAt.slice(0, 16);
        await (await this.firstVisible(page, tistorySelectors.scheduleDate)).fill(local.slice(0, 10));
        await (await this.firstVisible(page, tistorySelectors.scheduleTime)).fill(local.slice(11));
      }
    }

    const button = await this.firstVisible(page, publication === "draft" ? finalSelector : tistorySelectors.finalPublishButton);
    await button.click();
    try {
      await this.waitForFinalConfirmation(page, urlBefore, draftCountBefore, 8_000);
      const postUrl = page.url();
      return { outcome: "confirmed", status, ...(postUrl.startsWith("http") ? { postUrl } : {}) };
    } catch {
      return {
        outcome: "uncertain",
        message: "The final Tistory action was sent, but its result could not be confirmed. Check the post list before resolving this item."
      };
    }
  }

  async close(): Promise<void> {
    this.sessionVerified = false;
    // This Browser belongs to the manually launched Chrome process. Calling
    // Browser.close() would terminate the user's logged-in window.
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  private async getPage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.connectOverCDP(this.cdpEndpoint, { noDefaults: true });
      this.context = this.browser.contexts()[0] ?? null;
    }
    if (!this.context) throw new Error("The dedicated Chrome context is unavailable.");
    if (!this.page || this.page.isClosed()) {
      this.page = this.context.pages().find((candidate) => !candidate.isClosed())
        ?? await this.context.newPage();
    }
    return this.page;
  }

  private async anyVisible(page: Page, selectors: readonly string[]): Promise<boolean> {
    for (const selector of selectors) {
      if (await page.locator(selector).first().isVisible({ timeout: 250 }).catch(() => false)) {
        return true;
      }
    }
    return false;
  }

  private async firstVisible(page: Page, selectors: readonly string[], timeout = 3_000) {
    for (const selector of selectors) {
      const matches = page.locator(selector);
      const count = await matches.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const locator = matches.nth(index);
        if (await locator.isVisible({ timeout: Math.min(timeout, 500) }).catch(() => false)) return locator;
      }
    }
    throw new Error(`Tistory control not found: ${selectors.join(" | ")}`);
  }

  private async firstEditorBody(page: Page, timeout = 3_000) {
    for (const iframeSelector of tistorySelectors.editorIframe) {
      const frame = page.frameLocator(iframeSelector);
      for (const bodySelector of tistorySelectors.body) {
        const locator = frame.locator(bodySelector).first();
        if (await locator.isVisible({ timeout: Math.min(timeout, 500) }).catch(() => false)) return locator;
      }
    }
    return this.firstVisible(page, tistorySelectors.body, timeout);
  }

  private async waitForFinalConfirmation(
    page: Page,
    urlBefore: string,
    draftCountBefore: number | null,
    timeout: number
  ): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await this.anyVisible(page, tistorySelectors.success)) return;
      if (page.url() !== urlBefore && !page.url().endsWith("/manage/newpost")) return;
      if (draftCountBefore !== null) {
        const currentDraftCount = await this.readDraftCount(page);
        if (currentDraftCount !== null && currentDraftCount > draftCountBefore) return;
      }
      await page.waitForTimeout(100);
    }
    throw new Error("Tistory did not expose a verifiable completion signal.");
  }

  private async readDraftCount(page: Page): Promise<number | null> {
    for (const selector of tistorySelectors.draftCount) {
      const locator = page.locator(selector).first();
      const value = await locator.getAttribute("aria-label").catch(() => null)
        ?? await locator.innerText().catch(() => null);
      const match = value?.match(/\d+/);
      if (match) return Number(match[0]);
    }
    return null;
  }

}
