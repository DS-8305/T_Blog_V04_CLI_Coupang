# Personal Stability Baseline

This project is currently optimized for one local user. Keep the automation flow light: avoid extra runtime panels, continuous screenshots, or heavy diagnostics unless a failure occurs.

## Confirmed Stable Flow

The following manual stability cases were confirmed during the July 2026 stabilization pass:

- `011-quote-body-reentry`: quote content area entry, then normal body re-entry.
- `012-dual-quote-basic`: two quote blocks in one post, with normal body text between and after them.
- `013-quote-image-quote`: quote, image, normal body, quote, normal body.
- `014-image-spacing-check`: image insertion followed by normal body text.
- `015-dual-image-basic`: two image insertions, each followed by normal body text.
- `016-long-korean-body`: long Korean body text with quote and image markers.
- `017-short-lines-mixed`: short multi-line Korean text with quote and image markers.
- `018-long-paragraph-mixed`: long paragraph, quote, image, and body recovery.
- `019-long-continuation-flow`: longer continuation flow with two quotes.
- `020-full-mixed-flow`: title, body, quote, image, body, image, quote, body.

## Minimal Regression Set

When code changes touch editor focus, quote handling, image insertion, or run orchestration, manually retest only these first:

```text
013-quote-image-quote
015-dual-image-basic
020-full-mixed-flow
```

Use run count `1` for each test while debugging. Use run count `3` only after the individual tests pass.

## Personal Smoke Test

For real-use confidence without running the full stability suite, use:

```text
manual-test-workspaces/templates/personal-smoke-suite
```

Prepare a disposable run folder with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-manual-test-workspace.ps1 -TemplatePath "manual-test-workspaces\templates\personal-smoke-suite" -RunPath "manual-test-workspaces\runs\personal-smoke-suite" -Clean
```

Then select:

```text
manual-test-workspaces/runs/personal-smoke-suite
```

Run count recommendation:

- `1` when testing a recent fix.
- `3` when checking the full personal smoke suite.

## Commit Baseline

Commit when one of these is true:

- A meaningful manual stability case passes after a code change.
- `pnpm test` and `pnpm run build` pass after an automation fix.
- A new stable manual baseline is documented.

Do not commit runtime artifacts such as `_SUCCESS.done`, `status.json`, `run-log.txt`, or `automation-diagnostics/`.

## Packaging Gate

Delay packaging until all are true:

- Minimal regression set passes after the latest code change.
- Personal smoke suite passes with run count `3`.
- Browser remains open after successful draft saves.
- Login is handled by the existing manual session, not by repeated automated login attempts.
