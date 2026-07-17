# Attached Chrome Login Design

## Goal

Use the same dedicated Chrome instance for manual Naver login, login verification, and draft automation so Naver's active session is never copied or reopened by a second browser process.

## User Flow

1. The user selects a workspace and chooses `Open Browser / Login`.
2. The app starts a dedicated Chrome profile with a loopback-only Chrome DevTools Protocol endpoint.
3. The user completes Naver login in that Chrome window and leaves it open.
4. The user chooses `Verify Login`.
5. The app attaches Playwright to the already-running Chrome, verifies the session, and enables `Start` only after success.
6. The draft run uses the attached browser context.
7. Stopping a run or closing the app releases automation ownership without closing the manually opened Chrome window.

## Architecture

### Dedicated Chrome Launcher

- Continue using the app-owned non-default profile directory.
- Start Chrome with `--remote-debugging-address=127.0.0.1` and the fixed app-owned port `9222`.
- If port `9222` is unavailable, reject the login launch with an explicit port-conflict message.
- Expose the endpoint only after Chrome is running. The endpoint must never bind to a network interface.
- Reject a second manual-login launch while the dedicated Chrome process is alive.

### Attached Automation

- Add an attached-browser construction path to `NaverBlogAutomation`.
- Connect with Playwright `chromium.connectOverCDP` using the loopback endpoint and retain the existing default context.
- Do not create a new browser context, launch a second Chrome, or use cookie copying.
- Use `noDefaults: true` so Playwright does not modify the user's existing default context settings.
- On automation cleanup, detach from the CDP connection without issuing a Chrome shutdown or closing the existing browser context.

### Session Coordinator

- Permit verification only while the launcher reports the dedicated Chrome as running.
- Keep the `login_open` state until successful verification changes it to `ready`.
- A closed Chrome window before or during verification returns the state to `unverified` with a Korean action message.
- Preserve the existing security-hold behavior for Naver security or captcha evidence.

## Error Handling

- CDP endpoint unavailable: report that the login Chrome must remain open and do not retry automatically.
- Connection loss during a run: stop the run, release automation state, and require a new manual login check.
- Security challenge: enter the persisted security hold. Do not retry login or submissions.
- App stop/exit: detach only; the user decides when to close the dedicated Chrome.

## Verification

- Unit-test Chrome launch arguments and loopback endpoint ownership.
- Unit-test attached connection selection, retained default context, and detach-only cleanup.
- Unit-test coordinator transitions for Chrome-open verification, lost connection, security hold, and run gating.
- Run the full Vitest suite and production build.
- Do not perform live Naver login or posting as automated verification.
