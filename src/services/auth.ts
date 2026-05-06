import type { SubscriptionTier, UserSettings } from "../types/app";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  tier: SubscriptionTier;
  paymentStatus: UserSettings["paymentStatus"];
  pendingTier?: SubscriptionTier;
  depositorName: string;
  paymentRequestedAt?: string;
  paymentApprovedAt?: string;
};

type AuthResponse = {
  token?: string;
  user?: AuthUser;
  error?: string;
  message?: string;
};

const runtimeEnv = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

const AI_ENDPOINT = runtimeEnv?.EXPO_PUBLIC_AI_ENDPOINT;
const AUTH_BASE_URL = getAuthBaseUrl();
const DEMO_TOKEN = "demo-token";

let demoUser: { name: string; email: string; userId: string } | null = null;

export function hasAuthServer() {
  return Boolean(AUTH_BASE_URL);
}

export async function signup(name: string, email: string, password: string): Promise<UserSettings> {
  if (!AUTH_BASE_URL) {
    return demoSignup(name, email);
  }
  const payload = await authRequest("/auth/signup", { name, email, password });
  return settingsFromAuth(payload);
}

export async function login(email: string, password: string): Promise<UserSettings> {
  if (!AUTH_BASE_URL) {
    if (demoUser && demoUser.email === email.trim()) {
      return demoVerifiedSettings();
    }
    throw new Error("이 환경에서는 인증 서버가 연결되지 않아 로그인을 사용할 수 없습니다. 회원가입을 먼저 진행해 주세요.");
  }
  const payload = await authRequest("/auth/login", { email, password });
  return settingsFromAuth(payload);
}

export async function logout(token?: string) {
  if (!token || !AUTH_BASE_URL || token === DEMO_TOKEN) return;
  await fetch(`${AUTH_BASE_URL}/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  }).catch(() => undefined);
}

export async function verifyEmail(token: string, code: string): Promise<UserSettings> {
  if (!AUTH_BASE_URL || token === DEMO_TOKEN) {
    if (!/^\d{6}$/.test(code.trim())) {
      throw new Error("6자리 숫자 코드를 입력해 주세요. (데모 환경에서는 아무 6자리 코드나 입력하면 됩니다)");
    }
    return demoVerifiedSettings();
  }
  const payload = await authRequest("/auth/verify-email", { code }, token);
  return settingsFromUser(payload.user);
}

export async function resendVerification(token: string) {
  if (!AUTH_BASE_URL || token === DEMO_TOKEN) return;
  await authRequest("/auth/resend-verification", {}, token);
}

export async function requestPayment(token: string, tier: SubscriptionTier, depositorName: string): Promise<UserSettings> {
  if (!AUTH_BASE_URL || token === DEMO_TOKEN) {
    throw new Error("결제 신청은 인증 서버가 연결된 환경에서만 가능합니다.");
  }
  const payload = await authRequest("/payments/request", { tier, depositorName }, token);
  return settingsFromUser(payload.user);
}

async function authRequest(path: string, body: unknown, token?: string): Promise<AuthResponse> {
  if (!AUTH_BASE_URL) {
    throw new Error("인증 서버 주소가 설정되지 않았습니다.");
  }

  const response = await fetch(`${AUTH_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as AuthResponse;

  if (!response.ok) {
    throw new Error(payload.message ?? authErrorMessage(payload.error));
  }

  return payload;
}

function settingsFromAuth(payload: AuthResponse): UserSettings {
  if (!payload.token || !payload.user) {
    throw new Error("인증 응답이 올바르지 않습니다.");
  }

  return {
    ...settingsFromUser(payload.user),
    authToken: payload.token
  };
}

function settingsFromUser(user?: AuthUser): UserSettings {
  if (!user) {
    throw new Error("사용자 정보를 불러오지 못했습니다.");
  }

  return {
    tier: user.tier,
    isLoggedIn: true,
    userId: user.id,
    authToken: undefined,
    emailVerified: Boolean(user.emailVerified),
    signupEmailVerificationPending: !user.emailVerified,
    paymentStatus: user.paymentStatus,
    pendingTier: user.pendingTier,
    depositorName: user.depositorName,
    paymentRequestedAt: user.paymentRequestedAt,
    paymentApprovedAt: user.paymentApprovedAt,
    reminderHour: 22,
    reminderMinute: 0,
    summaryReminderEnabled: false,
    privacyMode: true,
    displayName: user.name,
    email: user.email
  };
}

function demoSignup(name: string, email: string): UserSettings {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const userId = `demo-${Date.now()}`;
  demoUser = { name: trimmedName, email: trimmedEmail, userId };

  return {
    tier: "free",
    isLoggedIn: true,
    userId,
    authToken: DEMO_TOKEN,
    emailVerified: false,
    signupEmailVerificationPending: true,
    paymentStatus: "none",
    pendingTier: undefined,
    depositorName: "",
    paymentRequestedAt: undefined,
    paymentApprovedAt: undefined,
    reminderHour: 22,
    reminderMinute: 0,
    summaryReminderEnabled: false,
    privacyMode: true,
    displayName: trimmedName,
    email: trimmedEmail
  };
}

function demoVerifiedSettings(): UserSettings {
  const name = demoUser?.name ?? "";
  const email = demoUser?.email ?? "";
  const userId = demoUser?.userId ?? `demo-${Date.now()}`;

  return {
    tier: "free",
    isLoggedIn: true,
    userId,
    authToken: DEMO_TOKEN,
    emailVerified: true,
    signupEmailVerificationPending: false,
    paymentStatus: "none",
    pendingTier: undefined,
    depositorName: "",
    paymentRequestedAt: undefined,
    paymentApprovedAt: undefined,
    reminderHour: 22,
    reminderMinute: 0,
    summaryReminderEnabled: false,
    privacyMode: true,
    displayName: name,
    email
  };
}

function authErrorMessage(error?: string) {
  switch (error) {
    case "email_already_exists":
      return "이미 가입된 이메일입니다.";
    case "invalid_credentials":
      return "이메일 또는 비밀번호가 맞지 않습니다.";
    case "too_many_attempts":
      return "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    case "invalid_admin_approval":
      return "관리자 승인 코드가 맞지 않습니다.";
    case "email_verification_required":
      return "이메일 인증이 필요합니다.";
    case "invalid_email_verification_code":
      return "이메일 인증 코드가 맞지 않거나 만료되었습니다.";
    case "daily_free_limit_reached":
      return "무료 플랜의 오늘 AI 분석 한도를 모두 사용했습니다.";
    default:
      return "요청을 처리하지 못했습니다.";
  }
}

function getAuthBaseUrl() {
  const explicitEndpoint = runtimeEnv?.EXPO_PUBLIC_AUTH_ENDPOINT;
  if (explicitEndpoint) return explicitEndpoint;

  const location = (globalThis as unknown as { location?: { protocol?: string; hostname?: string } }).location;
  const hostname = location?.hostname;
  if (location?.protocol?.startsWith("http") && hostname) {
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${location.protocol}//${hostname}:8787`;
    }
    return "";
  }

  return AI_ENDPOINT?.replace(/\/analyze-day$/, "") ?? "";
}
