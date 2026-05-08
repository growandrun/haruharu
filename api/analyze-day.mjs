import Anthropic from "@anthropic-ai/sdk";
import { applySecurityHeaders, applyCors } from "../lib/server/http.mjs";
import { authenticate } from "../lib/server/auth-utils.mjs";
import { consumeRateLimit } from "../lib/server/storage.mjs";

// Vercel 함수 최대 실행 시간 (초)
export const config = { maxDuration: 30 };

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? ""
});

/** 티어별 하루 AI 분석 허용 횟수 */
const DAILY_LIMITS = {
  plus: 3,
  premium: 10
};

/**
 * 무료 플랜은 계정 생성 이후 평생 딱 1회만 허용.
 * Redis 키가 이미 존재하면 한도 초과로 처리합니다.
 */
const FREE_LIFETIME_LIMIT = 1;

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

export default async function handler(req, res) {
  applySecurityHeaders(res);

  if (!applyCors(req, res)) {
    return res.status(403).json({ error: "origin_not_allowed" });
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // ── 1. 인증 ──────────────────────────────────────────────────
  const auth = await authenticate(req);
  if (!auth) {
    return res.status(401).json({ error: "auth_required" });
  }

  if (!auth.account.emailVerified) {
    return res.status(403).json({ error: "email_verification_required" });
  }

  // ── 2. 티어별 횟수 제한 ───────────────────────────────────────
  const tier = auth.account.tier ?? "free";
  const today = todayKey();

  if (tier === "free") {
    // 무료: 계정 전체 평생 1회 (일자 무관, TTL 없는 영구 키)
    const lifetimeKey = `ai:analyze:lifetime:${auth.account.id}`;
    if (!(await consumeRateLimit(lifetimeKey, 60 * 60 * 24 * 36500, FREE_LIFETIME_LIMIT))) {
      return res.status(429).json({
        error: "daily_free_limit_reached",
        message: "무료 플랜은 AI 분석을 1회만 체험할 수 있습니다. 플러스 또는 프리미엄으로 업그레이드하세요."
      });
    }
  } else {
    // 유료: 티어별 일일 한도
    const dailyLimit = DAILY_LIMITS[tier] ?? DAILY_LIMITS.plus;
    const rlKey = `ai:analyze:${auth.account.id}:${today}`;
    if (!(await consumeRateLimit(rlKey, 86400, dailyLimit))) {
      return res.status(429).json({
        error: "daily_free_limit_reached",
        message: "오늘 AI 분석 한도를 모두 사용했습니다. 내일 다시 이용해 주세요."
      });
    }
  }

  // ── 3. 입력 검증 ──────────────────────────────────────────────
  const {
    text,
    locale = "ko-KR",
    todayDateKey = today,
    recentRecords = []
  } = req.body ?? {};

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "bad_request", message: "분석할 텍스트가 없습니다." });
  }

  const trimmedText = text.slice(0, 4000);

  // 최근 기록 요약 (컨텍스트 제공, 최대 7일)
  const recentCtx = Array.isArray(recentRecords)
    ? recentRecords
        .slice(0, 7)
        .map((r) => `- ${r?.analysis?.summary ?? ""}`)
        .filter((s) => s.length > 2)
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

  // ── 4. Claude API 호출 ────────────────────────────────────────
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
  }
}
