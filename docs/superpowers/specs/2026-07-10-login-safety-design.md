# Naver Login Safety Design

Date: 2026-07-10
Status: Proposed for implementation

## Goal

Reduce repeated Naver captcha and login challenges by separating manual login from browser automation, verifying the session once before a run, and stopping all automatic activity as soon as a security requirement is detected.

This design does not attempt to bypass captchas or guarantee that Naver will show at most one captcha. It minimizes avoidable browser launches, navigation, and retries after the user has completed a manual login.

## Observed Problem

The current app opens the login page inside a Playwright-controlled Chrome context. The login command returns as soon as the page is opened, without confirming that manual login and security checks have completed. Starting a run then navigates to Naver Home and checks two session cookies. If login is incomplete, stale, or followed by another security step, this extra navigation can return the user to login or captcha.

The browser profile itself is persistent and remains under Electron user data. The problem is therefore not explained by the profile being deleted on each run.

## Considered Approaches

### A. Normal Chrome login, then Playwright handoff

Launch installed Chrome as a normal user process with the app's dedicated profile. The user logs in and closes that Chrome window. The app then opens the same profile once through Playwright, verifies the session, and keeps that context for the draft run.

Advantages:

- Manual credentials and captcha entry occur before Playwright is attached.
- The existing dedicated profile and stored session can be reused.
- Login and automation cannot compete for the same profile lock.
- The implementation remains local and does not copy cookie values.

Trade-off:

- The user must close the manual login Chrome window before session verification.

### B. Attach to a user-launched Chrome through remote debugging

Launch Chrome with a debugging port and attach Playwright after login.

Advantages:

- The browser can remain open between login and automation.

Trade-offs:

- Remote debugging adds profile, port, and process lifecycle complexity.
- A debugging-enabled browser is still distinguishable from an ordinary browser.
- Failures are harder to explain and recover from safely.

### C. Keep Playwright login and add stronger checks

Continue opening login in the Playwright context, but wait for a stable authenticated state before enabling Start.

Advantages:

- Smallest code change.

Trade-off:

- Manual login still occurs in an automation-controlled browser, so it does not address the user's primary concern.

## Decision

Use approach A: normal Chrome login followed by a single Playwright session verification and handoff.

## Login State Model

The main process owns a login state with these values:

```text
unverified       No session verification has completed in this app run.
login_open       Normal Chrome is open with the dedicated profile.
checking         The app is performing one session verification.
ready            The session is verified and the automation context is retained.
security_hold    Login, captcha, identity verification, or another security screen was detected.
```

Allowed transitions:

```text
unverified -> login_open -> checking -> ready
unverified -> checking -> ready
checking -> security_hold
ready -> security_hold
ready -> unverified          when the retained browser context is lost
security_hold -> unverified  only through an explicit user reset
```

Starting a draft run is allowed only in `ready`.

## Manual Login Flow

1. The user selects `브라우저 열기 / 로그인`.
2. The app closes any inactive Playwright context before opening Chrome.
3. The app starts installed Google Chrome with the existing dedicated profile path and Naver Home URL.
4. The app enters `login_open` and disables draft execution.
5. The user completes login or captcha manually.
6. The user closes the dedicated Chrome window.
7. The user selects `로그인 확인`.
8. The app opens one Playwright persistent context with the same profile.
9. The app performs one Naver Home navigation and checks the authenticated page state and required session cookies.
10. On success, the app enters `ready` and retains the same context for the draft run.
11. If no authenticated session exists, the app closes the context and returns to `unverified` without retrying.
12. If captcha or another security requirement is detected, the app closes the context and enters `security_hold` without retrying or navigating again.

If a previously verified session is expected to exist, the user may select `기존 로그인 확인` directly without opening the manual login browser. This still performs at most one verification attempt.

## Profile Ownership

Normal Chrome and Playwright must never use the dedicated profile at the same time.

- Session verification is disabled while the manual Chrome process is running.
- Manual login is disabled while a run or verification is active.
- A profile-in-use launch error is reported as a local browser-state problem and is never retried automatically.
- Cookie values, passwords, and captcha contents are never logged or copied.

## Security Hold

The app enters `security_hold` when any of these are observed:

- Captcha or automatic-input-prevention content.
- Identity, device, or security verification content.
- A login URL, visible login form, or required session-cookie loss during an active draft run after the session was verified.

A normal login page found during an explicit session check means only that login has not completed. It returns the app to `unverified`; it does not create a security hold by itself.

While held:

- Start, login verification, and automatic navigation are disabled.
- No post or browser retry occurs.
- The UI explains that Naver requested security confirmation and recommends stopping for the day after repeated challenges.
- The hold is stored under Electron user data so restarting the app does not silently resume automation.
- The user must explicitly select `보안 대기 해제` before another manual login attempt.

## Run Retry Policy

Remove full-post automatic retries. Each post receives one `saveDraft` call.

This prevents a partial editor failure from reopening the write page and repeating login, navigation, title entry, or body entry. A future retry may be introduced only for a specifically classified failure that occurs before editor input starts and has a focused automated test.

## UI Changes

- Show the current login state in Korean.
- Split `브라우저 열기 / 로그인` and `로그인 확인` into separate commands.
- Disable Start unless the state is `ready`, a valid workspace exists, and at least one pending post exists.
- Change the default run count from `전체` to `1개`.
- Show `보안 확인 감지 - 자동 실행 중지됨` for `security_hold`.
- Keep technical cookie and profile details out of the normal UI.

## Components

### ManualChromeLoginLauncher

- Locates installed Google Chrome on Windows.
- Launches it with the dedicated `--user-data-dir` and Naver Home URL.
- Tracks whether the launched process has exited.
- Does not inspect or modify Naver content.

### LoginSessionCoordinator

- Owns the login state transitions.
- Prevents overlapping manual Chrome and Playwright ownership.
- Persists and clears `security_hold`.
- Exposes state to Electron IPC.

### NaverBlogAutomation

- No longer opens the manual login page.
- Adds a one-shot session verification operation.
- Retains a verified context for draft execution.
- Reports a typed security result instead of a generic retryable error.

## IPC Changes

Replace the single login command with explicit operations:

```text
login:getState
login:openManual
login:verify
login:clearSecurityHold
```

`run:start` checks the coordinator state in the main process. Renderer state alone is never trusted as authorization to run.

## Error Handling

- Chrome not found: explain that Google Chrome must be installed; do not fall back to an automation browser for login.
- Manual Chrome still open: ask the user to close it before verification; do not force-close it.
- Session missing: return to `unverified` without retrying.
- Security requirement: enter `security_hold` immediately.
- Playwright context lost: return to `unverified` and stop the current run.
- Local profile error: report the error and remain `unverified`.

## Testing

Automated tests must cover:

- Chrome executable resolution and launch arguments without starting Chrome.
- Login state transitions and invalid transition rejection.
- Verification blocked while manual Chrome is running.
- Draft run blocked unless login state is `ready`.
- Security detection persists `security_hold` and prevents retries.
- Clearing the hold requires an explicit command.
- A failed post invokes `saveDraft` exactly once.
- Default UI run count is one.

No automated test may connect to Naver or attempt a real login. Live verification remains a manual test and should begin only after the account no longer shows repeated security challenges.

## Acceptance Criteria

- Manual login opens in normal installed Chrome using the dedicated persistent profile.
- The app never verifies the profile while manual Chrome is still open.
- Start remains disabled until a single explicit verification succeeds.
- The verified Playwright context is reused for the run without another login navigation.
- Any detected login or security requirement stops immediately and creates a persistent hold.
- No post is automatically attempted more than once.
- Existing parser, loader, status, and non-live tests continue to pass.
