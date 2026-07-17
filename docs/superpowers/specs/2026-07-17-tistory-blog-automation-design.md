# Tistory Blog Automation Design

Date: 2026-07-17
Status: Approved

## 1. Goal

Adapt `DS-8305/N_Blog_V06` into a Windows desktop application for a single Tistory blog. The application reads posts from local folders, enters their content through Tistory's web editor, and saves each post as a draft, publishes it immediately, or schedules it for public publication.

The application must preserve the original project's Electron, React, TypeScript, Playwright, workspace, validation, orchestration, logging, and portable-packaging concepts where they remain useful. Naver-specific login, selectors, editor operations, and naming are replaced with Tistory-specific implementations.

## 2. Confirmed Scope

- One Kakao account and one Tistory blog.
- Windows Electron desktop application and portable `.exe` output.
- Playwright controls Tistory through a dedicated Chrome instance.
- The user completes Kakao login manually. The application never requests, enters, or stores a password.
- The target blog URL is entered once and stored in application settings.
- One post equals one folder containing `content.txt`, optional images, status, logs, and diagnostics.
- The existing marker-based text format is retained and extended with Tistory publication metadata.
- Each post can be saved as a draft, published publicly now, or scheduled for public publication.
- Before a run, one confirmation screen summarizes all draft, public, and scheduled actions.
- A failed or uncertain post stops the run; the application does not continue to later posts.

## 3. Non-Goals

- Multiple Kakao accounts or multiple Tistory blogs.
- Storing or automatically entering Kakao credentials.
- Bypassing login verification, CAPTCHA, security challenges, or account protections.
- Using discontinued Tistory Open API endpoints or undocumented private publishing endpoints.
- Supporting arbitrary Word, Markdown, or HTML inputs in the first version.
- Automatically retrying an uncertain final publication action.
- Cloud synchronization or unattended remote execution.

## 4. Application Architecture

### 4.1 Desktop UI

The Electron/React UI provides:

- Workspace selection and post scanning.
- One-time target blog URL entry and persistence.
- Dedicated Chrome launch and login verification.
- Post list with titles, validation results, publication modes, categories, and schedule times.
- Typing speed and run-count controls; the default run count is one.
- A pre-run confirmation screen summarizing every intended action.
- Start, safe stop, refresh, and security-hold controls.
- A review-resolution control for posts whose final submission result is uncertain.
- Live logs, post statuses, and actionable failure details.

### 4.2 Post Loader and Parser

The loader scans `posts/*/content.txt`, ignores completed posts, resolves local image paths, and loads status files. The parser converts supported markers into a platform-independent post model and ordered editor events. It contains no Tistory selectors or browser logic.

### 4.3 Tistory Automation Engine

The engine attaches Playwright to the application-owned Chrome instance, opens the configured blog's new-post editor, executes editor events, applies category and tags, and performs the selected draft/public/scheduled action.

### 4.4 Login Session Coordinator

The coordinator launches Chrome with an application-owned profile and a loopback-only debugging endpoint. The user logs in manually and leaves Chrome open. Verification confirms both Tistory authentication and write access to the configured blog. Automation attaches to the already-running browser and detaches without closing the user's Chrome window.

### 4.5 Run Orchestrator

The orchestrator processes eligible posts sequentially, applies bounded retry policies, records statuses and logs, supports safe user cancellation, and stops on the first unresolved or uncertain outcome.

## 5. Workspace and Input Format

```text
workspace/
  posts/
    001-first-post/
      content.txt
      images/
        hero.png
      status.json
      run-log.txt
      automation-diagnostics/
```

Example `content.txt`:

```text
[TITLE]제목입니다[/TITLE]
[PUBLISH]scheduled[/PUBLISH]
[CATEGORY]여행[/CATEGORY]
[TAGS]서울, 맛집, 주말여행[/TAGS]
[SCHEDULE]2026-07-20 09:00[/SCHEDULE]

일반 본문입니다.

[H2]첫 번째 소제목[/H2]

본문 내용입니다.

[BOLD]강조할 문장[/BOLD]

[HR]

[IMAGE:images/hero.png]
```

### 5.1 Metadata Markers

- `[TITLE]...[/TITLE]` is required and must be non-empty.
- `[PUBLISH]...[/PUBLISH]` accepts `draft`, `public`, or `scheduled`. When omitted, it defaults to `draft`.
- `[CATEGORY]...[/CATEGORY]` is optional. When omitted, the blog's default category is used.
- `[TAGS]...[/TAGS]` is optional and contains comma-separated tags. Empty items are discarded and surrounding whitespace is trimmed.
- `[SCHEDULE]...[/SCHEDULE]` is required only for `scheduled` posts. It uses `YYYY-MM-DD HH:mm` in the Asia/Seoul time zone and must be in the future when preflight validation runs.

### 5.2 Body Markers and Events

- Normal text becomes a body paragraph event.
- `[H2]...[/H2]` becomes a separate heading event. Automation applies Tistory's `제목1` style, and verification expects an H2 result.
- `[BOLD]...[/BOLD]` becomes a bold-text event.
- `[HR]` becomes a divider event.
- `[IMAGE:relative/path]` becomes a local image-upload event resolved relative to the post folder.
- `[QUOTE]` is unsupported. Validation reports an explicit instruction to replace it with `[H2]`.

Unknown, malformed, unclosed, or incorrectly nested markers are validation errors.

## 6. Validation

Local preflight validation checks:

- `content.txt` exists and is readable.
- A non-empty title exists.
- Publication mode is recognized.
- A scheduled post has a valid future schedule time.
- A non-scheduled post does not require a schedule time; if one is supplied, it is reported as inconsistent input rather than silently used.
- All referenced image files exist and are readable.
- All markers are supported, well-formed, and correctly paired.
- At least one eligible post exists.

After login verification, remote preflight checks:

- The authenticated account can open the configured blog's write screen.
- Every explicitly named category exists in the current blog category list.
- The editor is reachable and ready before the confirmation screen enables execution.

Posts with validation errors remain visible but are excluded from the confirmation and run.

## 7. User and Data Flow

1. The user opens the application and selects a workspace.
2. On first use, the user enters the one target blog URL; the application stores only this URL and non-secret settings.
3. The application scans and locally validates all post folders.
4. The user opens the dedicated Chrome window and completes Kakao login manually.
5. The user chooses login verification. The application attaches to that Chrome instance, verifies Tistory authentication, write access, editor readiness, and configured categories.
6. The application displays a confirmation summary with each title, publication mode, category, and schedule time.
7. The user confirms once. The orchestrator processes eligible posts sequentially.
8. For each post, the engine opens a fresh new-post editor, enters content, applies metadata, executes the requested publication action, verifies the outcome, and records status and logs.
9. The run ends after all selected posts complete, the user stops it, or one post fails or becomes uncertain.

## 8. Per-Post Editor Procedure

1. Open the configured blog's new-post editor and wait for editor readiness.
2. Enter the title.
3. Execute body events in source order:
   - Type normal paragraphs.
   - Type H2 text in its own block and apply `제목1`.
   - Type bold text and apply bold formatting.
   - Insert dividers.
   - Upload images and wait for their rendered editor representation.
4. Apply the category and tags.
5. Execute the requested publication action:
   - `draft`: use Tistory's draft-save operation.
   - `public`: choose public visibility and publish immediately.
   - `scheduled`: choose public scheduled publication and set the validated Asia/Seoul date and time.
6. Verify a Tistory success indication, navigation result, or post identifier appropriate to the action.
7. Write the final status and log before opening a fresh editor for the next post.

Clicking a button alone is never sufficient evidence of success.

## 9. Publication Confirmation

Immediately before a run, the UI presents one confirmation screen containing:

- Total post count and counts by draft, public, and scheduled action.
- Each post's folder, title, publication mode, category or default-category indicator, and schedule time where applicable.
- Clear visual distinction for public and scheduled actions.

The start action remains disabled until validation, login verification, write-access verification, category verification, and confirmation all succeed. Editing the workspace or publication inputs invalidates the previous confirmation and requires a new one.

## 10. Retry, Failure, and Duplicate-Prevention Policy

- General pre-submission focus or click failures: retry up to two times.
- Editor loading failure: refresh and retry once.
- Image upload failure: retry that image once.
- Login expiration, Kakao security verification, CAPTCHA, or access loss: stop immediately without automatic retry.
- User stop: stop at the nearest safe point and persist the current state.
- Any unresolved post failure: stop the entire run and do not proceed to later posts.

Final submission has a stricter boundary:

- Before the final draft/public/scheduled action, bounded retries are allowed for safe editor operations.
- After the final action is triggered, an unclear result must never cause an automatic second submission.
- An unclear result becomes `needs_review`; the application stops and directs the user to inspect the Tistory post list.
- A `needs_review` post cannot run again until the user explicitly resolves its status in the application.
- After inspecting the Tistory post list, the user chooses either `already created` or `not created`. `Already created` records the matching terminal status (`draft_saved`, `published`, or `scheduled`); `not created` resets the post to `pending`. The action, time, and user-selected outcome are appended to the post log.
- Completed `draft_saved`, `published`, and `scheduled` posts are automatically excluded from later runs.

Failure diagnostics are stored under the post's `automation-diagnostics` folder and may include a screenshot, current URL, error message, and selector candidate counts. Diagnostic collection must not hide the original error.

## 11. Status Model

```text
pending
validation_error
running
draft_saved
published
scheduled
needs_review
failed
stopped
```

`status.json` records the status, timestamps, message, publication mode, and any confirmed post identifier or URL. `run-log.txt` contains timestamped human-readable activity and failure messages.

## 12. Testing Strategy

### 12.1 Automated Tests

- Metadata and body-marker parsing, including H2 events.
- Explicit `[QUOTE]` migration error.
- Missing title, malformed markers, unsupported publication modes, image paths, and schedule validation.
- The `scheduled`-only schedule requirement and Asia/Seoul future-time handling.
- Post loading, completed-post exclusion, and status persistence.
- Sequential orchestration, run limits, safe stop, retry limits, and first-failure stop.
- The final-action boundary and `needs_review` duplicate-prevention behavior.
- Dedicated Chrome launch arguments, loopback endpoint, attach/detach behavior, and session state transitions.
- UI gating and invalidation for login, validation, and pre-run confirmation.
- TypeScript checks, Vitest suite, production build, and portable-package configuration.

### 12.2 Manual Integration Tests

- Manual Kakao login and reuse of the dedicated Chrome session.
- Write-access verification for the stored single blog URL.
- Normal paragraph, bold, divider, and image behavior.
- `[H2]` visibly uses `제목1` and produces H2 structure in the resulting post.
- Category and tags are correctly applied.
- One explicitly approved draft, public, and scheduled post.
- Safe behavior on login expiration and user stop.
- Equivalent behavior in the Windows portable `.exe`.

Automated verification must never perform live public or scheduled publication. Any live public or scheduled integration test requires the user's explicit approval at test time.

## 13. Acceptance Criteria

- The Windows desktop application can select and validate a marker-based post workspace.
- The application stores one target blog URL and no Kakao credentials.
- The user can log in manually through the dedicated Chrome profile and reuse the session.
- The application verifies authentication and write access to the configured blog.
- The pre-run screen accurately summarizes and confirms all intended publication actions.
- Supported body markers produce normal text, H2 `제목1`, bold text, dividers, and uploaded images in source order.
- Categories and tags are applied as configured.
- Draft, immediate public, and scheduled public flows each produce a verified terminal status.
- Uncertain final actions produce `needs_review` without automatic resubmission.
- Statuses, logs, and diagnostics are written per post.
- The complete automated test suite and production build pass.
- A Windows portable `.exe` is produced and passes the approved manual smoke test.

## 14. Known Risks

- Tistory editor DOM, labels, and publication dialogs can change without notice.
- Kakao may require manual security verification at any time.
- Rich-editor focus and selection behavior may vary with timing or browser updates.
- Image uploads can have asynchronous processing delays.
- Schedule and category controls may require selector maintenance as Tistory evolves.

These risks are contained through selector isolation, readiness checks, bounded retries, diagnostics, live manual smoke tests, and the no-resubmit final-action boundary.
