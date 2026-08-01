# 티스토리 V08 Codex 연계 CLI 사용법

이 기능은 Codex가 `content.txt`와 이미지를 작업 폴더에 준비한 뒤, 기존 티스토리 Playwright 자동화로 글을 순서대로 임시저장하는 소스 저장소용 CLI입니다. CLI는 공개 또는 예약 발행을 하지 않습니다.

## 준비 사항

- Windows 64비트
- Google Chrome
- Node.js 및 pnpm
- 이 저장소의 의존성 설치: `pnpm install`
- 업로드할 티스토리 블로그의 루트 주소

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

### Chrome 연결 실패

전용 Chrome을 닫았다면 `pnpm draft:login`부터 다시 실행합니다. 일반 Chrome이 아니라 CLI가 연 전용 프로필 창을 유지해야 합니다.

## 최종 확인

CLI가 성공해도 글은 티스토리에 임시저장된 상태입니다. 티스토리 관리 화면에서 제목, 본문, H2, 굵게, 구분선, 이미지 위치를 직접 확인한 후 필요할 때 수동으로 공개합니다.
