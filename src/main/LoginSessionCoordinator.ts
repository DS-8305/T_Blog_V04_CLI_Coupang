import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutomationEngine } from "../automation/AutomationEngine";
import type {
  LoginActionResult,
  LoginState,
  LoginStateSnapshot,
  SessionVerificationResult
} from "../shared/types";
import type { ManualChromeLoginLauncher } from "./ManualChromeLoginLauncher";

type VerifiedAutomation = Omit<AutomationEngine, "openLoginWindow"> & {
  verifySession(): Promise<SessionVerificationResult>;
};

type SecurityHold = {
  heldAt: string;
  message: string;
};

export type LoginSessionCoordinatorDependencies = {
  launcher: Pick<ManualChromeLoginLauncher, "open" | "isRunning" | "getCdpEndpoint">;
  createAutomation: (cdpEndpoint: string) => VerifiedAutomation;
  profilePath: string;
  holdPath: string;
};

export class LoginSessionCoordinator {
  private readonly launcher: LoginSessionCoordinatorDependencies["launcher"];
  private readonly createAutomation: LoginSessionCoordinatorDependencies["createAutomation"];
  private readonly profilePath: string;
  private readonly holdPath: string;
  private automation?: VerifiedAutomation;
  private state: LoginState = "unverified";
  private message = "Login session has not been verified";
  private openingManualLogin = false;
  private verificationGeneration = 0;

  constructor(dependencies: LoginSessionCoordinatorDependencies) {
    this.launcher = dependencies.launcher;
    this.createAutomation = dependencies.createAutomation;
    this.profilePath = dependencies.profilePath;
    this.holdPath = dependencies.holdPath;
  }

  async initialize(): Promise<LoginStateSnapshot> {
    try {
      const hold = await this.readPersistedSecurityHold();
      if (!hold) {
        return this.getState();
      }
      this.invalidateVerification();
      if (!(await this.closeAutomation())) {
        return this.getState();
      }
      this.state = "security_hold";
      this.message = hold.message;
    } catch (error) {
      await this.closeAutomation();
      this.state = "security_hold";
      this.message = "A security hold could not be read and requires explicit clearance";
    }

    return this.getState();
  }

  getState(): LoginStateSnapshot {
    return {
      state: this.state,
      message: this.message,
      manualChromeRunning: this.launcher.isRunning()
    };
  }

  async openManualLogin(): Promise<LoginActionResult> {
    if (
      this.openingManualLogin ||
      this.state === "checking" ||
      this.state === "ready" ||
      this.state === "security_hold"
    ) {
      return this.failure();
    }

    if (this.launcher.isRunning()) {
      this.state = "login_open";
      this.message = "Manual Chrome login is already open. Keep this Chrome window open while you verify and run.";
      return this.failure();
    }

    this.openingManualLogin = true;
    this.state = "login_open";
    this.message = "Manual Chrome login is open. Sign in and keep this Chrome window open while you verify and run.";

    try {
      if (this.automation) {
        if (!(await this.closeAutomation())) {
          return this.failure();
        }
      }
      await this.launcher.open(this.profilePath);
      return this.success();
    } catch (error) {
      this.state = "unverified";
      this.message = this.errorMessage(error, "Unable to open manual Chrome login");
      return this.failure();
    } finally {
      this.openingManualLogin = false;
    }
  }

  async verifySession(): Promise<LoginActionResult> {
    if (
      this.openingManualLogin ||
      this.state === "checking" ||
      this.state === "ready" ||
      this.state === "security_hold"
    ) {
      return this.failure();
    }

    if (!this.launcher.isRunning()) {
      this.state = "unverified";
      this.message = "Open the dedicated Chrome window, sign in, and keep it open to verify and run.";
      return this.failure();
    }

    const cdpEndpoint = this.launcher.getCdpEndpoint();
    if (!cdpEndpoint) {
      this.state = "unverified";
      this.message = "The dedicated Chrome connection is unavailable. Reopen Chrome and keep it open to verify and run.";
      return this.failure();
    }

    this.state = "checking";
    this.message = "Verifying login session";
    const verificationGeneration = ++this.verificationGeneration;

    let verification: SessionVerificationResult;
    let automation: VerifiedAutomation | undefined;
    try {
      automation = this.createAutomation(cdpEndpoint);
      this.automation = automation;
      verification = await automation.verifySession();
    } catch (error) {
      if (!this.isCurrentVerification(verificationGeneration, automation)) {
        return this.failure();
      }
      if (!(await this.closeAutomation()) || !this.isCurrentVerification(verificationGeneration)) {
        return this.failure();
      }
      this.state = "unverified";
      this.message = this.errorMessage(error, "Unable to verify the login session");
      return this.failure();
    }

    if (!this.isCurrentVerification(verificationGeneration, automation)) {
      return this.failure();
    }

    if (verification.ok) {
      this.state = "ready";
      this.message = "Login session verified";
      return this.success();
    }

    if (verification.reason === "security") {
      await this.enterSecurityHold(verification.message);
      return this.failure();
    }

    if (!(await this.closeAutomation()) || !this.isCurrentVerification(verificationGeneration)) {
      return this.failure();
    }
    this.state = "unverified";
    this.message = verification.message;
    return this.failure();
  }

  requireReadyAutomation(): VerifiedAutomation {
    if (this.state !== "ready" || !this.automation) {
      throw new Error("No verified automation is ready");
    }

    return this.automation;
  }

  async enterSecurityHold(message: string): Promise<LoginStateSnapshot> {
    this.invalidateVerification();
    this.state = "security_hold";
    this.message = message;
    if (!(await this.closeAutomation())) {
      return this.getState();
    }
    await this.persistSecurityHold(message);
    return this.getState();
  }

  async clearSecurityHold(): Promise<LoginStateSnapshot> {
    this.invalidateVerification();
    if (this.automation && !(await this.closeAutomation())) {
      return this.getState();
    }

    for (const holdPath of this.securityHoldPaths()) {
      try {
        await unlink(holdPath);
      } catch (error) {
        if (!this.isMissingFile(error)) {
          throw error;
        }
      }
    }

    if (this.state === "security_hold") {
      this.state = "unverified";
      this.message = "Login session has not been verified";
    }

    return this.getState();
  }

  async close(): Promise<void> {
    this.invalidateVerification();
    await this.closeAutomation();
    if (this.state !== "security_hold") {
      this.state = "unverified";
      this.message = "Login session has not been verified";
    }
  }

  private async closeAutomation(): Promise<boolean> {
    const automation = this.automation;
    if (!automation) {
      return true;
    }

    try {
      await automation.close();
      if (this.automation === automation) {
        this.automation = undefined;
      }
      return true;
    } catch (error) {
      if (this.automation === automation) {
        this.invalidateVerification();
        this.state = "security_hold";
        this.message = this.errorMessage(error, "Unable to close verification automation");
        await this.persistSecurityHold(this.message).catch(() => undefined);
      }
      return false;
    }
  }

  private success(): LoginActionResult {
    return { ok: true, snapshot: this.getState() };
  }

  private failure(): LoginActionResult {
    return { ok: false, snapshot: this.getState() };
  }

  private parseSecurityHold(serializedHold: string): SecurityHold {
    const hold = JSON.parse(serializedHold) as Partial<SecurityHold>;
    if (typeof hold.message !== "string" || !hold.message) {
      throw new Error("Security hold message is missing");
    }

    return {
      heldAt: typeof hold.heldAt === "string" ? hold.heldAt : "",
      message: hold.message
    };
  }

  private isCurrentVerification(generation: number, automation?: VerifiedAutomation): boolean {
    return (
      generation === this.verificationGeneration &&
      this.state === "checking" &&
      (automation === undefined || this.automation === automation)
    );
  }

  private invalidateVerification(): void {
    this.verificationGeneration += 1;
  }

  private async persistSecurityHold(message: string): Promise<void> {
    const serializedHold = JSON.stringify({ heldAt: new Date().toISOString(), message } satisfies SecurityHold);
    const [primaryPath, fallbackPath] = this.securityHoldPaths();

    try {
      await this.writeSecurityHold(primaryPath, serializedHold);
      return;
    } catch (primaryError) {
      try {
        await this.writeSecurityHold(fallbackPath, serializedHold);
      } catch (fallbackError) {
        throw new Error(
          `Unable to persist security hold: ${this.errorMessage(primaryError, "primary hold failed")}; ${this.errorMessage(fallbackError, "fallback hold failed")}`
        );
      }
    }
  }

  private async readPersistedSecurityHold(): Promise<SecurityHold | undefined> {
    let readError: unknown;

    for (const holdPath of this.securityHoldPaths()) {
      try {
        return this.parseSecurityHold(await readFile(holdPath, "utf8"));
      } catch (error) {
        if (!this.isMissingFile(error)) {
          readError = error;
        }
      }
    }

    if (readError) {
      throw readError;
    }

    return undefined;
  }

  private securityHoldPaths(): [string, string] {
    return [this.holdPath, path.join(this.profilePath, "security-hold.json")];
  }

  private async writeSecurityHold(holdPath: string, serializedHold: string): Promise<void> {
    await mkdir(path.dirname(holdPath), { recursive: true });
    await writeFile(holdPath, serializedHold, "utf8");
  }

  private isMissingFile(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
  }

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
