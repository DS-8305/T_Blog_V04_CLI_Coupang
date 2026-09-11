import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
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
  private verifiedEditorReady = false;
  private dialogManagedPages = new WeakSet<Page>();

  private constructor(
    private readonly cdpEndpoint: string,
    private readonly blogUrl: string
  ) {}

  static attach(cdpEndpoint: string, blogUrl: string): TistoryBlogAutomation {
    return new TistoryBlogAutomation(cdpEndpoint, blogUrl.replace(/\/$/, ""));
  }

  async verifySession(): Promise<SessionVerificationResult> {
    this.sessionVerified = false;
    this.verifiedEditorReady = false;
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
        this.verifiedEditorReady = true;
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
      if (!this.verifiedEditorReady) {
        await page.goto(`${this.blogUrl}/manage/newpost`, { waitUntil: "domcontentloaded" });
      }
      this.verifiedEditorReady = false;
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
    await body.press("Control+End");
    if (event.type === "typeText") {
      await page.keyboard.type(event.text, { delay: speed.keyDelayMs });
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
    } else if (event.type === "typeHeading1") {
      await (await this.firstVisible(page, tistorySelectors.formatMenu)).dispatchEvent("click");
      await page.waitForTimeout(300);
      await (await this.firstVisible(page, tistorySelectors.heading1)).click({ force: true });
      await page.keyboard.press("Control+B");
      await page.keyboard.type(event.text, { delay: speed.keyDelayMs });
      await page.keyboard.press("Control+B");
      await page.keyboard.press("Enter");
    } else if (event.type === "typeBold") {
      await page.keyboard.press("Control+B");
      await page.keyboard.type(event.text, { delay: speed.keyDelayMs });
      await page.keyboard.press("Control+B");
      await page.keyboard.press("Enter");
    } else if (event.type === "insertDivider") {
      await (await this.firstVisible(page, tistorySelectors.divider)).dispatchEvent("click");
      await page.waitForTimeout(300);
      await (await this.firstVisible(page, tistorySelectors.dividerStyle1)).click({ force: true });
      await body.press("Control+End");
      await body.press("Enter");
    } else if (event.type === "insertImage") {
      const imagesBefore = await body.locator("img").count();
      await page.waitForTimeout(1_500);
      const attachButton = await this.firstVisible(page, tistorySelectors.attach);
      await attachButton.evaluate((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      });
      let photoMenuItem: Locator | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await attachButton.click({ force: true });
        await page.waitForTimeout(300);
        try {
          photoMenuItem = await this.firstVisible(page, tistorySelectors.photoMenuItem, 500);
          break;
        } catch {
          // Tistory occasionally ignores a click while its sticky toolbar is moving.
        }
        if (attempt < 2) await page.waitForTimeout(500);
      }
      if (!photoMenuItem) {
        throw new Error(`Tistory control not found: ${tistorySelectors.photoMenuItem.join(" | ")}`);
      }
      const chooserPromise = page.waitForEvent("filechooser");
      await photoMenuItem.click({ force: true });
      const chooser = await chooserPromise;
      await chooser.setFiles(event.absolutePath);
      await body.locator("img").nth(imagesBefore).waitFor({ state: "visible", timeout: 30_000 });
      await body.press("Control+End");
      await body.press("Enter");
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
    await button.click({ force: true });
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
    this.verifiedEditorReady = false;
    const browser = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;
    // connectOverCDP owns only the attachment: close disconnects its transport
    // while leaving the externally launched Chrome and its tabs running.
    await browser?.close();
  }

  private async getPage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.connectOverCDP(this.cdpEndpoint);
      this.context = this.browser.contexts()[0] ?? null;
    }
    if (!this.context) throw new Error("The dedicated Chrome context is unavailable.");
    if (!this.page || this.page.isClosed()) {
      this.page = this.context.pages().find((candidate) => !candidate.isClosed())
        ?? await this.context.newPage();
    }
    this.manageDialogs(this.page);
    return this.page;
  }

  private manageDialogs(page: Page): void {
    if (this.dialogManagedPages.has(page)) return;
    this.dialogManagedPages.add(page);
    page.on("dialog", async (dialog) => {
      try {
        if (dialog.type() === "beforeunload") await dialog.accept();
        else await dialog.dismiss();
      } catch {
        // Another Chrome client may handle the same dialog first.
      }
    });
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
    const deadline = Date.now() + timeout;
    do {
      for (const selector of selectors) {
        const matches = page.locator(selector);
        const count = await matches.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          const locator = matches.nth(index);
          if (await locator.isVisible({ timeout: Math.min(timeout, 500) }).catch(() => false)) return locator;
        }
      }
      if (Date.now() >= deadline) break;
      await page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new Error(`Tistory control not found: ${selectors.join(" | ")}`);
  }

  private async firstEditorBody(page: Page, timeout = 3_000) {
    const deadline = Date.now() + timeout;
    do {
      const remaining = Math.max(1, deadline - Date.now());
      for (const iframeSelector of tistorySelectors.editorIframe) {
        const frame = page.frameLocator(iframeSelector);
        for (const bodySelector of tistorySelectors.body) {
          const locator = frame.locator(bodySelector).first();
          if (await locator.isVisible({ timeout: Math.min(remaining, 500) }).catch(() => false)) return locator;
        }
      }
      try {
        return await this.firstVisible(page, tistorySelectors.body, Math.min(remaining, 500));
      } catch {
        // TinyMCE can appear shortly after the title field becomes ready.
      }
      if (Date.now() >= deadline) break;
      await page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new Error(`Tistory control not found: ${tistorySelectors.body.join(" | ")}`);
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
      // Optional evidence must not auto-wait for a missing counter (twice per
      // probe with getAttribute/innerText). Snapshot both values in one call.
      const values = await locator.evaluateAll(elements => {
        const element = elements[0];
        return element ? [element.getAttribute("aria-label"), element.textContent] : [];
      }).catch(() => []);
      for (const value of values) {
        const match = value?.match(/\d+/);
        if (match) return Number(match[0]);
      }
    }
    return null;
  }

}
