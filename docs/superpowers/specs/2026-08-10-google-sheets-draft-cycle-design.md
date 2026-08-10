# Google Sheets 티스토리 임시저장 사이클 설계

## 목표

Google Sheets의 `result`가 비어 있는 첫 번째 키워드 행을 로컬 작업 폴더로 가져오고, Codex가 해당 키워드로 콘텐츠와 이미지를 만든 뒤, 기존 CLI가 티스토리에 임시저장하고 성공이 확인된 행만 `done`으로 기록한다.

한 번의 사이클은 정확히 한 행만 처리한다. 사용자가 다음 사이클을 요청하면 이전 사이클을 완료하거나 복구한 뒤 다음 미처리 행으로 진행한다.

## 범위

### 포함

- 서비스 계정 JSON 키를 사용한 Google Sheets 읽기 및 쓰기
- 대상 시트의 탭과 `keyword`, `result` 헤더 검증
- `result`가 빈 첫 번째 키워드 행 한 개 선택
- 선택한 행과 로컬 글 폴더를 연결하는 `sheet-source.json` 생성
- 미완료 로컬 행의 중복 가져오기 방지
- 기존 티스토리 draft-only CLI를 통한 임시저장
- 확인된 `draft_saved` 결과를 원본 행의 `result=done`으로 동기화
- 티스토리 저장 성공 후 시트 쓰기만 실패한 경우의 재동기화
- 단위 테스트, CLI 통합 테스트, 사용 문서

### 제외

- CLI 내부에서 OpenAI API 또는 Codex 호출
- CLI 내부의 글 또는 이미지 생성
- 티스토리 공개 및 예약 발행
- Google Sheet의 열 추가, 서식 변경 또는 원본 키워드 수정
- 여러 CLI 프로세스 또는 여러 컴퓨터 간의 분산 잠금
- 한 사이클에서 여러 신규 행 가져오기

## 대상 시트 계약

- 스프레드시트 ID: `105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g`
- 기본 탭: `시트1`
- 헤더 행: 1행
- 필수 헤더: `keyword`, `result`
- 미처리 행: `keyword`는 비어 있지 않고 `result`는 공백을 제거한 뒤 빈 문자열인 행
- 완료 행: `result`가 대소문자 구분 없이 `done`인 행
- 다른 비어 있지 않은 `result` 값은 CLI가 소유하지 않는 상태로 보고 선택하지 않는다.

헤더 위치는 A/B 열로 고정하지 않는다. CLI는 1행에서 헤더 이름을 찾아 실제 열 번호를 계산한다. 탭과 헤더가 없거나 중복되면 원격 데이터를 수정하지 않고 종료 코드 `1`로 중단한다.

## 인증과 비밀정보

CLI는 `GOOGLE_APPLICATION_CREDENTIALS` 환경변수가 가리키는 서비스 계정 JSON 파일을 사용한다. JSON 키의 경로와 내용은 로그, 상태 파일, `sheet-source.json`에 기록하지 않는다.

서비스 계정에는 대상 스프레드시트의 편집 권한이 필요하다. 키 파일은 저장소 밖에 보관하며 Git에 추가하지 않는다. 인증 실패, 파일 누락 또는 Sheets 권한 부족은 사람이 조치할 수 있는 오류 메시지와 종료 코드 `1`을 반환한다.

## 명령 인터페이스

### 다음 행 가져오기

```powershell
pnpm sheet:next -- --workspace C:\blog-workspace --sheet-url https://docs.google.com/spreadsheets/d/105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g/edit --sheet-name 시트1
```

`--sheet-name`의 기본값은 `시트1`이다. `--workspace`는 절대 경로여야 한다. `--sheet-url`은 Google Sheets URL 또는 스프레드시트 ID를 허용한다.

명령은 먼저 로컬 작업 폴더의 기존 `sheet-source.json`을 검사한다. 시트에서 `done`이 아닌 연결 행이 남아 있으면 새 행을 가져오지 않고 해당 폴더와 키워드를 출력한다. 기존 연결 행이 없으면 원격 시트에서 첫 미처리 행 하나를 선택하고 다음 폴더를 만든다.

```text
posts/<6자리-행번호>-<안전한-키워드-슬러그>/
  sheet-source.json
```

폴더명 충돌 시 같은 시트 ID와 행 번호를 가진 폴더는 재사용한다. 다른 출처와 충돌하면 중단한다. `sheet-source.json`은 다음 정보를 가진다.

```json
{
  "version": 1,
  "spreadsheetId": "105xA7xNE-0FcvR06Tw4RruWuVgSCoZ-MaJ4Jw-QlE-g",
  "sheetName": "시트1",
  "rowNumber": 34,
  "keywordHeader": "keyword",
  "resultHeader": "result",
  "keyword": "고지혈증 약, 평생 먹어야 하는지 궁금하다면"
}
```

이 단계에서는 Google Sheet 값을 변경하지 않는다. Codex는 출력된 글 폴더에 기존 콘텐츠 프롬프트 계약에 맞는 `content.txt`와 `images/`를 만든다.

### 티스토리 임시저장 및 완료 동기화

기존 명령을 유지한다.

```powershell
pnpm draft:run -- --workspace C:\blog-workspace --blog-url https://sample.tistory.com --max-posts 1
```

CLI는 실행 시작 시와 종료 시에 `sheet-source.json`이 있는 글을 동기화한다.

1. 로컬 상태가 `draft_saved`이고 원격 `result`가 비어 있으면 `done`을 기록한다.
2. 원격 `result`가 이미 `done`이면 성공한 멱등 동기화로 취급한다.
3. 원격 키워드가 `sheet-source.json`의 키워드와 다르면 잘못된 행 업데이트를 막기 위해 중단한다.
4. 원격 `result`가 빈 값 또는 `done`이 아닌 값이면 덮어쓰지 않고 중단한다.
5. 콘텐츠 검증이나 티스토리 저장이 실패하면 원격 시트를 변경하지 않는다.
6. 티스토리 결과가 `needs_review`이면 원격 시트를 변경하지 않고 후속 글 처리를 멈춘다.

티스토리 임시저장이 확인된 뒤 시트 업데이트가 실패하면 로컬의 `_SUCCESS.done`과 `draft_saved` 상태는 유지한다. 다음 `draft:run` 또는 `sheet:next` 실행은 새 행을 선택하기 전에 이 완료 상태를 다시 `done`으로 동기화한다.

## 구성 요소

### `src/sheets/sheetAuth.ts`

`GOOGLE_APPLICATION_CREDENTIALS`를 검증하고 Google 서비스 계정 액세스 토큰을 제공한다. 비밀정보를 도메인 로직과 로그에서 격리한다.

### `src/sheets/googleSheetsClient.ts`

Google Sheets REST API의 필요한 최소 기능만 노출한다.

- 스프레드시트 메타데이터 및 지정 탭 확인
- 헤더와 데이터 범위 읽기
- 특정 행의 키워드와 결과 재확인
- 특정 결과 셀에 `done` 기록

인증은 `google-auth-library`를 사용하고, API 호출은 Node의 `fetch`를 사용한다. 전체 `googleapis` 패키지는 추가하지 않는다.

### `src/sheets/sheetQueue.ts`

시트 값에서 필수 헤더를 찾고 첫 미처리 행을 선택하는 순수 로직을 담당한다. 빈 키워드, 완료 행, 외부 상태 행을 건너뛴다.

### `src/sheets/sheetSource.ts`

`sheet-source.json`의 스키마 검증, 읽기, 원자적 쓰기, 동일 출처 판별을 담당한다. 잘못된 매니페스트는 조용히 무시하지 않고 오류로 보고한다.

### `src/cli/sheetNextCli.ts`

`sheet:next` 인자를 파싱하고 로컬 미완료 작업 확인, 원격 행 선택, 글 폴더 생성 및 사용자 안내를 조정한다.

### `src/sheets/sheetResultSync.ts`

로컬 `draft_saved` 상태와 원격 행을 대조하고 `done`을 멱등하게 기록한다. 키워드 불일치와 외부 상태 덮어쓰기를 차단한다.

### 기존 `src/cli/draftCli.ts`

`run` 명령 전후에 완료된 Sheet 연계 글의 동기화를 호출한다. Sheet 연계 파일이 없는 기존 로컬 작업 폴더의 동작은 바꾸지 않는다.

## 데이터 흐름

1. 사용자가 서비스 계정 키 환경변수를 설정하고 전용 Chrome에 로그인한다.
2. `sheet:next`가 로컬의 미완료 Sheet 연계 작업을 먼저 검사한다.
3. 복구할 완료 상태가 있으면 원격 `done` 기록을 우선 재시도한다.
4. 미완료 작업이 없으면 시트의 첫 미처리 키워드 한 행을 선택한다.
5. CLI가 행 출처 매니페스트를 포함한 글 폴더를 만들고 키워드와 경로를 출력한다.
6. Codex가 기존 프롬프트에 따라 `content.txt`와 이미지를 만든다.
7. `draft:run --max-posts 1`이 기존 검증과 브라우저 자동화를 실행한다.
8. 확인된 임시저장만 로컬 `draft_saved` 상태로 기록한다.
9. 결과 동기화가 원격 키워드와 상태를 다시 읽고 `result=done`을 기록한다.
10. 다음 요청에서 같은 사이클을 반복한다.

## 오류와 복구

- **인증 또는 권한 오류:** 원격/로컬 콘텐츠를 변경하지 않고 중단한다.
- **탭 또는 헤더 오류:** 정확한 누락 또는 중복 이름을 출력하고 중단한다.
- **미처리 행 없음:** 성공 종료하며 `No pending sheet rows.`를 출력한다.
- **로컬 미완료 작업 존재:** 성공 종료하며 기존 폴더를 출력하고 새 행을 만들지 않는다.
- **매니페스트 손상:** 원격 업데이트와 새 행 가져오기를 모두 중단한다.
- **콘텐츠 미생성:** 기존 post loader의 검증 오류를 사용하고 시트를 변경하지 않는다.
- **티스토리 저장 불확실:** `needs_review`를 유지하고 시트를 변경하지 않는다.
- **시트 업데이트 실패:** 로컬 성공 상태를 유지해 다음 실행에서 재동기화한다.
- **원격 키워드 변경:** 행 번호가 같아도 `done`을 기록하지 않는다.
- **원격 외부 상태:** `done`이 아닌 비어 있지 않은 값은 덮어쓰지 않는다.

## 테스트 전략

모든 새 동작은 테스트 우선으로 구현한다.

- 순수 큐 선택 테스트: 헤더 위치 변경, 공백 결과, `done`, 외부 상태, 빈 키워드, 미처리 행 없음
- 매니페스트 테스트: 정상 왕복, 필수 필드 누락, 버전 불일치, 동일 출처 재사용, 충돌
- Sheets 클라이언트 테스트: REST 범위 인코딩, 인증 헤더, API 오류 메시지, 단일 셀 업데이트
- `sheet:next` CLI 테스트: 기본 한 행, 미완료 작업 재사용, 완료 동기화 우선, 행 없음, 인증/시트 오류
- 결과 동기화 테스트: `draft_saved`만 업데이트, 이미 `done`인 경우 멱등 성공, 키워드 불일치 차단, 외부 상태 보호, 네트워크 실패 후 재시도 가능
- 기존 `draft:run` 회귀 테스트: Sheet 매니페스트가 없는 작업은 기존 동작 유지, 실패 및 `needs_review`에서는 원격 쓰기 없음
- 전체 `pnpm test`와 `pnpm run build`

실제 Google Sheet 쓰기와 실제 티스토리 임시저장은 자동 테스트에서 수행하지 않는다. 라이브 검증은 사용자의 서비스 계정 공유와 명시적인 실행 시에만 한 행으로 진행한다.

## 문서 및 운영 절차

사용 문서에는 다음을 추가한다.

- 서비스 계정 생성, JSON 키 보관, 시트 편집 공유 절차
- PowerShell에서 `GOOGLE_APPLICATION_CREDENTIALS` 설정 방법
- `sheet:next` → Codex 생성 → `draft:run --max-posts 1` 순서
- 실패 유형별 재실행과 `needs_review` 처리
- 키 파일을 저장소에 넣지 말아야 한다는 경고
- 다음 행은 이전 행의 `done` 동기화 이후에만 가져온다는 원칙

## 완료 기준

- 제공된 시트 계약에서 첫 번째 빈 `result` 행 한 개만 선택한다.
- 동일 행에 대한 미완료 로컬 작업이 있으면 중복 폴더를 만들지 않는다.
- Codex가 생성한 유효한 로컬 글을 기존 CLI가 티스토리에 임시저장할 수 있다.
- 확인된 `draft_saved` 행만 `done`으로 기록한다.
- 임시저장 성공 후 시트 쓰기가 실패해도 다음 실행에서 안전하게 복구한다.
- 키워드 변경 또는 외부 상태를 감지하면 원격 셀을 덮어쓰지 않는다.
- 기존 비-Sheet CLI 흐름의 테스트와 빌드가 계속 통과한다.
