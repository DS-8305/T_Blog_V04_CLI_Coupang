# Naver Blog Automation VNext Design

Date: 2026-06-28
Status: Draft for user review

## Goal

Build a new desktop GUI version of the Naver Blog automation program. The app helps a user prepare one or more blog drafts from local text files, type them into the Naver Blog editor through a controlled Chrome browser, apply supported editor features through explicit text markers, and save each post as a draft. The app must not automatically publish posts in this version.

## Confirmed Decisions

- App form: desktop GUI.
- Technical direction: Electron or Tauri desktop app with Node.js Playwright.
- Browser control: Playwright controlling a dedicated Chrome profile.
- Login: user logs in manually the first time. The dedicated browser profile is reused on later runs until Naver invalidates the session.
- Work unit: one blog post equals one folder.
- Input format: explicit tag markers in `content.txt`.
- Posting policy: always save as draft. Never publish automatically.
- Typing speed: GUI selectable presets, such as fast, normal, and slow.
- Failure policy: retry transient failures, but stop on unresolved failure instead of moving to the next post.

## Non-Goals

- Automatic publishing, scheduled publishing, or category-based publishing.
- Bypassing Naver security checks, login verification, captchas, or account protections.
- Supporting arbitrary rich text formats such as Word, Markdown, or HTML in the first version.
- Cloud synchronization or remote execution.
- Multi-account operation.

## User Workflow

1. User opens the desktop app.
2. User selects a workspace or `posts` folder.
3. App scans post folders and validates each `content.txt`.
4. User selects typing speed: fast, normal, or slow.
5. On first use, user clicks a browser/login button and manually logs into Naver in the dedicated Chrome profile.
6. User starts the run.
7. App processes eligible posts sequentially.
8. For each post, app opens Naver Blog's writing screen, enters title and body content, applies supported editor features, saves the post as a draft, records status, and closes the browser context for that post.
9. If a post fails after allowed retries, the app stops and leaves enough context for the user to inspect the issue.

## Workspace Layout

```text
workspace/
  posts/
    001-first-post/
      content.txt
      images/
        hero.png
        detail-1.jpg
      status.json
      run-log.txt
    002-second-post/
      content.txt
      images/
        chart.png
```

Each post folder is independent. Image paths in `content.txt` are resolved relative to the post folder. Status and logs are also written inside the post folder so a failed or completed post is easy to inspect.

## Content Format

`content.txt` uses explicit markers.

```text
[TITLE]First post title[/TITLE]

Normal paragraph text.

[BOLD]Bold sentence.[/BOLD]

[QUOTE]
Quoted text.
Multiple lines are allowed.
[/QUOTE]

[HR]

[IMAGE:images/hero.png]

Text after the image.
```

Initial supported tags:

```text
[TITLE]...[/TITLE]       Blog post title
[BOLD]...[/BOLD]         Bold text
[QUOTE]...[/QUOTE]       Quote block
[HR]                     Divider
[IMAGE:relative/path]    Image insertion
```

Unsupported tags are validation errors. Unclosed tags are validation errors. A missing `[TITLE]` is a validation error.

## Parsed Event Model

The parser converts `content.txt` into ordered editor events:

```text
setTitle("First post title")
typeText("Normal paragraph text.")
typeBold("Bold sentence.")
insertQuote("Quoted text.\nMultiple lines are allowed.")
insertDivider()
insertImage("<absolute path>/images/hero.png")
typeText("Text after the image.")
```

This keeps parsing separate from browser automation. Parser tests can run without opening Naver or Chrome.

## Architecture

### Desktop UI

The UI is the user's control surface. It provides:

- Workspace folder selection.
- Post list with validation and execution status.
- Typing speed selector.
- Start and stop controls.
- Login/browser control.
- Live log panel.
- Failure details for the currently failed post.

### Post Loader

The loader scans `posts/*/content.txt`, reads post folders, resolves local image paths, and builds a list of post jobs. It also reads and writes status files.

### Markup Parser

The parser converts explicit markers into editor events and returns validation errors before automation starts. It should not contain Naver-specific browser logic.

### Naver Blog Automation Engine

The automation engine owns Playwright interactions. It launches a persistent browser context with the app's dedicated Chrome profile, navigates to the Naver Blog editor, waits for editor readiness, executes editor events, and saves the result as a draft.

### Run Orchestrator

The orchestrator processes post jobs one at a time, applies retry rules, updates UI state, writes logs, and stops safely on unrecoverable failure.

## Browser Profile and Login

Use Playwright's persistent browser context to keep a dedicated app profile, for example:

```text
<app-data>/browser-profile/
```

The app never asks for or stores the Naver password. The user logs in manually in the opened browser. Cookies, local storage, and session state remain in the dedicated profile. If Naver expires the session or requests verification, automation stops and asks the user to complete login or verification manually.

## Typing Speed

The app exposes three presets:

```text
Fast    Short delays, useful after the workflow is proven stable.
Normal  Default balanced speed.
Slow    Longer delays for conservative operation.
```

The implementation should favor editor stability over theatrical human simulation. The first version should not simulate mistakes, random corrections, or other noisy human-like behavior.

## Execution Steps Per Post

```text
1. Open dedicated Chrome profile.
2. Navigate to Naver Blog writing screen.
3. Confirm login and editor readiness.
4. Enter title.
5. Execute body events in order.
6. Click draft save.
7. Confirm draft save succeeded.
8. Write status and logs.
9. Close browser context.
```

## Retry and Failure Policy

Retry only failures that are likely to be transient.

```text
General UI click failure: retry up to 2 times.
Editor loading failure: refresh and retry once.
Image insertion failure: retry the same image once, then mark the post failed.
Draft save failure: retry once, then stop with browser context available for inspection when possible.
Login expiration or security verification: stop immediately with no retry.
User stop request: stop at the nearest safe point and record current status.
```

The app does not skip a failed post and continue to the next post in the first version. Stopping on failure reduces the chance that a bad browser or editor state affects later posts.

## Status and Logs

Each post can have a `status.json` similar to:

```json
{
  "status": "draft_saved",
  "startedAt": "2026-06-28T10:00:00+09:00",
  "finishedAt": "2026-06-28T10:02:30+09:00",
  "message": "Draft saved successfully"
}
```

Suggested statuses:

```text
pending
validation_error
running
draft_saved
failed
stopped
```

`run-log.txt` should contain timestamped human-readable entries for troubleshooting.

## Preflight Validation

Before starting automation, the app validates:

- `content.txt` exists.
- `[TITLE]...[/TITLE]` exists and is not empty.
- Only supported tags are used.
- All paired tags are closed.
- Referenced image files exist.
- At least one valid post is available.

Posts with validation errors are shown in the UI and excluded from execution.

## Testing Strategy

### Automated Local Tests

Use automated tests for code that does not require the live Naver editor:

- Post folder scanning.
- `content.txt` parsing.
- Unsupported and unclosed marker detection.
- Image path resolution.
- Status file writing.
- Run orchestrator behavior with mocked automation results.

### Manual Integration Test

Use a test Naver account or private blog flow to verify:

- First-time manual login through the dedicated profile.
- Reuse of the login session in a later app run.
- One post saved as draft.
- Bold text, quote, divider, and image insertion.
- Failure handling when an image path is missing or login expires.

## Open Implementation Choices

The direction is fixed as desktop GUI with Node.js Playwright, but the implementation plan should still choose between Electron and Tauri.

Recommended default: Electron, because Playwright and Node.js integration is direct and the app is automation-heavy rather than UI-performance-heavy.

Tauri remains possible if smaller binary size is more important, but it adds more cross-runtime coordination.

## Risks

- Naver Blog editor DOM and controls can change without notice.
- Naver may show login, security, or verification screens that require manual action.
- Rich editor behavior can vary depending on focus, selection, and editor load timing.
- Image insertion may require OS file chooser handling or editor-specific upload flows.

## Acceptance Criteria

- User can select a `posts` workspace in the desktop GUI.
- App lists post folders and validation results.
- User can open a dedicated Chrome profile and log into Naver manually.
- App can process at least one valid post folder from `content.txt`.
- Supported tags produce the expected editor actions.
- App saves the post as a draft and does not publish it.
- App records status and logs per post.
- Transient failures are retried according to policy.
- Login/security verification stops automation and asks for user action.
