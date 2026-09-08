# Google Sheet 인물 프로필 작업 — V08 CLI

## 목적과 작업 계약

사용자는 **“다음 인물 프로필 작업 진행해줘.”**라고 요청한다. Codex가 시트에서 준비된 작업과 프롬프트를 읽고 조사·작성한다. CLI는 큐 가져오기, 결과 보관, 티스토리 임시저장, 완료 기록을 맡는다. CLI 자체가 AI 콘텐츠를 생성하거나 대화가 종료된 뒤 조사·작성을 계속하는 구조는 아니다.

배포 저장소는 `DS-8305/T_Blog_V02_CLI`, 브랜치는 `main`이다. 기존 `T_Blog_V01`의 `codex/tistory-v08-cli` 이력을 이어받았다. 정치 프로필 V02 저장소와 혼합하지 않는다. 별도의 인물 작업 workspace를 사용하고 동시에 두 CLI를 실행하지 않는다.

시트: https://docs.google.com/spreadsheets/d/1LSL_RX2oXGoyBEve4gNNFjsy4VMEZgKi244Zj5Nn6u4/edit

- 작업 탭: `Codex_작업큐`
- 프롬프트 탭: `프롬프트_설정`
- `READY` + keyword 있음 + result 빈칸인 첫 행만 가져온다.
- `HOLD`, `ERROR`, `REVIEW`, `COMPLETE` 또는 result가 채워진 로컬 작업은 신규 큐를 막지 않으며 draft 대상에서도 제외한다.
- 자동화상태 헤더가 없는 기존 keyword/result 시트는 기존 조건대로 선택한다.
- 열 위치가 바뀌어도 헤더명으로 찾는다. 중복/누락 필수 헤더는 오류이며 A:Z를 넘는 큐는 거부한다.

## 현재 운영: 연결형 Sheets·Drive + 기존 CLI

### 인물 분류별 대상 블로그

- 운동선수 → `https://time-giver.tistory.com`
- 정치인·공직자·공무원 → `https://moneyguru.tistory.com`

`draft:run --blog-url auto`는 이번에 처리할 pending 작업의 분류로 주소를 결정한다. `profile-task.json`의 `row`, 연결형 `connector-source.json`의 `row`, 서비스 계정용 v2 `sheet-source.json`의 `promptType`을 읽으며, 이전 연결형 `sourceRow` 배열(A:Z 스냅샷)도 호환한다. 새 연결형 작업은 헤더로 매핑한 `row` 객체에 `majorType`, `detailType`, `promptType`을 보관한다. 연결된 시트의 최신 분류와 로컬 스냅샷을 실행 전에 대조한다.

분류가 없거나 서로 충돌하면 auto 실행은 중단한다. 서로 다른 대상의 작업을 한 번에 실행하지 않는다. 주소를 명시하더라도 인물 분류에 맞지 않으면 브라우저 접속 전에 차단한다. 프로필 메타데이터가 없는 기존 일반 글은 명시한 주소를 계속 사용할 수 있다. `verify`에는 auto 대신 확인할 실제 블로그 주소를 지정한다. 계정에 해당 블로그 글쓰기 권한이 있어야 하며 기존 임시저장 글을 이동하거나 수정하지 않는다.

2026-09-08 실제 운영에서 확인한 방식이다. **Google Sheets·Docs 작업은 Codex에 연결된 Google Drive 도구가 수행하고, CLI는 로컬 원고의 티스토리 임시저장만 수행한다.** 서비스 계정 JSON 설정 없이 사용하며, 아래의 서비스 계정 직접 API 경로와 구분한다. 연결 도구를 호출하는 독립 백그라운드 프로세스가 구현된 것은 아니다.

1. 연결 도구로 작업 탭과 프롬프트 탭을 읽고 첫 READY/빈 result 행 하나를 선택한다. 행 번호뿐 아니라 인물ID·keyword도 확인한다.
2. Codex가 공식 자료를 조사하고 현재 시트 프롬프트에 맞춰 원고를 생성한다. 이번 검증 기준은 이미지 없이 소제목 6개, 각 소제목 앞 HR, 제목·마커 제외 소제목 포함 1,000~1,200자였다. 실제 기준은 매 작업의 시트 프롬프트를 우선한다.
3. 별도 workspace의 `posts/<작업명>/content.txt`에 원고를 저장한다. 연결형 작업은 `connector-source.json`에 행·프롬프트 스냅샷을 보관한다. **이 경로에 서비스 계정용 `sheet-source.json`을 만들지 않는다.** 기존 v2 작업에서 manifest를 삭제해 검증을 우회하는 용도로 사용하면 안 된다.
4. 연결 도구로 `[인물ID] 이름 프로필` Google 문서를 생성하여 사용자가 지정한 폴더에 보관한다. 제목 → 본문 → 태그 → 조사 출처 순서로 저장하고 본문·출처 링크·폴더를 다시 읽어 검증한다. 기존 Y열 URL이나 로컬 문서 ID가 있으면 중복 생성 전 기존 문서를 먼저 확인한다.
5. 연결 도구로 해당 행의 T:Y 결과만 기록한다. A:P 및 R 수식과 다른 행은 보존한다. Q와 S는 아직 완료로 바꾸지 않는다.
6. 로그인한 전용 Chrome을 유지한 채 아래 명령으로 1건을 임시저장한다.

```powershell
pnpm.cmd run draft:run -- --workspace 'C:\Blog\ProfileWorkspace' --blog-url auto --max-posts 1
```

7. CLI 로그와 `status.json=draft_saved`, `_SUCCESS.done`을 확인한 후, 연결 도구로 행 식별자와 상태를 다시 확인하고 S=`done`을 기록·재조회한다. 이어 Q=`COMPLETE`를 기록·재조회한다. 완료 기록 요청에 한해 S의 기존 상태 계산 수식은 명시적 done 값으로 대체한다.
8. 문서 ID·로컬 저장 성공·시트 재조회 결과를 `connector-completion.json`에 남긴다. 이는 Codex가 확인한 증거이며 서비스 계정 CLI용 체크포인트가 아니다. 브라우저는 별도 종료 요청이 없으면 유지한다.

중간에는 진행 상황을 알리되 최종 완료 응답은 임시저장과 시트 완료를 모두 확인한 뒤에 한다. 대화 종료 이후 Codex 조사·연결 도구 호출이 자동으로 이어진다고 보장하지 않는다. 재개 시 기존 파일·문서 URL·티스토리 저장 증거부터 확인하고, 이미 저장된 글은 재작성하지 않고 미완료 동기화만 이어간다. `needs_review` 또는 결과 불확실 상태이면 저장 목록을 확인하기 전 재실행하지 않는다.

실제 확인 결과: 작업큐 10행 주권(SP000009), 본문 1,134자, 임시저장 성공, 지정 폴더 Google 문서 보관, S10=`done`, Q10=`COMPLETE`. 원고·문서 ID·로그·인증 정보는 배포 저장소에 넣지 않는다. 서비스 계정 API 전체 경로의 라이브 성공을 의미하지 않는다.

## 서비스 계정 경로: 환경변수와 Google 설정

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\secure\service-account.json'
$env:PROFILE_DOCS_FOLDER_ID = '공유_드라이브_안의_저장_폴더_ID'
```

`GOOGLE_APPLICATION_CREDENTIALS`는 기존 변수이며 `PROFILE_DOCS_FOLDER_ID`가 새 필수 변수다. 키 파일은 저장소 밖에 보관하고 커밋하지 않는다. 환경변수는 CLI가 실행되는 프로세스에 전달되어야 한다. 터미널에서 설정한 값은 이미 실행 중인 다른 앱 프로세스에 자동 반영되지 않는다.

1. 서비스 계정이 속한 Google Cloud 프로젝트에서 **Google Sheets API, Google Drive API, Google Docs API**를 활성화한다.
2. JSON의 `client_email`에 대상 스프레드시트를 **편집자**로 공유한다. `Codex_작업큐`, `프롬프트_설정`을 읽을 수 있고 결과 셀·상태 셀을 수정할 수 있어야 한다. 보호된 범위 권한도 확인한다.
3. Google Workspace **공유 드라이브** 안에 전용 Docs 저장 폴더를 만든다. 해당 폴더를 서비스 계정 이메일에 문서 생성·편집 가능한 권한으로 공유하거나 조직 정책에 따라 공유 드라이브 구성원으로 추가한다. 전용 폴더/드라이브만 공유해 데이터 접근 범위를 제한한다.
4. 그 폴더 URL의 마지막 ID를 `PROFILE_DOCS_FOLDER_ID`에 넣는다. **개인 내 드라이브의 공유 폴더는 공유 드라이브와 다르다.** 서비스 계정은 개인 저장 용량과 파일 소유권이 없으므로, 개인 폴더만 공유해서는 이 구현으로 새 Docs를 만들 수 없다. 공유 드라이브를 사용할 수 없다면 사용자 OAuth/위임 방식은 별도 설계가 필요하다. 이 구현은 위임이나 계정 사칭을 사용하지 않는다.

인증은 기존 `google-auth-library`를 유지한다. Sheets 호출은 `spreadsheets`, Drive/Docs 호출은 `drive.file` scope만 요청한다. Docs API는 `drive.file`을 허용하므로 별도 전체 `documents`나 전체 `drive` scope를 추가하지 않는다. `drive.file`과 공유 설정으로 해당 폴더를 볼 수 없으면 명확한 폴더 접근 오류를 내며 자동으로 권한을 확대하지 않는다.

공식 참고: [서비스 계정·공유 드라이브 제약](https://developers.google.com/workspace/drive/api/guides/about-shareddrives), [Drive 최소 권한](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Docs 허용 scope](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate).

## 열 구조 — 현재 A:Z

| 열 | 헤더 | 행 객체 키 |
|---|---|---|
| A | 인물ID | personId |
| B | 대분류 | majorType |
| C | 세부분류 | detailType |
| D | 이름 | name |
| E | 종목 | sport |
| F | 리그 | league |
| G | 소속팀 | team |
| H | 포지션 | position |
| I | 정당 | party |
| J | 직위 | office |
| K | 선거구·소속기관 | constituencyOrAgency |
| L | 지역 | region |
| M | 선출·임명구분 | appointmentType |
| N | 임기 | term |
| O | 검색키 | searchKey |
| P | 프롬프트유형 | promptType |
| Q | 자동화상태 | automationStatus |
| R | keyword | keyword |
| S | result | result |
| T | 최신정보확인일 | latestInfoDate |
| U | 제목 | title |
| V | 본문 | body |
| W | 태그 | tags |
| X | 조사출처 | sources |
| Y | GoogleDocsURL | googleDocsUrl |
| Z | 검수메모 | reviewMemo |

## 프롬프트와 로컬 작업 파일

프롬프트 설정 헤더는 `프롬프트ID`, `구분`, `적용대상`, `조합순서`, `사용여부`, `버전`, `프롬프트내용`이다. `사용여부=Y`인 필요한 ID만 골라 `조합순서` 오름차순으로 조합한다. 필수 ID가 없거나 중복되면 오류로 처리한다. COMMON_BASE가 처음, DOC_OUTPUT이 마지막이어야 한다.

- 운동선수: COMMON_BASE → ATHLETE_BASE → 종목 → DOC_OUTPUT
- 야구선수 BASEBALL / 축구선수 FOOTBALL / 농구선수 BASKETBALL / 배구선수 VOLLEYBALL / 골프선수 GOLF
- 정치인·공직자: COMMON_BASE → POLITICIAN → DOC_OUTPUT

소스에는 프롬프트 문구를 복사하지 않는다. 행 정보와 **Asia/Seoul 오늘 날짜**를 DOC_OUTPUT 직전에 넣는다. 스프레드시드 자체의 시간대와 무관하다. 동명이인 식별에는 이름만 쓰지 않고 **검색키, 소속팀, 정당, 직위, 지역**을 함께 사용한다.

`sheet:next`는 `posts/<행번호>-<keyword>/`에 다음 파일을 만든다.

- `sheet-source.json`: 프로필은 version 2, 기존 시트는 version 1. v2는 기존 출처 필드에 `personId`, `promptType`을 추가한다. v1 읽기·완료 동기화는 유지한다.
- `profile-task.json`: 작업 출처, 인물 식별자, 행 전체 객체, 사용한 프롬프트 ID와 기준일.
- `profile-prompt.txt`: Codex가 실제로 읽고 작성에 사용할 시트 프롬프트 스냅샷.

`profile-task.json` 예시(전체 row는 위 표의 26개 키를 모두 포함):

```json
{
  "version": 1,
  "spreadsheetId": "1LSL_RX2oXGoyBEve4gNNFjsy4VMEZgKi244Zj5Nn6u4",
  "sheetName": "Codex_작업큐",
  "rowNumber": 2,
  "personId": "SP000001",
  "name": "선택된 이름",
  "detailType": "야구선수",
  "searchKey": "선택된 이름 야구선수 소속팀",
  "promptType": "야구선수",
  "row": {
    "personId": "SP000001", "majorType": "운동선수", "detailType": "야구선수",
    "name": "선택된 이름", "sport": "프로야구", "league": "KBO 리그", "team": "소속팀",
    "position": "투수", "party": "", "office": "", "constituencyOrAgency": "", "region": "",
    "appointmentType": "", "term": "", "searchKey": "선택된 이름 야구선수 소속팀",
    "promptType": "야구선수", "automationStatus": "READY", "keyword": "선택된 이름 프로필",
    "result": "", "latestInfoDate": "", "title": "", "body": "", "tags": "", "sources": "",
    "googleDocsUrl": "", "reviewMemo": ""
  },
  "promptIds": ["COMMON_BASE", "ATHLETE_BASE", "BASEBALL", "DOC_OUTPUT"],
  "referenceDate": "2026-09-07"
}
```

Codex가 조사 후 작성할 파일:

1. `content.txt`: 티스토리 원고. 허용 마커는 **TITLE, H2, BOLD, HR, IMAGE** 5종뿐이다. PUBLISH, CATEGORY, TAGS, SCHEDULE, BODY, SOURCES, QUOTE를 넣지 않는다. 기존 draft 강제 정책과 입력 셀렉터는 바꾸지 않는다.
2. `profile-result.json`: 시트/Docs용 원고와 분리된 메타데이터.

```json
{
  "latestInfoDate": "2026-09-07",
  "title": "최종 제목",
  "body": "소제목을 포함한 최종 본문",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5", "태그6", "태그7", "태그8", "태그9", "태그10"],
  "sources": [
    {"name": "공식 기관", "title": "자료 제목", "date": "2026-09-07", "url": "https://example.org/profile"}
  ]
}
```

body는 제목을 제외하고 소제목을 포함하며, content.txt에서 허용 마커만 제거한 최종 본문과 일치해야 한다. 문단 사이 줄바꿈도 맞춘다. 출처 날짜를 확인할 수 없으면 빈 문자열을 허용하며 임의의 날짜를 만들지 않는다. 태그는 **기본 10개**로 작성하되 API 검증은 빈 배열·잘못된 타입을 거부하고 정확히 10개를 강제하지 않는다. `reviewMemo` 문자열은 필요한 검수사항이 있을 때만 선택적으로 추가한다.

인물 원고는 시트 프롬프트의 **공백 포함 약 1,000~1,200자** 기준을 확인한다. Codex는 작성 후 `profileBodyText(content).length`로 글자 수를 점검한다. 시트 프롬프트가 단일 기준이므로 CLI가 건강 글용 1,800~2,000자·이미지 4~5장 규칙을 v2 인물 글에 강제하지 않는다. 기존 일반 블로그 검증은 유지한다. `profile-prompt.txt`는 content.txt 대체 파일로 읽히지 않는다.

## 운영 명령과 순서

아래 명령은 저장소 루트에서 실행한다. 새로운 전용 workspace 경로를 실제 작업 경로로 바꾼다.

```powershell
pnpm sheet:next --workspace 'C:\Blog\ProfileWorkspace' --sheet-url 'https://docs.google.com/spreadsheets/d/1LSL_RX2oXGoyBEve4gNNFjsy4VMEZgKi244Zj5Nn6u4/edit' --sheet-name 'Codex_작업큐'
```

1. 출력된 선택 행과 작업 폴더를 확인한다. 기존 READY 작업이 있으면 그 폴더부터 재개한다. 다른 행을 동시에 작성하지 않는다.
2. `profile-task.json`, `profile-prompt.txt`를 읽는다. 최신 공식 자료·신뢰도 높은 자료를 조사해 동명이인, 현직, 팀/정당, 날짜를 교차 검증한다. 확인되지 않은 정보는 추측하지 않는다.
3. `content.txt`와 `profile-result.json`을 작성하고 글자 수·마커·본문 일치를 확인한다. 마커/제목/출처 URL은 글자 수에서 제외하고 본문 소제목은 포함한다. 실명 프로필 원고 생성은 Codex의 일이다.
4. 아래 명령으로 T:X 결과를 기록하고 Docs를 생성·검증한 뒤 Y URL을 기록한다. result에는 중간 상태를 쓰지 않는다.

```powershell
pnpm profile:sync --post 'C:\Blog\ProfileWorkspace\posts\선택된-폴더명'
```

5. 로그인한 전용 Chrome을 유지한다. 필요할 때만 로그인/확인 명령을 사용한다.

```powershell
pnpm draft:login
pnpm draft:verify --blog-url 'time-giver.tistory.com'
pnpm draft:run --workspace 'C:\Blog\ProfileWorkspace' --blog-url auto --max-posts 1
```

6. draft 실행은 각 프로필을 저장하기 직전에 결과 동기화와 READY/빈 result/인물ID/키워드를 재확인한다. 기존 임시저장 엔진으로 저장하고 로컬 `status.json=draft_saved` 확인 후에만 S에 `done`을 쓴다. 다시 읽어 확인한 뒤 Q를 `COMPLETE`로 변경·확인하고 `sheet-completion.json=sheet_done`을 남긴다.
7. Codex는 이 마지막 확인 전 완료 보고를 하지 않는다. 중간에는 진행 상황만 알린다. 외부 권한·로그인·저장 결과 불확실성이 실제로 막으면 완료했다고 하지 말고 정확한 상태와 재개 조건을 알린다.

Docs 이름은 `[인물ID] 이름 프로필`, 문서 내용은 제목 → 티스토리 원고 → 태그 → 조사 출처다. 원문 메타데이터용 금지 마커를 문서에 넣지 않는다. 문서는 공유 드라이브 폴더 안에서 직접 생성한다. 작업 키를 Drive appProperties에 저장하므로 재시도는 동일 문서를 찾는다. 동일한 본문이면 다시 쓰지 않는다. 변경 필요 시 revision을 확인하며 저장 후 본문도 읽어 확인한다. 자동화가 만든 문서를 사람이 편집한 경우 재동기화가 원고 파일 내용으로 갱신할 수 있으므로 먼저 HOLD로 두고 검수한다.

## 오류와 재개

- 오류 시 가능하면 Q=`ERROR`, Z=오류 요약을 기록한다. 인물ID/keyword가 바뀌었거나 사용자가 HOLD로 바꿨다면 그 행을 덮어쓰지 않는다. Google 권한/네트워크 오류로 오류 기록도 실패할 수 있으므로 CLI 종료 코드와 로그를 확인한다.
- 원인을 해결한 뒤 사용자가 Q를 READY로 돌린다. S는 임시저장 전까지 빈칸으로 유지한다. `sheet:next`로 같은 로컬 작업을 재개할 수 있고 누락된 프롬프트/작업 파일을 복구한다. 이미 생성된 프롬프트는 재개 때 임의 갱신하지 않는다.
- 임시저장 후 동기화만 실패했다면 status.json을 지우거나 새 글을 만들지 않는다. 같은 `draft:run` 또는 `sheet:next`가 `draft_saved`를 확인하고 결과 동기화와 완료 기록만 이어간다.
- `profile-draft.json`은 저장 직전에 준비한 원고·결과·출처 식별자의 SHA-256 해시다. 실제 실행에 불러온 글과 디스크 원고가 일치할 때만 생성한다. 임시저장 후 원고나 결과 파일을 바꿨다면 완료 재시도는 거부한다. 저장했던 파일을 복원해 재개하거나 실제 티스토리 글을 검수해야 한다. 이 파일을 수동으로 만들거나 해시를 바꿔 검증을 우회하지 않는다. 체크포인트 없는 v2 `draft_saved` 작업도 수동 검수가 필요하다.
- done까지 기록됐지만 COMPLETE 또는 로컬 체크포인트가 빠져도 복구한다. HOLD/ERROR는 사용자 제어이므로 자동 해제하지 않는다. `needs_review`는 실제 티스토리 임시저장을 먼저 확인하고 검수 처리해야 하며 무조건 재게시하지 않는다.
- `profile-sync.json`은 결과와 Docs 동기화 증거일 뿐 티스토리 임시저장 성공 증거가 아니다. `sheet-completion.json`만으로 임시저장을 추정하지도 않는다.
- 저장 도중 사용자가 HOLD로 바꾸면 완료 쓰기를 건너뛴다. CLI는 이번에 실행한 프로필의 `done`과 `COMPLETE`를 마지막으로 다시 읽어 확인하므로, 저장만 되고 완료 기록이 빠진 상황을 성공으로 보고하지 않는다.
- 이름이나 행을 변경할 때는 먼저 HOLD로 멈춘다. 헤더나 행을 자동화와 동시에 편집하지 않는다. Sheets 값 API에는 원자적 compare-and-swap이 없어 마지막 읽기와 쓰기 사이의 동시 편집을 완전히 잠글 수는 없다. 자동화는 매 쓰기 직전과 직후에 식별자·값을 검사한다. 동시에 여러 프로세스로 같은 큐를 처리하는 것은 지원하지 않는다.

## 검증 및 승인 후 수동 테스트

```powershell
pnpm test
pnpm run build
```

자동 테스트는 임시 로컬 폴더와 fake client/fetch 응답만 사용한다. 라이브 Sheets/Docs/Tistory에 쓰지 않는다.

실제 연결은 **별도 사용자 승인 후** 아래 순서로 1건만 확인한다.

1. 테스트용 시트 사본(정확한 26열/프롬프트 탭)과 공유 드라이브 테스트 폴더를 준비한다. 서비스 계정의 Sheets 편집·폴더 생성 권한을 확인한다.
2. 한 행만 READY로 두고 sheet:next를 실행해 행 전체·프롬프트ID·서울 기준일을 점검한다. HOLD/ERROR 행을 건너뛰는지도 확인한다.
3. 짧은 예시가 아닌 완성 원고 두 파일을 만들고 profile:sync를 실행한다. T:Y, Docs 이름/본문을 확인하고 S는 빈칸, Q는 READY인지 확인한다.
4. 같은 명령을 다시 실행해 Docs가 중복 생성되지 않는지 확인한다. 전용 브라우저 로그인 후 draft:run --max-posts 1을 실행한다.
5. 실제 임시저장, 로컬 draft_saved, S done, Q COMPLETE, sheet_done을 차례로 확인한다. 발행/예약되지 않았는지 확인한다.
6. 테스트 권한 회수/폴더 정리는 사람이 범위를 확인한 뒤 한다. 이 구현 작업에서 라이브 쓰기 테스트는 수행하지 않았다.

## 구현 파일 안내

- `src/sheets/sheetQueue.ts`, `profileSheetRow.ts`: 헤더 기반 선택·26개 필드 매핑.
- `promptSettings.ts`, `profileTask.ts`: 시트 프롬프트 조합·로컬 작업 스냅샷.
- `sheetSource.ts`: v1/v2 출처 파일 호환.
- `googleSheetsClient.ts`, `sheetAuth.ts`: 한 행 조회·정밀 쓰기·최소 OAuth scope.
- `profileResult.ts`, `profileResultSync.ts`, `profileDraftCheckpoint.ts`: 원고/결과 검증·저장 원고 해시·Sheets/Docs 동기화·오류 기록.
- `src/google/googleDocsClient.ts`: 공유 드라이브 문서 생성/재사용·본문 검증.
- `sheetResultSync.ts`: 보류 건 제외·임시저장 이후 done/COMPLETE 확인·재개.
- `src/cli/sheetNextCli.ts`, `profileSyncCli.ts`, `profileDraftGuard.ts`, `draftCli.ts`: CLI 연결.
- `src/core/postLoader.ts`: 기존 건강 글 검증 보존, 프로필 분리, 프롬프트 오인 방지.
- `package.json`: profile:sync와 CLI 빌드 연결. UI·Tistory 셀렉터·cliPostPolicy는 변경하지 않는다.
- 관련 테스트: `tests/sheets/profile*.test.ts`, `profileFixtures.ts`, `sheetSource.test.ts`, `tests/google/googleDocsClient.test.ts`, `tests/cli/{draftCli,sheetNextCli,profileSyncCli}.test.ts`, `tests/core/profilePostLoader.test.ts`.

최종 요청 문장: **다음 인물 프로필 작업 진행해줘.**
