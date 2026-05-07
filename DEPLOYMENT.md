# Vercel 배포 가이드

이 가이드는 하루정리(haru-jeongri) 정적 웹과 인증 API(Vercel Functions)를 함께 배포하는 절차입니다. 이미 GitHub `growandrun/haruharu`가 Vercel에 연결되어 있다고 가정합니다.

## 1. Resend (이메일 발송) 설정

1. https://resend.com 로그인 → API Keys → 새 키 발급. **이전에 채팅에서 노출된 키는 즉시 삭제하고 새로 발급해 주세요.**
2. (선택) Domains → "Add Domain" → 본인 소유 도메인 추가 → DNS 레코드 등록(SPF, DKIM, MX 등). 검증되면 그 도메인으로 메일을 보낼 수 있습니다.
3. 검증된 도메인이 없으면 임시로 `onboarding@resend.dev`를 발신 주소로 사용 가능합니다(테스트용, 일 100통 제한).

> 📝 `haruharu@haru.com`처럼 본인이 소유하지 않은 도메인은 검증할 수 없으므로 발신 주소로 사용할 수 없습니다. `haru.com`을 보유하고 있다면 Resend Domain에 추가해 주세요.

## 2. Vercel KV (저장소) 설정

⚠️ Vercel은 자체 KV 서비스를 deprecate 하고, **Marketplace의 Upstash Redis 통합**으로 안내합니다. 본 프로젝트는 `@vercel/kv` 패키지를 사용하지만 Upstash가 주입하는 환경변수(`KV_REST_API_URL`, `KV_REST_API_TOKEN` 등)와 호환됩니다.

1. Vercel 프로젝트 페이지 → **Storage** 탭 → "Create Database" → **Marketplace Database Providers** → **Upstash for Redis** 선택 → 무료 플랜(Free, 10,000 명령/일)으로 생성
2. 생성된 Redis를 현재 프로젝트(haruharu)에 **Connect** → 환경변수가 자동으로 주입됩니다.
3. 별도의 환경변수 추가는 필요 없습니다.

## 3. Vercel 환경변수 설정

Vercel 프로젝트 → **Settings** → **Environment Variables** 에 다음 추가:

| 변수명 | 값 | 비고 |
|---|---|---|
| `RESEND_API_KEY` | `re_xxxxx...` | 1단계에서 발급한 새 키 |
| `MAIL_FROM` | `하루정리 <onboarding@resend.dev>` 또는 검증한 본인 도메인 | 한글 이름 + `<주소>` 형태 권장 |
| `APP_NAME` | `하루정리` | (선택) 메일 본문/제목 |
| `PASSWORD_PEPPER` | (랜덤 32바이트 base64url) | 아래 명령으로 생성 |
| `ALLOWED_ORIGINS` | `https://haruharu-growandruns-projects.vercel.app` | 운영 도메인 콤마 분리 (안 비우면 안전) |
| `NODE_ENV` | `production` | Vercel은 자동 설정하지만 명시 권장 |

`PASSWORD_PEPPER` 생성:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> ⚠️ `PASSWORD_PEPPER`를 한 번 정하면 변경 시 모든 사용자의 저장된 비밀번호 해시가 무효화됩니다. 처음에만 신중하게 정하고 절대 분실하지 마세요.

## 4. 배포

1. 위 환경변수 저장 후 **Redeploy** 클릭. 또는 GitHub `main`에 빈 커밋을 푸시해도 자동 재배포됩니다.
2. 배포가 끝나면 사이트를 열어 회원가입을 시도. 입력한 이메일 주소로 6자리 인증 코드가 발송되어야 합니다.

## 5. 자가 점검

- 회원가입 성공 → 이메일 도착 → 코드 입력 → 인증 완료 → 메인 진입
- 잘못된 코드 입력 시 "남은 시도 N회" 표시 후 5회 누적 시 코드 무효화
- 인증 메일을 다시 보낼 수 있는 버튼이 **3분 동안 비활성화** (남은 시간 mm:ss로 표기)
- 로그아웃 후 같은 이메일/비밀번호로 로그인 → 통과
- 비밀번호 5회 오답 → 15분 계정 잠금
- "비밀번호를 잊으셨나요?" → 이메일 입력 → 재설정 코드 메일 → 새 비밀번호 입력 → 자동 로그인

## 6. 문제 해결

### 회원가입 시 502 `email_send_failed`
- Resend API 키 미설정/잘못됨 → Vercel env vars 확인
- `MAIL_FROM` 도메인 미검증 → Resend Dashboard에서 도메인 검증 또는 `onboarding@resend.dev`로 폴백
- Resend 일일 한도 초과 → 로그/대시보드 확인

### 503 `email_unavailable`
- `RESEND_API_KEY`가 비어 있음 → 추가 후 재배포

### 회원가입/인증 시 500 / Storage 오류
- Upstash Redis 미연결 → Storage 탭에서 Connect 확인
- 환경변수 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 미주입 → Upstash 통합 재연결

### 로그인 시 403 `origin_not_allowed`
- `ALLOWED_ORIGINS`에 현재 접속 중인 Vercel 도메인이 포함되지 않음 → 도메인 추가 또는 변수 비움(개발용에서만)

### 인증 코드를 받지 못함
1. 스팸 메일함 확인
2. Resend Dashboard → Emails → 발송 상태 확인 (Bounced/Failed인지)
3. `MAIL_FROM` 도메인 인증 상태 확인

## 7. 메일이 받은편지함에 정상 도착하도록 (운영 단계)

- Resend Dashboard에서 **본인 도메인 추가 + SPF/DKIM/DMARC 인증** 완료 시 받은편지함 도달률 90%+
- `MAIL_FROM`을 `noreply@yourdomain.com` 형태로 변경 (이름 부분은 한글 가능: `하루정리 <noreply@yourdomain.com>`)
- 메일 발송량이 늘면 Resend Pro 플랜으로 업그레이드 (월 $20 / 50k 발송)

## 8. 비용 안내

- Vercel Hobby (무료): 정적 호스팅 + 100GB-hours of Functions 실행
- Upstash Redis Free: 10,000 commands/day (소규모 운영용 충분)
- Resend Free: 3,000 emails/month, 100/day (소규모 운영용 충분)

세 서비스의 무료 한도를 초과하면 자동 청구되지 않고 일시 차단되므로, 운영 시점에 모니터링이 필요합니다.
