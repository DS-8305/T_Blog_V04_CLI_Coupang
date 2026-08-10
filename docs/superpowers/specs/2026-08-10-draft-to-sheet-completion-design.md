# Draft-to-Sheet Completion Design

## Goal

Do not treat a Sheet-linked post as complete until its Tistory draft save has been confirmed and its exact Google Sheets result cell has been read back as `done`.

## Observed gap

The draft CLI saves a post before attempting Sheet synchronization. That sync depends on a local source manifest and service-account authentication, but it does not record a distinct resumable Sheet-completion state or verify the remote value after writing.

## Design

Store `sheet-completion.json` alongside every linked post. It records `awaiting_sheet_done` once the local state is `draft_saved`, and `sheet_done` only after the result cell is read back as `done`. On startup and after a draft run, synchronization retries incomplete Sheet writes without reopening or editing the existing Tistory draft. The CLI returns success only when no selected linked post remains incomplete.

## Failure handling

- Failed Tistory saves never create a completion checkpoint.
- A Sheets failure retains `awaiting_sheet_done` and the existing draft for a safe retry.
- A changed remote keyword stops the workflow without writing `done`.
- A pre-existing `done` result is verified and checkpointed without another write.

## Constraints

- Keep the logged-in Chrome window open.
- Keep the service-account client path.
- Read and write only the linked row's result cell.
