# Stability Test Procedure

Use this after a successful single draft save to verify the next stabilization stage.

## Test Workspace

Before a manual run, refresh a clean run workspace:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-manual-test-workspace.ps1 -Clean
```

Then select this folder in the app:

```text
manual-test-workspaces/runs/stability-suite
```

It contains the current quote/image/body re-entry stability suite:

```text
009-quote-then-body
010-quote-then-image-then-body
011-quote-body-reentry
012-dual-quote-basic
013-quote-image-quote
014-image-spacing-check
015-dual-image-basic
016-long-korean-body
017-short-lines-mixed
018-long-paragraph-mixed
019-long-continuation-flow
020-full-mixed-flow
```

Each folder has one `content.txt` and an `images/` folder. The clean source is `manual-test-workspaces/templates/stability-suite`; the app should use the generated `runs` folder so runtime files can be discarded safely.

## Run Order

1. Start the app with `run-dev.bat`.
2. Select `브라우저 열기 / 로그인` to open the dedicated Chrome window.
3. Complete login manually and keep that dedicated Chrome window open.
4. Select `로그인 확인` once while the dedicated Chrome window remains open.
5. Continue only when the app state is `로그인 확인 완료`. If Security Hold appears, do not clear it or test again on the same day after repeated captcha.
6. Select `manual-test-workspaces/runs/stability-suite` as the work folder.
7. Confirm the app lists twelve valid posts, or only the remaining unsaved posts if earlier folders already have `_SUCCESS.done`.
8. Set the run count to `1` and click the start button.
9. Let the one-post run finish while keeping the dedicated Chrome window open. Selecting Stop or closing the app detaches automation only; it does not close the manually launched Chrome window. Close Chrome manually when it is no longer needed.

Automated tests never contact Naver. They use local test doubles and temporary files only.

## Expected Results

- Draft runs should use the verified Naver session in the dedicated Chrome window. They should not navigate to the Naver login page or wait for another manual login.
- A repeated captcha must end manual testing for that day; do not clear Security Hold to continue.
- The selected single eligible post should be saved as a draft.
- The selected post folder should contain `_SUCCESS.done`.
- The selected post folder should contain `status.json` with `draft_saved`.
- Naver draft list should contain the expected draft title.
- `009` through `013` should verify quote content entry and quote-to-body recovery.
- `014` and `015` should verify image insertion and image-to-body recovery.
- `016` through `020` should verify longer Korean body text and mixed quote/image/body flows.
- `[BOLD]` is intentionally deferred until quote/image/image-cursor behavior is stable.

## Minimal Regression Shortcut

After a small automation change, the full suite is not always necessary. Run these first:

```text
013-quote-image-quote
015-dual-image-basic
020-full-mixed-flow
```

These cover quote re-entry, image spacing, two images, and the final mixed quote/image/body sequence.

## Failure Evidence

If a run fails, collect these from the failed post folder:

- `status.json`
- `run-log.txt`
- `automation-diagnostics/*.json`
- `automation-diagnostics/*.png`

Do not commit these runtime files to Git.

## Packaging Gate

Only start user-facing packaging after these checks pass:

- Same-account session reuse works through the dedicated-Chrome, Login Check, and retained-Chrome run sequence.
- A one-post draft save works.
- Marker coverage works.
- Failure diagnostics are understandable when a failure is forced or encountered.
