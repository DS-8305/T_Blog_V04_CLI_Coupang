# Tistory Blog Automation

인물 프로필 CLI 배포 저장소: **[DS-8305/T_Blog_V02_CLI](https://github.com/DS-8305/T_Blog_V02_CLI)** (`main`). 기존 V01의 이력과 CLI를 기반으로 합니다. 현재 사용하는 연결형 Sheets·Drive 운영 절차는 [프로필 작업 안내](docs/profile-sheet-automation.md#현재-운영-연결형-sheetsdrive--기존-cli)를 먼저 확인하세요.

인물 프로필은 `draft:run --blog-url auto`로 실행합니다. **운동선수는 time-giver, 정치인·공직자는 moneyguru**로 선택되며, 분류 충돌이나 명시한 주소 불일치는 저장 전에 차단됩니다. 자세한 명령과 메타데이터 형식은 위 운영 안내를 따릅니다.

Windows에서 로컬 `content.txt`를 읽어 한 개의 티스토리 블로그에 임시저장, 즉시 공개 또는 예약 공개하는 Electron 앱입니다. Kakao 로그인은 전용 Chrome에서 사용자가 직접 수행하며 앱은 인증 정보를 저장하지 않습니다.

## 실행

```powershell
pnpm install
pnpm test
pnpm run electron:dev
```

CLI의 `draft:verify`와 `draft:run`은 작업 후 Chrome 연결을 해제하고 종료 코드를 반환합니다. 사용자가 로그인한 전용 Chrome 창과 탭은 유지됩니다. 처리할 글이 없으면 `draft:run --blog-url auto`도 브라우저 연결 없이 종료하며, 서비스 계정으로 연결된 시트의 완료 기록 복구를 먼저 수행합니다.

Chrome이 설치된 환경에서는 실제 브라우저 회귀 테스트도 실행할 수 있습니다.

```powershell
pnpm run test:browser
```

이 테스트는 임시 프로필·임의의 로컬 포트·로컬 테스트 페이지를 사용합니다. 로그인이나 실제 티스토리 저장 없이 CLI 정상 종료, Chrome 유지, 임시저장 개수 표시가 없는 화면의 응답 시간을 검증합니다. 일반 `pnpm test`에서는 이 브라우저 테스트를 건너뜁니다.

## Google Sheets 한 행 임시저장 사이클

인물 프로필 작업은 [Google Sheet 인물 프로필 자동화 안내](docs/profile-sheet-automation.md)를 따릅니다. `Codex_작업큐`의 READY 행과 시트 프롬프트를 사용하며, `profile:sync`로 결과·Docs를 보관한 뒤 임시저장 성공 시에만 `done → COMPLETE`를 기록합니다. 요청 문장: **“다음 인물 프로필 작업 진행해줘.”**

`codex/tistory-v08-cli` 브랜치는 Google Sheets의 `keyword`/`result` 표에서 `result`가 빈 첫 행 하나를 로컬 작업 폴더로 가져올 수 있습니다. Codex가 글과 이미지를 만든 뒤 티스토리 임시저장이 확인되면 CLI가 해당 행의 `result`를 `done`으로 기록합니다.

서비스 계정 JSON 키를 저장소 밖에 보관하고 환경변수를 설정합니다.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\tistory-sheet-service-account.json"
```

그다음 한 행씩 실행합니다.

```powershell
pnpm.cmd run sheet:next -- --workspace C:\blog-workspace --sheet-url "https://docs.google.com/spreadsheets/d/105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g/edit"
# Codex가 출력된 글 폴더에 content.txt와 images/를 생성
pnpm.cmd run draft:run -- --workspace C:\blog-workspace --blog-url https://sample.tistory.com --max-posts 1
```

다음 행은 이전 행의 임시저장 및 `done` 동기화가 끝난 뒤 다시 `sheet:next`로 가져옵니다. 전체 설정과 복구 절차는 [티스토리 V08 CLI 사용법](docs/tistory-v08-cli-workflow.md)을 참고하세요.

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
