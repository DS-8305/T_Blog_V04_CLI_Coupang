# Tistory V08 Codex-Assisted CLI Design

## Goal

Bring the proven `feature/v08` Codex-assisted workflow from `DS-8305/N_Blog_V08` into `DS-8305/DS-8305-T_Blog_V01` without changing the existing Electron application's behavior.

Codex prepares a UTF-8 `content.txt` and one to five generated images in a workspace. The user then runs three source-based CLI commands to open the shared dedicated Chrome profile, verify a Tistory session for an explicit blog URL, and save eligible posts as Tistory drafts.

## Confirmed User Decisions

- Add the workflow to the existing Tistory repository.
- Keep the V08 three-command sequence: `draft:login`, `draft:verify`, `draft:run`.
- Run the CLI from the repository with `pnpm`; do not add CLI flags to the portable executable.
- Share the Electron application's dedicated Chrome profile.
- Require `--blog-url` for `verify` and `run`; do not read the Electron blog configuration.
- Allow only `[TITLE]`, `[H2]`, `[BOLD]`, `[HR]`, and `[IMAGE:path]` in CLI input.
- Always save drafts. CLI input cannot request public or scheduled publication.
- Provide one general Tistory content-generation prompt.
- Let Codex choose one to five images according to the topic.

## Workflow

1. The user gives Codex a topic and an absolute workspace path.
2. Codex creates `posts/<post-id>/content.txt` in UTF-8.
3. Codex creates one to five useful images beneath `posts/<post-id>/images/` and places matching `[IMAGE:images/<file>]` markers in `content.txt`.
4. The user runs `pnpm draft:login` and completes any required Kakao/Tistory login in the dedicated Chrome window.
5. The user runs `pnpm draft:verify -- --blog-url <url>`.
6. The user runs `pnpm draft:run -- --workspace <absolute-path> --blog-url <url>` with optional `--speed` and `--max-posts`.
7. The CLI validates all eligible posts before editor input, saves each as a Tistory draft, writes the existing status/log/success files, and stops on the first uncertain or failed final action.
8. The user reviews the drafts in Tistory and publishes manually if desired.

## CLI Contract

### `draft:login`

- Accepts no options.
- Uses the same `%APPDATA%/tistory-blog-auto-v01/browser-profile` directory as the Electron application.
- Launches installed Google Chrome detached with CDP bound only to `127.0.0.1:9222` and opens Tistory home.
- If the loopback CDP endpoint is already available, does not launch a second Chrome process and reports that the dedicated Chrome is already open.

### `draft:verify`

- Requires `--blog-url`.
- Normalizes and validates an `http` or `https` Tistory blog origin.
- Attaches `TistoryBlogAutomation` to the existing loopback CDP endpoint.
- Opens the configured blog's editor through the existing session verification method.
- Returns exit code `0` only for an authenticated, usable editor session.

### `draft:run`

- Requires `--workspace <absolute-path>` and `--blog-url <url>`.
- Accepts `--speed fast|normal|slow` and `--max-posts <positive integer>`.
- Loads posts with the existing loader and image path protections.
- Applies the CLI-only marker policy before session verification or editor input.
- Rejects validation errors and unresolved `needs_review` posts with concise operational messages and exit code `1`.
- Delegates pending jobs to the existing `runPosts` and `TistoryBlogAutomation` implementations.

## Marker Policy

The Electron parser remains unchanged so the desktop application keeps its existing metadata and publication features.

The CLI adds a policy layer after loading and before automation:

- Allowed paired markers: `[TITLE]...[/TITLE]`, `[H2]...[/H2]`, `[BOLD]...[/BOLD]`.
- Allowed standalone markers: `[HR]`, `[IMAGE:relative/path]`.
- Plain body text is allowed.
- Known desktop-only markers such as `[PUBLISH]`, `[CATEGORY]`, `[TAGS]`, `[SCHEDULE]`, and `[QUOTE]` are rejected.
- Unknown, lowercase, malformed, unclosed, and unmatched markers continue to be rejected by the existing parser.
- Every accepted CLI job is forced to draft metadata (`publication: draft`, no category, tags, or schedule) as defense in depth.

## Architecture

### New CLI modules

- `src/cli/cliArgs.ts`: dependency-free parsing and validation of the three commands.
- `src/cli/cliPaths.ts`: derives the shared Electron Chrome profile path without importing Electron.
- `src/cli/cliChrome.ts`: checks the loopback endpoint and launches detached Chrome when needed.
- `src/cli/cliPostPolicy.ts`: enforces the five-marker, draft-only contract.
- `src/cli/draftCli.ts`: command dispatch, session verification, validation reporting, and orchestration.

### Reused modules

- `TistoryBlogAutomation` for editor interaction and draft confirmation.
- `loadPosts` for workspace discovery, status filtering, parsing, and image containment checks.
- `runPosts` for sequential processing, stop-on-failure behavior, and status persistence.
- `findChromeExecutable`, `TISTORY_HOME_URL`, and `MANUAL_CHROME_CDP_ENDPOINT` for consistent browser behavior.

No Naver selector, Naver automation class, OpenAI API client, or Electron renderer code is copied into the CLI.

## Content Prompt and Workspace Documentation

Add one general prompt at `prompts/tistory-blog-content-template.md`. It instructs Codex to output only content suitable for `content.txt`, use only the five markers, create natural Korean Tistory prose, select one to five useful images, keep image paths within the post folder, and avoid fabricated facts.

Add `docs/tistory-v08-cli-workflow.md` with command examples, workspace layout, marker syntax, login/profile-sharing rules, failure recovery, and manual draft review steps.

## Safety and Error Handling

- CDP remains loopback-only.
- No credentials, cookies, or tokens are read or stored by the CLI.
- The shared Chrome profile is never launched twice when the CDP endpoint is already active.
- A missing session, security challenge, invalid blog URL, invalid marker, missing image, or invalid workspace prevents editor input.
- The CLI never honors public or scheduled publication markers.
- An uncertain Tistory final action becomes `needs_review` and stops subsequent posts.
- The CLI closes only its Playwright attachment; it does not terminate the manually opened Chrome window.

## Testing and Verification

- Unit tests for CLI argument parsing, required blog URL, speed, maximum post count, and unknown options.
- Unit tests for shared profile path derivation and detached Chrome launch arguments.
- Unit tests for the five-marker allowlist, desktop-only marker rejection, and forced draft metadata.
- CLI runner tests for login, verification failure, validation failure before editor input, successful delegation, and cleanup.
- Existing Electron, parser, loader, orchestration, and Tistory automation tests must continue to pass.
- Run the full test suite, TypeScript/build pipeline, CLI build, and `git diff --check`.
- Do not rebuild the portable executable for this source-only CLI change.

## Non-Goals

- Public or scheduled publishing from the CLI.
- Multiple Chrome profile selection.
- Reading a saved Electron blog URL.
- Calling the OpenAI API from the standalone Node process.
- Embedding CLI commands into the portable executable.
- Supporting both Naver and Tistory through a shared multi-provider CLI abstraction.
