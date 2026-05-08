import Anthropic from "@anthropic-ai/sdk";
import { applySecurityHeaders, applyCors, clientIp, cleanText } from "../lib/server/http.mjs";
import { authenticate } from "../lib/server/auth-utils.mjs";
import {
  consumeRateLimitAtomic,
  acquireAiLock,
  releaseAiLock
} from "../lib/server/storage.mjs";
import { Redis } from "@upstash/redis";

// Vercel 함수 최대 실행 시간 (초)
export const config = { maxDuration: 30 };

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? ""
});

// IP 레벨 속도 제한에 사용하는 별도 Redis 인스턴스
// (storage.mjs의 redis는 export되지 않으므로 여기서 직접 생성)
const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? "",
  token: process.env.KV_REST_API_TOKEN ?? ""
});

/** 티어별 하루 AI 분석 허용 횟수 */
const DAILY_LIMITS = {
  plus: 3,
  premium: 10
};

/**
 * 티어별 연속 요청 최소 간격(초).
 * 하루 한도를 1초 안에 소진하는 버스트 공격 방지.
 */
const COOLDOWN_SECONDS = {
  plus: 15,
  premium: 10
};

/**
 * 무료 플랜은 계정 생성 이후 평생 딱 1회만 허용.
 * Redis 키가 이미 존재하면 한도 초과로 처리합니다.
 */
const FREE_LIFETIME_LIMIT = 1;

/** IP당 시간별 AI 호출 최대 허용 횟수 (모든 계정 합산) */
const IP_HOURLY_LIMIT = 20;

/**
 * 로케일 화이트리스트 — 이 외의 값은 Claude 프롬프트에 주입되지 않습니다.
 */
const ALLOWED_LOCALES = new Set(["ko-KR", "en-US"]);

/**
 * 시스템 프롬프트 — cache_control 적용해 반복 호출 비용 절감.
 * 내용이 바뀌지 않는 한 Anthropic 캐시(5분 TTL)에 유지됩니다.
 */
const SYSTEM_PROMPT = `당신은 하루정리 앱의 AI 분석 엔진입니다.
사용자가 자유롭게 입력한 하루 기록 텍스트를 분석하여 구조화된 JSON을 반환합니다.

분석 규칙:
1. expenses  — 금액이 명시된 지출만 추출. label은 카테고리(예: 커피·교통·식비), amount는 정수(원), confidence는 0~1.
2. todos     — 미완료·예정·계획 항목. title은 간결한 행동형(~하기), done은 항상 false, source는 "ai".
3. moods     — 텍스트에서 감지된 감정. label(피로·안정·불안·긴장·저하·보통 등), score(0~100), detail(한 문장).
4. notes     — 지출·감정·할일 외 기억할 만한 메모. 최대 4개.
5. tomorrowPlan — 내일을 위한 구체적 행동 제안. 최대 5개.
6. wasteSignals — 시간·돈 낭비 가능성 신호 문자열. 없으면 빈 배열.
7. summary   — 지출 흐름·감정·할일을 포괄하는 2~3문장 한국어 요약.

필드 형식:
- dateKey: "YYYY-MM-DD"
- id: "expense-0", "expense-1" / "todo-0", "todo-1" 형식
- createdAt: ISO 8601 문자열

중요: 마크다운, 코드블록, 설명 없이 순수 JSON 객체만 반환하세요.

스키마:
{
  "summary": string,
  "expenses": [{ "id": string, "label": string, "amount": number, "confidence": number, "dateKey": string }],
  "todos": [{ "id": string, "title": string, "done": false, "source": "ai", "dateKey": string }],
  "moods": [{ "label": string, "score": number, "detail": string, "dateKey": string }],
  "notes": string[],
  "tomorrowPlan": string[],
  "wasteSignals": string[],
  "createdAt": string
}`;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** 시간 단위 키 — "2024-01-15T09" 형식 (UTC 기준) */
function hourKey() {
  return new Date().toISOString().slice(0, 13);
}

export default async function handler(req, res) {
  // ── Layer 1: 보안 헤더 + CORS + 메서드 체크 ─────────────────────
  applySecurityHeaders(res);

  if (!applyCors(req, res)) {
    return res.status(403).json({ error: "origin_not_allowed", message: "허용되지 않은 출처입니다." });
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "POST 메서드만 허용됩니다." });
  }

  // ── Layer 2: 인증 ────────────────────────────────────────────────
  const auth = await authenticate(req);
  if (!auth) {
    return res.status(401).json({ error: "auth_required", message: "로그인이 필요합니다." });
  }

  // ── Layer 3: 이메일 인증 확인 ────────────────────────────────────
  if (!auth.account.emailVerified) {
    return res.status(403).json({
      error: "email_verification_required",
      message: "이메일 인증 후 이용 가능합니다."
    });
  }

  const tier = auth.account.tier ?? "free";
  const userId = auth.account.id;
  const today = todayKey();

  // ── Layer 4: IP 레벨 시간별 속도 제한 (계정 공유/다계정 남용 방지) ──
  // 동일 IP에서 시간당 최대 20회 — 모든 계정의 호출을 합산
  const ip = clientIp(req);
  const ipRlKey = `haru:ai:ip:${ip}:${hourKey()}`;
  const ipLuaScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], 3600)
end
return count
`;
  const ipCount = await redis.eval(ipLuaScript, [ipRlKey], []);
  if (Number(ipCount) > IP_HOURLY_LIMIT) {
    return res.status(429).json({
      error: "ip_rate_limit_exceeded",
      message: "동일 네트워크에서 너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해 주세요."
    });
  }

  // ── Layer 5: 티어별 일일 한도 (원자적 INCR — 레이스 컨디션 방지) ─
  if (tier === "free") {
    // 무료: 계정 전체 평생 1회 (일자 무관, TTL 없는 영구 키)
    const lifetimeKey = `ai:analyze:lifetime:${userId}`;
    if (!(await consumeRateLimitAtomic(lifetimeKey, 60 * 60 * 24 * 36500, FREE_LIFETIME_LIMIT))) {
      return res.status(429).json({
        error: "daily_free_limit_reached",
        message: "무료 플랜은 AI 분석을 1회만 체험할 수 있습니다. 플러스 또는 프리미엄으로 업그레이드하세요."
      });
    }
  } else {
    // 유료: 티어별 일일 한도
    const dailyLimit = DAILY_LIMITS[tier] ?? DAILY_LIMITS.plus;
    const rlKey = `ai:analyze:${userId}:${today}`;
    if (!(await consumeRateLimitAtomic(rlKey, 86400, dailyLimit))) {
      return res.status(429).json({
        error: "daily_limit_reached",
        message: "오늘 AI 분석 한도를 모두 사용했습니다. 내일 다시 이용해 주세요."
      });
    }
  }

  // ── Layer 6: 최소 요청 간격 (쿨다운) — 버스트 소진 방지 ───────────
  // plus: 15초, premium: 10초, free: 쿨다운 없음 (평생 1회이므로 불필요)
  const cooldownSeconds = COOLDOWN_SECONDS[tier];
  if (cooldownSeconds) {
    const cooldownKey = `haru:aicooldown:${userId}`;
    // SET NX EX: 키가 없으면 설정하고 true, 이미 있으면 false
    const acquired = await redis.set(cooldownKey, "1", { nx: true, ex: cooldownSeconds });
    if (acquired !== "OK") {
      return res.status(429).json({
        error: "cooldown_active",
        message: "잠시 후 다시 시도해 주세요."
      });
    }
  }

  // ── Layer 7: 동시 요청 잠금 — 병렬 요청으로 한도 우회 방지 ─────────
  // acquireAiLock: SET NX EX 30 on haru:ailock:{userId}
  const lockAcquired = await acquireAiLock(userId);
  if (!lockAcquired) {
    return res.status(429).json({
      error: "concurrent_request",
      message: "이미 분석이 진행 중입니다. 완료 후 다시 시도해 주세요."
    });
  }

  // ── Layer 8: 입력 검증 및 정제 ───────────────────────────────────
  const {
    text,
    locale: rawLocale = "ko-KR",
    todayDateKey = today,
    recentRecords = []
  } = req.body ?? {};

  if (!text || typeof text !== "string" || !text.trim()) {
    await releaseAiLock(userId);
    return res.status(400).json({ error: "bad_request", message: "분석할 텍스트가 없습니다." });
  }

  // 8-a. 본문 크기 제한: 3000자 초과 시 거부 (조용한 슬라이스 대신 명시적 오류)
  const trimmedRaw = text.trim();
  if (trimmedRaw.length > 3000) {
    await releaseAiLock(userId);
    return res.status(400).json({
      error: "text_too_long",
      message: "입력 텍스트는 3,000자 이하여야 합니다."
    });
  }

  // 8-b. 제어문자·영폭 문자 제거 (프롬프트 인젝션 방지)
  const trimmedText = cleanText(trimmedRaw, 3000);

  // 8-c. 로케일 화이트리스트 검증
  const locale = ALLOWED_LOCALES.has(rawLocale) ? rawLocale : "ko-KR";

  // 8-d. recentRecords 요약 정제: 각 summary를 100자로 자르고 제어문자 제거
  const recentCtx = Array.isArray(recentRecords)
    ? recentRecords
        .slice(0, 7)
        .map((r) => {
          const raw = r?.analysis?.summary ?? "";
          // cleanText로 제어문자 제거 후 100자로 truncate
          const safe = cleanText(String(raw), 100);
          return safe ? `- ${safe}` : null;
        })
        .filter(Boolean)
        .join("\n")
    : "";

  const userMessage = [
    `날짜: ${todayDateKey}`,
    `언어: ${locale}`,
    recentCtx ? `\n최근 7일 요약:\n${recentCtx}` : "",
    `\n오늘의 기록:\n${trimmedText}`
  ]
    .filter(Boolean)
    .join("\n");

  // ── Layer 9: Claude API 호출 (finally에서 반드시 잠금 해제) ────────
  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [{ role: "user", content: userMessage }]
    });

    // 텍스트 블록 추출
    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock?.text?.trim() ?? "";

    // JSON 파싱 — 혹시 코드블록으로 감싸는 경우 대비
    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        analysis = JSON.parse(m[0]);
      } else {
        throw new Error("Claude가 유효한 JSON을 반환하지 않았습니다.");
      }
    }

    if (!analysis.createdAt) {
      analysis.createdAt = new Date().toISOString();
    }

    return res.status(200).json({ analysis });
  } catch (error) {
    console.error("[analyze-day]", error?.message ?? error);
    return res.status(500).json({
      error: "server_error",
      message: "AI 분석 중 오류가 발생했습니다."
    });
  } finally {
    // 성공·실패 여부와 무관하게 반드시 잠금 해제
    await releaseAiLock(userId);
  }
}
