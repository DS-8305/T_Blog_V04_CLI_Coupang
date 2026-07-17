# Manual Test Checklist

## Test Workspace

Create a local workspace with this shape:

```text
workspace/
  posts/
    001-first-post/
      content.txt
      images/
        hero.png
```

Use this `content.txt`:

```text
[TITLE]임시저장 테스트 글[/TITLE]

일반 문단입니다.

[BOLD]굵게 들어가는 문장입니다.[/BOLD]

[QUOTE]
인용구 문장입니다.
여러 줄 인용을 확인합니다.
[/QUOTE]

[HR]

[IMAGE:images/hero.png]

이미지 아래 문단입니다.
```

## App Checks

- App opens without renderer errors.
- Click `작업 폴더 선택` and choose the workspace root.
- `글 목록` shows `001-first-post`.
- Validation column shows `정상`.
- Click `브라우저 열기 / 로그인`.
- Chrome opens with the dedicated app profile.
- User can log in to Naver manually.
- Select a typing speed: `빠름`, `보통`, or `느림`.
- Click `시작`.
- The app keeps the run controls disabled while running.
- Click `중지` during a run and confirm the app returns to idle state.

## Naver Blog Checks

- The browser opens the Naver Blog writing page.
- Title is entered into the title field.
- Normal paragraph text is typed into the body.
- Bold marker text is inserted with bold formatting.
- Quote marker text is inserted through the quote feature.
- Divider marker inserts a divider.
- Image marker opens the image upload flow and inserts `images/hero.png`.
- Final paragraph is typed after the image.
- The post is not published.
- The post is saved as a draft.

## Local Output Checks

- `posts/001-first-post/status.json` exists.
- `status.json` ends with `draft_saved` after a successful run.
- `posts/001-first-post/run-log.txt` exists.
- `run-log.txt` contains start and draft-save result messages.
- If login/security verification blocks writing, status is `failed` and the log explains the issue.

## Regression Checks

- A workspace without `posts/` does not start a run silently.
- A post without `[TITLE]...[/TITLE]` is marked as `검증 오류`.
- A post with a missing image is marked as `검증 오류`.
- Multiple post folders run in folder-name order.
- A transient browser failure is retried before the run is marked failed.
- A non-retryable login/security failure stops the run.
