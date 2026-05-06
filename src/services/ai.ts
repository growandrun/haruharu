import { analyzeLocally } from "../lib/analyzer";
import type { DayAnalysis, DayRecord } from "../types/app";

type AnalyzeResponse = {
  analysis?: DayAnalysis;
  error?: string;
  message?: string;
};

const runtimeEnv = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

const AI_ENDPOINT = getAiEndpoint();

export async function analyzeDay(text: string, history: DayRecord[], authToken?: string): Promise<DayAnalysis> {
  if (!AI_ENDPOINT) {
    return analyzeLocally(text, history);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify({
        text,
        locale: "ko-KR",
        todayDateKey: dateKeyFromDate(new Date()),
        recentRecords: history.slice(0, 14)
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as AnalyzeResponse;
      if ([401, 403, 429].includes(response.status)) {
        throw new Error(aiErrorMessage(payload.error));
      }
      throw new Error(`AI endpoint failed: ${response.status}`);
    }

    const payload = (await response.json()) as AnalyzeResponse;
    return payload.analysis ?? analyzeLocally(text, history);
  } catch (error) {
    if (error instanceof Error && error.message !== `AI endpoint failed`) {
      const protectedMessages = [
        "로그인이 필요합니다.",
        "이메일 인증이 필요합니다.",
        "무료 플랜의 오늘 AI 분석 한도를 모두 사용했습니다.",
        "AI 분석을 사용할 수 없습니다."
      ];
      if (protectedMessages.includes(error.message)) {
        throw error;
      }
    }
    return analyzeLocally(text, history);
  }
}

function dateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function aiErrorMessage(error?: string) {
  switch (error) {
    case "auth_required":
      return "로그인이 필요합니다.";
    case "email_verification_required":
      return "이메일 인증이 필요합니다.";
    case "daily_free_limit_reached":
      return "무료 플랜의 오늘 AI 분석 한도를 모두 사용했습니다.";
    default:
      return "AI 분석을 사용할 수 없습니다.";
  }
}

function getAiEndpoint() {
  const location = (globalThis as unknown as { location?: { protocol?: string; hostname?: string } }).location;
  if (location?.protocol?.startsWith("http") && location.hostname) {
    return `${location.protocol}//${location.hostname}:8787/analyze-day`;
  }

  return runtimeEnv?.EXPO_PUBLIC_AI_ENDPOINT;
}
