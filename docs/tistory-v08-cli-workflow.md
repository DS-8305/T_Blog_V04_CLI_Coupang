# 티스토리 V08 Codex 연계 CLI 사용법

이 기능은 Codex가 `content.txt`와 이미지를 작업 폴더에 준비한 뒤, 기존 티스토리 Playwright 자동화로 글을 순서대로 임시저장하는 소스 저장소용 CLI입니다. CLI는 공개 또는 예약 발행을 하지 않습니다.

## 준비 사항

- Windows 64비트
- Google Chrome
- Node.js 및 pnpm
- 이 저장소의 의존성 설치: `pnpm install`
- 업로드할 티스토리 블로그의 루트 주소

Google Sheets 연계 사이클에는 다음 항목도 필요합니다.

- Google Cloud 프로젝트에서 Google Sheets API 사용 설정
- 서비스 계정과 JSON 키
- 서비스 계정 이메일에 대상 스프레드시트 편집자 권한 공유

JSON 키는 저장소 밖에 보관하고 현재 PowerShell 세션에 경로만 설정합니다.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\tistory-sheet-service-account.json"
```

CLI는 키 경로나 키 내용을 작업 폴더, 로그, `sheet-source.json`에 저장하지 않습니다.

CLI는 portable 앱과 같은 Chrome 프로필을 사용합니다.

```text
%APPDATA%\tistory-blog-auto-v01\browser-profile
```

portable 앱과 CLI가 같은 프로필을 동시에 새로 열지 않도록 합니다. 이미 전용 Chrome이 `127.0.0.1:9222`에서 실행 중이면 `draft:login`은 두 번째 Chrome을 열지 않고 기존 창을 사용합니다.

## 작업 폴더 구조

```text
C:\blog-workspace\
└─ posts\
   ├─ 001-first-post\
   │  ├─ content.txt
   │  └─ images\
   │     ├─ 01-overview.png
   │     └─ 02-details.png
   └─ 002-second-post\
      ├─ content.txt
      └─ images\
         └─ 01-topic.png
```

각 글은 별도 폴더에 둡니다. 이미지 마커의 경로는 해당 글 폴더 밖으로 나갈 수 없습니다.

## 콘텐츠 생성

Codex에 다음 프롬프트 파일과 주제, 작업 폴더 절대 경로를 제공합니다.

```text
prompts/tistory-blog-content-template.md
```

CLI 콘텐츠에서 사용할 수 있는 마커는 다음 다섯 종류뿐입니다.

```text
[TITLE]제목[/TITLE]
[H2]소제목[/H2]
[BOLD]강조 문장[/BOLD]
[HR]
[IMAGE:images/파일명.png]
```

일반 본문은 마커 없이 작성합니다. CLI는 모든 글을 임시저장으로 강제합니다.

CLI는 저장소의 `assets/cli/coupang-partners-disclosure.png`를 모든 글에 자동으로 넣습니다. 이미지 위치는 제목 바로 뒤, 도입부 바로 앞입니다. 배너 파일은 글 작업 폴더에 복사하거나 `content.txt`에 별도 이미지 마커를 추가하지 않습니다. 글별 주제 이미지는 프롬프트 지침대로 계속 준비합니다.

CLI는 원고 입력과 메타데이터 적용을 마친 뒤 임시저장 직전에 HTML 모드로 전환하고, 첫째와 둘째 H2 바로 아래에 쿠팡 파트너스 캐러셀 코드를 각각 삽입합니다. HTML 소스를 다시 읽어 두 위젯이 반영됐는지 확인한 뒤 저장합니다. H2가 두 개보다 적거나 HTML 편집기에서 삽입 결과를 확인할 수 없으면 임시저장하지 않습니다. 이 동작은 CLI 작업에만 적용되고 일반 앱 편집에는 적용되지 않습니다.

## Google Sheets에서 다음 한 행 가져오기

대상 시트의 1행에는 `keyword`와 `result` 헤더가 있어야 합니다. 열 순서는 바뀌어도 됩니다. `keyword`가 있고 `result`가 비어 있는 첫 행 하나만 가져오며, `done` 또는 다른 상태가 있는 행은 건너뜁니다.

```powershell
pnpm.cmd run sheet:next -- --workspace C:\blog-workspace --sheet-url "https://docs.google.com/spreadsheets/d/105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g/edit"
```

기본 탭 이름은 `시트1`입니다. 다른 탭은 명시합니다.

```powershell
pnpm.cmd run sheet:next -- --workspace C:\blog-workspace --sheet-url "https://docs.google.com/spreadsheets/d/105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g/edit" --sheet-name 콘텐츠
```

명령은 다음과 같은 폴더와 출처 매니페스트를 만듭니다.

```text
C:\blog-workspace\posts\000034-키워드-슬러그\sheet-source.json
```

출력된 키워드와 글 폴더 절대 경로를 `prompts/tistory-blog-content-template.md`와 함께 Codex에 제공합니다. Codex가 같은 폴더에 `content.txt`와 `images/`를 생성해야 합니다. CLI는 본문이나 이미지를 자체 생성하지 않습니다.

이전 Sheet 연계 글이 아직 임시저장되지 않았거나 `done` 동기화가 끝나지 않았으면 새 행을 가져오지 않고 기존 폴더를 다시 안내합니다.

## 1단계: 전용 Chrome 열기

```powershell
pnpm draft:login
```

열린 Chrome에서 카카오/티스토리에 직접 로그인하고 창을 그대로 둡니다. 프로그램은 계정 비밀번호를 읽거나 저장하지 않습니다.

## 2단계: 로그인과 편집기 권한 확인

```powershell
pnpm draft:verify -- --blog-url https://sample.tistory.com
```

블로그 주소는 매번 명시해야 하며 루트 `https://*.tistory.com` 주소만 허용됩니다. 로그인 누락, 보안 확인, 편집 권한 문제가 있으면 종료 코드 `1`로 중단됩니다.

## 3단계: 글 임시저장

```powershell
pnpm draft:run -- --workspace C:\blog-workspace --blog-url https://sample.tistory.com
```

Google Sheets 한 행 사이클에서는 안전하게 한 개만 처리합니다.

```powershell
pnpm.cmd run draft:run -- --workspace C:\blog-workspace --blog-url https://sample.tistory.com --max-posts 1
```

Sheet 연계 글은 티스토리 임시저장이 확실히 확인된 경우에만 원본 행의 `result`가 `done`으로 바뀝니다. 티스토리 저장은 성공했지만 Google Sheets 쓰기가 실패하면 로컬 `draft_saved` 상태는 유지되며, 다음 `draft:run` 또는 `sheet:next`가 `done` 기록을 먼저 재시도합니다.

입력 속도와 최대 처리 개수는 선택 사항입니다.

```powershell
pnpm draft:run -- --workspace C:\blog-workspace --blog-url https://sample.tistory.com --speed slow --max-posts 3
```

- `--speed`: `fast`, `normal`, `slow` 중 하나이며 기본값은 `normal`입니다.
- `--max-posts`: 이번 실행에서 처리할 양의 정수 개수입니다.
- `--workspace`: 반드시 절대 경로여야 합니다.

## 처리 결과

각 글 폴더에는 기존 앱과 같은 상태 파일이 기록됩니다.

- `status.json`: 현재 상태, 시작·종료 시각, 결과 메시지
- `automation.log`: 자동화 진행 기록
- `_SUCCESS.done`: 임시저장이 확인된 글의 성공 표시

성공 표시가 있거나 이미 `draft_saved` 상태인 글은 다음 실행에서 건너뜁니다. 여러 글은 폴더명 순서로 처리하며 첫 실패 또는 불확실한 결과에서 전체 실행을 중단합니다.

## 오류 처리

### 마커 또는 이미지 검증 오류

CLI는 Chrome 편집기에 접근하기 전에 모든 대상 글을 검사합니다. 허용되지 않은 마커, 닫히지 않은 마커, 누락된 이미지, 글 폴더 밖 이미지 경로가 있으면 해당 글 ID와 원인을 출력하고 중단합니다. 파일을 수정한 뒤 같은 명령을 다시 실행합니다.

### `needs_review`

임시저장 클릭 결과를 확실하게 확인하지 못하면 글 상태가 `needs_review`가 되고 후속 글 처리를 멈춥니다. 티스토리 임시저장 목록에서 실제 생성 여부를 확인한 뒤 기존 앱의 검토 절차로 상태를 해결하고 다시 실행합니다.

Sheet 연계 글이 `needs_review`, `failed`, `stopped` 상태이면 원본 `result`를 변경하지 않습니다. 원격 키워드가 로컬 `sheet-source.json`과 달라졌거나 `result`에 `done` 이외의 값이 생기면 CLI는 해당 셀을 덮어쓰지 않고 중단합니다.

### Chrome 연결 실패

전용 Chrome을 닫았다면 `pnpm draft:login`부터 다시 실행합니다. 일반 Chrome이 아니라 CLI가 연 전용 프로필 창을 유지해야 합니다.

## 최종 확인

CLI가 성공해도 글은 티스토리에 임시저장된 상태입니다. 티스토리 관리 화면에서 제목, 본문, H2, 굵게, 구분선, 이미지 위치를 직접 확인한 후 필요할 때 수동으로 공개합니다.

원본 Google Sheet에서 처리한 행의 `result`가 `done`인지 확인한 뒤, 다음 작성 요청에서 `sheet:next`를 다시 실행합니다.
