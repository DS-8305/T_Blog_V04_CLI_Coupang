# Tistory Blog Automation

Windows에서 로컬 `content.txt`를 읽어 한 개의 티스토리 블로그에 임시저장, 즉시 공개 또는 예약 공개하는 Electron 앱입니다. Kakao 로그인은 전용 Chrome에서 사용자가 직접 수행하며 앱은 인증 정보를 저장하지 않습니다.

## 실행

```powershell
pnpm install
pnpm test
pnpm run electron:dev
```

portable 실행 파일 생성:

```powershell
pnpm run dist:portable
```

결과는 `release/Tistory-Blog-Automation-0.1.0-portable.exe`에 생성됩니다.

## 작업 폴더

```text
workspace/
  posts/
    001-first-post/
      content.txt
      images/hero.png
```

## content.txt 예시

```text
[TITLE]글 제목[/TITLE]
[PUBLISH]scheduled[/PUBLISH]
[CATEGORY]여행[/CATEGORY]
[TAGS]서울, 주말여행[/TAGS]
[SCHEDULE]2026-07-20 09:00[/SCHEDULE]

일반 본문입니다.
[H2]첫 번째 소제목[/H2]
[BOLD]강조할 문장[/BOLD]
[HR]
[IMAGE:images/hero.png]
```

- `[PUBLISH]`는 `draft`, `public`, `scheduled` 중 하나이며 생략 시 `draft`입니다.
- 티스토리 `제목1`은 `[H2]...[/H2]`로 작성합니다.
- `[QUOTE]`는 지원하지 않으며 `[H2]`로 바꿔야 합니다.
- 예약 시간은 한국 시간(Asia/Seoul) 기준 미래 시각이어야 합니다.

## 안전 동작

실행 직전에 대상 글과 발행 방식을 다시 확인합니다. 최종 저장/발행 클릭 이후 결과가 확인되지 않으면 자동으로 다시 클릭하지 않고 `needs_review`로 멈춥니다. 티스토리 글 목록을 직접 확인한 뒤 앱에서 `이미 생성됨` 또는 `생성 안 됨`으로 처리합니다.

실제 공개 및 예약 발행 테스트는 명시적인 사용자 승인 없이 수행하지 않습니다. 자세한 절차는 [수동 테스트 체크리스트](docs/manual-test-checklist.md)를 참고하세요.
