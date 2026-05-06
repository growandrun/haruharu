# 출시 전 체크리스트

## 앱 설정

- `eas build:configure`로 실제 EAS 프로젝트 ID 연결
- iOS Bundle ID `com.haru.jeongri` 확정
- Android Package `com.haru.jeongri` 확정
- 앱 아이콘, 스플래시, 적응형 아이콘 확인
- App Store Connect 앱 생성
- Google Play Console 앱 생성

## 계정 및 인증

- Apple Developer Program 가입
- Google Play Console 개발자 계정 생성
- EAS 계정 로그인
- iOS 배포 인증서와 프로비저닝 프로파일 준비
- Android 업로드 키 또는 Play App Signing 설정

## AI 서버

- `EXPO_PUBLIC_AI_ENDPOINT` 운영 URL 준비
- 앱에 API 키 직접 포함 금지
- 서버에서 OpenAI 또는 AI 제공자 키 관리
- 입력/응답 JSON 스키마 검증
- 요청 제한, 오류 처리, 로깅, 개인정보 마스킹 정책 준비

## 개인정보 및 약관

- 개인정보 처리방침 웹 URL 게시
- 이용약관 웹 URL 게시
- 고객 지원 URL 게시
- 실제 사업자 정보, 연락처, 데이터 보관 기간 반영
- AI 분석 한계와 데이터 처리 방식 명시

## 결제

- Apple 인앱결제 상품 생성
- Google Play 결제 상품 생성
- 무료, 유료, 프리미엄 권한 서버 검증 준비
- 영수증 검증 서버 또는 구독 상태 동기화 준비

## 품질 확인

- iPhone 작은 화면, 일반 화면, iPad 확인
- Android 작은 화면, 일반 화면 확인
- 네트워크 오류 시 로컬 분석 폴백 확인
- 빈 입력, 긴 입력, 금액 입력, 감정 표현 입력 확인
- 앱 삭제 후 데이터 초기화 확인
- 스토어 심사용 테스트 계정 준비

## 빌드

```bash
npm install
npm run typecheck
eas build:configure
npm run build:all
```

## 제출

```bash
npm run submit:ios
npm run submit:android
```

## 출시 직전 남은 외부 작업

- 실제 도메인 연결
- 실제 AI 백엔드 배포
- 실제 인앱결제 연결
- 스토어 심사용 스크린샷 업로드
- 스토어 개인정보 설문 작성
