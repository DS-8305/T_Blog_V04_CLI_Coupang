# Packaging Prep

This project is still in stabilization. Do not package a user-facing installer until the draft flow is stable across several manual runs.

## Current Safe Check

Run these before any packaging attempt:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-local-runtime.ps1
.\.local\runtime\node-v22.*-win-x64\pnpm.cmd test
.\.local\runtime\node-v22.*-win-x64\pnpm.cmd run build
```

## Manual Stability Gate

Package only after these pass without new code changes:

- Select `브라우저 열기 / 로그인` to open the dedicated Chrome window.
- Complete login manually and keep that dedicated Chrome window open.
- Select `로그인 확인` once while the dedicated Chrome window remains open, and continue only when the state is `로그인 확인 완료`.
- If Security Hold appears, do not clear it or test again on the same day after repeated captcha.
- Prepare a clean run workspace:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-manual-test-workspace.ps1 -Clean
```

- Select `manual-test-workspaces/runs/stability-suite`.
- Run 009 with run count `1` first.
- Confirm the single draft save completes.
- Confirm the browser remains open after completion.
- Confirm that selecting Stop or closing the app detaches automation without closing the manually launched Chrome window; close Chrome manually when it is no longer needed.
- Delete `_SUCCESS.done` from one completed run folder, refresh, and run it again without logging in.
- Confirm quote text enters the quote content area, not the source field.
- Confirm image insertion and text after image still work.
- Run the personal smoke suite with run count `1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-manual-test-workspace.ps1 -TemplatePath "manual-test-workspaces\templates\personal-smoke-suite" -RunPath "manual-test-workspaces\runs\personal-smoke-suite" -Clean
```

- Select `manual-test-workspaces/runs/personal-smoke-suite`.
- Confirm one selected post saves as a draft without closing the browser.

Automated tests never contact Naver. Manual checks are the only steps that use a real Naver session.

## Packaging Direction

Use an Electron packager only after the manual stability gate passes. The recommended next step is adding `electron-builder` with a Windows portable target first, then an installer target later.
