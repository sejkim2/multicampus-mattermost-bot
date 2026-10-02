# Multicampus Mattermost Lunch Bot

멀티캠퍼스 점심 식단을 공개 JSON에서 조회해 Mattermost Incoming Webhook으로 전송하는 봇입니다.

## 동작 방식

- GitHub Actions가 평일 오전 10시(Asia/Seoul)에 실행됩니다.
- `C4T4767/baptimessafy`의 날짜별 공개 식단 JSON을 읽습니다.
- Mattermost Incoming Webhook으로 오늘의 메뉴를 전송합니다.
- 별도 서버와 Welstory 로그인 계정은 필요하지 않습니다.

## 설정

GitHub 저장소에서 다음 Secret을 추가하세요.

`Settings → Secrets and variables → Actions → New repository secret`

- Name: `MM_WEBHOOK_URL`
- Value: Mattermost Incoming Webhook URL

## 테스트

`Actions → Send Multicampus Lunch Menu → Run workflow`에서 수동 실행할 수 있습니다.

## 참고

식단 원본 데이터가 아직 생성되지 않았거나 메뉴가 없는 날에는 Mattermost에 메시지를 보내지 않고 정상 종료합니다.
