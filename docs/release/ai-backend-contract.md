# AI 백엔드 계약

앱은 `EXPO_PUBLIC_AI_ENDPOINT`가 설정되어 있으면 해당 엔드포인트로 하루 기록 분석 요청을 보냅니다. API 키는 앱에 넣지 않고 서버에서만 관리합니다.

이 저장소에는 로컬 개발용 OpenAI 백엔드가 포함되어 있습니다.

```bash
cp .env.ai.example .env.ai
npm run ai:server
```

또는 Expo 웹앱과 AI 서버를 함께 실행합니다.

```bash
npm run dev:ai
```

## 요청

```http
POST /analyze-day
Content-Type: application/json
```

```json
{
  "text": "오늘 점심 9000원, 커피 5500원 썼고 과제는 못 끝냈고 친구랑 약속 잡아야 함. 요즘 좀 피곤함.",
  "locale": "ko-KR",
  "recentRecords": []
}
```

## 응답

```json
{
  "analysis": {
    "summary": "오늘은 지출이 평소와 비슷했고 2개의 할 일이 잡혔습니다. 피로 신호가 있습니다.",
    "expenses": [
      {
        "id": "expense-1",
        "label": "점심",
        "amount": 9000,
        "confidence": 0.9
      }
    ],
    "todos": [
      {
        "id": "todo-1",
        "title": "친구에게 약속 연락하기",
        "done": false,
        "source": "ai"
      }
    ],
    "moods": [
      {
        "label": "피로",
        "score": 35,
        "detail": "회복 시간이 필요한 신호가 있습니다."
      }
    ],
    "notes": [],
    "tomorrowPlan": [
      "과제 마무리하기",
      "친구에게 약속 연락하기"
    ],
    "wasteSignals": [],
    "createdAt": "2026-05-03T00:00:00.000Z"
  }
}
```

## 서버 권장 동작

- JSON 스키마 검증 실패 시 `400` 반환
- AI 제공자 실패 시 `502` 또는 `503` 반환
- 요청당 최대 글자 수 제한
- 사용자 식별자가 추가되는 경우 서버에서 권한 확인
- 민감 정보 로깅 최소화
- 응답은 항상 앱의 `DayAnalysis` 타입과 호환되게 유지
