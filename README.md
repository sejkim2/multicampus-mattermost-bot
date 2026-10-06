# Multicampus Mattermost Lunch Bot

20층 삼성웰스토리 식단과 10층 공존식단을 Mattermost Incoming Webhook으로 전송합니다. Node.js 20.12 이상이며 외부 패키지 설치는 필요 없습니다.

## 동작 방식

- **발송:** 평일 오전 9시(Asia/Seoul)에 `bot.js` 실행. 20층은 `C4T4767/baptimessafy`의 공개 JSON을 조회하고, 10층은 이 저장소의 `data-10f/YYYY-MM-DD.json`을 읽습니다.
- **10층 수집:** 평일 오전 6시에 설정한 Mattermost 채널의 주간 식단 이미지를 조회하고 Gemini로 파싱합니다. 같은 이미지이며 저장 데이터가 온전하면 다시 파싱하지 않습니다.
- **저장:** 월~금 메뉴와 미운영 사유를 날짜별 JSON으로 커밋합니다. 연도·실제 날짜·같은 주의 월~금·메뉴 형식을 모두 검증한 뒤 저장합니다.
- **수집 확인:** Mattermost에서 수집한 이미지는 날짜별 JSON과 파싱 이력을 저장한 후 원본 게시글에 ✅ 반응을 남깁니다. 반응은 수집에 사용하는 계정으로 표시됩니다. 이미 처리한 이미지도 누락된 반응은 보완하며, 같은 계정의 반응은 중복 등록하지 않습니다. 반응 등록만 실패한 경우 데이터는 유지하고 다음 실행에서 다시 시도합니다. 로컬 이미지·수동 JSON 입력은 원본 게시글이 없어 반응을 남기지 않습니다.
- **표시:** 20층의 기존 사진·메뉴·영양 정보 표를 유지하고, 10층 도시락·샌드위치(원본 브런치)·샐러드를 추가합니다. 10층에 없는 사진·영양 수치를 만들지 않습니다.
- 한 층에만 메뉴가 있어도 발송합니다. 양쪽 메뉴가 없거나 미운영이면 발송하지 않습니다. 20층 메뉴가 있고 10층이 미운영이면 10층의 미운영 사유를 함께 표시합니다.
- Gemini 키나 수집 채널을 설정하기 전에는 자동 수집 워크플로가 안내 로그를 남기고 건너뜁니다. 저장된 식단 발송은 계속 사용할 수 있습니다.

발송 및 수집의 시간대 설정은 [GitHub Actions 공식 문서](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule)를 따릅니다. 예약 실행은 [혼잡 시 지연되거나 누락될 수 있습니다](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows).

## GitHub 설정

`Settings → Secrets and variables → Actions`에서 다음 값을 설정하세요. 키·계정·웹훅은 코드나 공개 JSON에 넣지 않습니다.

| 구분 | 이름 | 값 / 용도 |
| --- | --- | --- |
| Secret | `MM_WEBHOOK_URL` | 메시지를 보낼 Incoming Webhook URL. 발송에 필수 |
| Secret | `GEMINI_API_KEY` | 이미지 파싱에 필수. 수동 JSON 입력에는 불필요 |
| Secret | `MM_LOGIN_JSON` | 자동 수집용 `{"login_id":"계정","password":"비밀번호"}` |
| Secret | `MM_ACCESS_TOKEN` | 로그인 JSON 대신 사용할 수집 계정 토큰. 설정하면 우선 사용 |
| Secret | `MM_MENU_CHANNEL_ID` | 이미지가 올라오는 채널 ID. 설정하면 팀/채널 이름보다 우선 사용 |
| Variable | `MM_MENU_TEAM_NAME` | 채널 URL의 팀 이름. 채널 ID가 없을 때 필요 |
| Variable | `MM_MENU_CHANNEL_NAME` | 채널 URL의 채널 이름. 채널 ID가 없을 때 필요 |
| Variable | `GEMINI_MODELS` | 선택. 기본 `gemini-3.8-flash`. 쉼표로 모델 폴백 지정 |
| Secret | `MM_ALERT_WEBHOOK_URL` | 선택. 수집 실패 시 관리자에게 알림 |

예를 들어 채널 주소가 `https://meeting.ssafy.com/팀이름/channels/채널이름`이면 팀/채널 이름을 각각 설정합니다. `/hooks/...`는 발송 전용이며 이미지 조회에는 사용할 수 없습니다. 수집 계정은 지정 채널에 접근할 수 있어야 합니다. 파일명에 `10층` 또는 `공존식단`/`공존메뉴`가 포함된 이미지를 찾으며 기본 탐색 범위는 최근 28일, 최대 5페이지입니다. `MM_MENU_MAX_PAGES`, `MM_MENU_MAX_POST_AGE_DAYS` Variables로 범위를 조정할 수 있습니다.

수집 결과를 저장소에 푸시하려면 Actions의 쓰기 권한과 브랜치 정책이 이를 허용해야 합니다. 예약 워크플로는 기본 브랜치의 코드를 사용하므로 변경 사항을 기본 브랜치에 반영한 뒤 실행됩니다.

## 제공된 이번 주 식단

사용자가 제공한 이미지의 10월 5~9일 식단을 `examples/10f-2026-10-05.json`에 옮겼습니다. 이미지에 연도가 없어 현재 날짜와 요일 배열에 맞는 **2026년**으로 해석했습니다. 원문의 메뉴 표기를 보존했고 알레르기·원산지 설명을 메뉴에 섞지 않았습니다.

| 날짜 | 운영 정보 |
| --- | --- |
| 10월 5일 | 개천절 대체공휴일, 미운영 |
| 10월 6일 | 도시락·브런치·샐러드 |
| 10월 7일 | 도시락·브런치·샐러드 |
| 10월 8일 | 1학기 MEET UP 행사로 미운영 |
| 10월 9일 | 한글날, 미운영 |

해당 날짜의 데이터를 `data-10f/`에도 저장했습니다. 이후 다른 주의 JSON을 직접 입력할 때는 같은 형식으로 만들고 아래 명령을 실행하세요. 미운영일에도 `status: "closed"`, `closureReason`, 빈 메뉴 배열을 입력합니다.

```powershell
node scripts/fetch-10f.js --json examples/10f-2026-10-05.json --reference-date 2026-10-06
```

## 이미지 직접 입력

Mattermost 자동 수집을 설정하지 않아도 로컬 이미지를 파싱할 수 있습니다. `.env_example`을 `.env`로 복사하고 `gemini_key`에 실제 키를 넣으세요. 실행할 때 프로젝트 루트의 `.env`를 자동으로 읽습니다. `GEMINI_API_KEY` 이름도 지원하며, 두 값이 있으면 `GEMINI_API_KEY`를 우선 사용합니다.

```powershell
Copy-Item .env_example .env
# .env 파일의 gemini_key= 뒤에 실제 키 입력
npm run fetch-10f -- --image "C:\식단\주간식단.png"
```

과거 이미지의 연도가 적혀 있지 않으면 `--reference-date 2026-10-06`처럼 해당 주의 기준 날짜를 지정하세요. PNG·JPEG·WebP, 최대 10MB를 지원합니다. 이미지를 다시 읽어 수정하려면 `--force`를 추가합니다. Gemini 호출은 [이미지 이해](https://ai.google.dev/gemini-api/docs/image-understanding)와 [JSON 구조화 출력](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) REST API를 사용합니다.

GitHub Actions의 `Collect 10F Weekly Menu → Run workflow`에서는 저장소에 넣은 이미지의 경로를 `image_path`에 입력할 수 있습니다. 비워두면 설정된 Mattermost 채널을 조회합니다. 로컬에서 생성한 `data-10f/` 파일은 커밋·푸시해야 GitHub의 발송 워크플로에서도 읽을 수 있습니다.

## 미리보기와 테스트 발송

웹훅과 Gemini 키 없이 10층 메시지를 미리 확인할 수 있습니다.

```powershell
node bot.js --date 2026-10-06 --only-10f --dry-run --test
npm test
```

테스트 웹훅을 로컬 `.env`의 `MM_WEBHOOK_URL`에 직접 넣으면 발송할 수 있습니다.

```powershell
npm start -- --date 2026-10-06 --test
```

`Send Multicampus Lunch Menu → Run workflow`에서도 날짜와 미리보기 여부를 선택할 수 있습니다. 수동 실행은 기본적으로 미리보기이며 실제 발송하려면 `dry_run`을 해제하세요. 자동 실행은 테스트 표시 없이 발송합니다. 수동 재실행은 같은 날짜의 메시지를 다시 보낼 수 있습니다.
