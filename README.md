# 하루정리

한국인의 하루를 AI가 자동으로 정리해주는 생활 관리 앱 MVP입니다. React Native/Expo 기반이라 iOS, Android, Web으로 확장할 수 있습니다.

## 포함된 기능

- 회원 프로필 저장
- 하루 기록 입력
- AI 자동 정리: 소비, 할 일, 감정, 메모, 내일 계획
- 오늘 요약 카드
- 주간 리포트: 지출, 자주 쓰는 항목, 낭비 신호, 감정 패턴, 미룬 일
- 무료/유료/프리미엄 플랜 화면
- EAS 기반 iOS/Android 배포 설정

## 실행

```bash
npm install
npm run start
```

기기에서 테스트하려면 Expo Go 또는 개발 빌드를 사용하세요.

```bash
npm run android
npm run ios
```

## AI 연결

앱에 API 키를 직접 넣지 않도록 `EXPO_PUBLIC_AI_ENDPOINT`에는 AI 서버 주소만 넣습니다. OpenAI API 키는 `server/ai-server.mjs`가 읽는 `.env.ai` 또는 서버 환경변수에만 둡니다. 엔드포인트가 없거나 실패하면 앱은 로컬 분류기로 폴백합니다.

```bash
cp .env.example .env
cp .env.ai.example .env.ai
```

`.env.ai`에 실제 키를 넣으세요.

```bash
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-5-mini
```

AI 서버와 Expo 웹앱을 함께 실행하려면:

```bash
npm run dev:ai
```

서버만 따로 실행하려면:

```bash
npm run ai:server
```

AI 서버는 다음 형태로 응답합니다.

```json
{
  "analysis": {
    "summary": "오늘은 지출이 평소보다 높고 피로 신호가 있습니다.",
    "expenses": [],
    "todos": [],
    "moods": [],
    "notes": [],
    "tomorrowPlan": [],
    "wasteSignals": [],
    "createdAt": "2026-05-03T00:00:00.000Z"
  }
}
```

## 앱스토어/플레이스토어 빌드

Expo 공식 문서 기준으로 EAS Build를 사용합니다.

```bash
npm install -g eas-cli
eas login
eas build:configure
npm run build:all
```

출시 전에는 `eas build:configure`로 실제 EAS 프로젝트를 연결하고, Apple Developer Program과 Google Play Console 계정을 준비해야 합니다.

## 출시 준비 문서

`docs/release`에 출시 직전 작업에 필요한 문서를 정리했습니다.

- `app-store-metadata.md`: App Store와 Google Play 등록 문구
- `privacy-policy.md`: 개인정보 처리방침 초안
- `terms-of-service.md`: 이용약관 초안
- `launch-checklist.md`: 출시 전 체크리스트
- `ai-backend-contract.md`: AI 서버 API 계약

## 다음 구현 포인트

- 실제 회원가입/로그인 백엔드
- OpenAI 또는 자체 AI 서버 엔드포인트
- Apple/Google 인앱결제 SDK 연결
- 푸시 알림
- 음성 입력 전사 API
"# haru-app" 
"# haru-app" 
