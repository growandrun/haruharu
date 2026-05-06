import type { SubscriptionTier, UserSettings } from "../types/app";
import {
  DemoAccountError,
  completePasswordReset as demoCompletePasswordReset,
  getPendingVerificationCode as demoGetPendingCode,
  loginAccount as demoLoginAccount,
  regenerateVerificationCode as demoRegenerateCode,
  signupAccount as demoSignupAccount,
  startPasswordReset as demoStartPasswordReset,
  verifyAccountEmail as demoVerifyAccountEmail
} from "./demoAccounts";

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

export class AuthError extends Error {
  code: string;
  detail?: { remaining?: number; lockedMinutes?: number };

  constructor(code: string, message: string, detail?: { remaining?: number; lockedMinutes?: number }) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export function hasAuthServer() {
  return Boolean(AUTH_BASE_URL);
}

export function isDemoMode() {
  return !AUTH_BASE_URL;
}

export async function getDemoVerificationCode(email: string): Promise<string | null> {
  if (!isDemoMode()) return null;
  const normalized = normalizeEmailLocal(email);
  if (!normalized) return null;
  return demoGetPendingCode(normalized);
}

export async function signup(name: string, email: string, password: string): Promise<UserSettings> {
  const trimmedName = sanitizeName(name);
  const trimmedEmail = normalizeEmailLocal(email);
  if (!trimmedName) {
    throw new AuthError("invalid_name", "이름을 입력해 주세요.");
  }
  if (!trimmedEmail) {
    throw new AuthError("invalid_email", "올바른 이메일 주소를 입력해 주세요.");
  }
  const passwordIssue = validatePasswordLocal(password);
  if (passwordIssue) {
    throw new AuthError("invalid_password_format", passwordIssue);
  }

  if (!AUTH_BASE_URL) {
    try {
      const account = await demoSignupAccount(trimmedName, trimmedEmail, password);
      return demoPendingSettings(account);
    } catch (error) {
      throw mapDemoError(error);
    }
  }

  await authRequest("/auth/signup", { name: trimmedName, email: trimmedEmail, password });
  return {
    tier: "free",
    isLoggedIn: true,
    userId: undefined,
    authToken: undefined,
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

export async function login(email: string, password: string): Promise<UserSettings> {
  const trimmedEmail = normalizeEmailLocal(email);
  if (!trimmedEmail) {
    throw new AuthError("invalid_email", "올바른 이메일 주소를 입력해 주세요.");
  }
  if (!password) {
    throw new AuthError("missing_password", "비밀번호를 입력해 주세요.");
  }

  if (!AUTH_BASE_URL) {
    try {
      const account = await demoLoginAccount(trimmedEmail, password);
      return demoVerifiedSettingsFromAccount(account);
    } catch (error) {
      throw mapDemoError(error);
    }
  }

  const payload = await authRequest("/auth/login", { email: trimmedEmail, password });
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

export async function verifyEmail(token: string | undefined, code: string, email?: string): Promise<UserSettings> {
  const trimmedCode = code.trim();
  if (!trimmedCode) {
    throw new AuthError("missing_code", "인증 코드를 입력해 주세요.");
  }
  const trimmedEmail = email ? normalizeEmailLocal(email) : "";

  if (!AUTH_BASE_URL || token === DEMO_TOKEN) {
    if (!trimmedEmail) {
      throw new AuthError("missing_email", "이메일이 누락되었습니다. 회원가입을 다시 진행해 주세요.");
    }
    try {
      const account = await demoVerifyAccountEmail(trimmedEmail, trimmedCode);
      return demoVerifiedSettingsFromAccount(account);
    } catch (error) {
      throw mapDemoError(error);
    }
  }

  const payload = token
    ? await authRequest("/auth/verify-email", { code: trimmedCode }, token)
    : await authRequest("/auth/verify-email", { code: trimmedCode, email: trimmedEmail });
  return settingsFromAuth(payload);
}

export async function resendVerification(token: string | undefined, email?: string) {
  const trimmedEmail = email ? normalizeEmailLocal(email) : "";

  if (!AUTH_BASE_URL || token === DEMO_TOKEN) {
    if (!trimmedEmail) {
      throw new AuthError("missing_email", "이메일이 누락되었습니다. 회원가입을 다시 진행해 주세요.");
    }
    try {
      await demoRegenerateCode(trimmedEmail, "signup");
    } catch (error) {
      throw mapDemoError(error);
    }
    return;
  }

  if (token) {
    await authRequest("/auth/resend-verification", { email: trimmedEmail }, token);
  } else {
    await authRequest("/auth/resend-verification", { email: trimmedEmail });
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  const trimmedEmail = normalizeEmailLocal(email);
  if (!trimmedEmail) {
    throw new AuthError("invalid_email", "올바른 이메일 주소를 입력해 주세요.");
  }

  if (!AUTH_BASE_URL) {
    try {
      await demoStartPasswordReset(trimmedEmail);
    } catch (error) {
      throw mapDemoError(error);
    }
    return;
  }

  await authRequest("/auth/password-reset/request", { email: trimmedEmail });
}

export async function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<UserSettings> {
  const trimmedEmail = normalizeEmailLocal(email);
  if (!trimmedEmail) {
    throw new AuthError("invalid_email", "올바른 이메일 주소를 입력해 주세요.");
  }
  const trimmedCode = code.trim();
  if (!/^\d{6}$/.test(trimmedCode)) {
    throw new AuthError("invalid_code_format", "6자리 숫자 코드를 입력해 주세요.");
  }
  const passwordIssue = validatePasswordLocal(newPassword);
  if (passwordIssue) {
    throw new AuthError("invalid_password_format", passwordIssue);
  }

  if (!AUTH_BASE_URL) {
    try {
      const account = await demoCompletePasswordReset(trimmedEmail, trimmedCode, newPassword);
      return demoVerifiedSettingsFromAccount(account);
    } catch (error) {
      throw mapDemoError(error);
    }
  }

  const payload = await authRequest("/auth/password-reset/confirm", {
    email: trimmedEmail,
    code: trimmedCode,
    newPassword
  });
  return settingsFromAuth(payload);
}

export async function requestPayment(token: string, tier: SubscriptionTier, depositorName: string): Promise<UserSettings> {
  if (!AUTH_BASE_URL || token === DEMO_TOKEN) {
    throw new AuthError("server_required", "결제 신청은 인증 서버가 연결된 환경에서만 가능합니다.");
  }
  const payload = await authRequest("/payments/request", { tier, depositorName }, token);
  return settingsFromUser(payload.user);
}

async function authRequest(path: string, body: unknown, token?: string): Promise<AuthResponse> {
  if (!AUTH_BASE_URL) {
    throw new AuthError("server_required", "인증 서버 주소가 설정되지 않았습니다.");
  }

  const response = await fetch(`${AUTH_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => ({}))) as AuthResponse;

  if (!response.ok) {
    throw new AuthError(payload.error ?? "request_failed", payload.message ?? authErrorMessage(payload.error));
  }

  return payload;
}

function settingsFromAuth(payload: AuthResponse): UserSettings {
  if (!payload.token || !payload.user) {
    throw new AuthError("invalid_response", "인증 응답이 올바르지 않습니다.");
  }

  return {
    ...settingsFromUser(payload.user),
    authToken: payload.token
  };
}

function settingsFromUser(user?: AuthUser): UserSettings {
  if (!user) {
    throw new AuthError("missing_user", "사용자 정보를 불러오지 못했습니다.");
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

function demoPendingSettings(account: { id: string; name: string; email: string }): UserSettings {
  return {
    tier: "free",
    isLoggedIn: true,
    userId: account.id,
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
    displayName: account.name,
    email: account.email
  };
}

function demoVerifiedSettingsFromAccount(account: { id: string; name: string; email: string }): UserSettings {
  return {
    tier: "free",
    isLoggedIn: true,
    userId: account.id,
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
    displayName: account.name,
    email: account.email
  };
}

function mapDemoError(error: unknown): AuthError {
  if (error instanceof DemoAccountError) {
    return new AuthError(error.code, error.message, {
      remaining: error.remaining,
      lockedMinutes: error.lockedMinutes
    });
  }
  if (error instanceof Error) {
    return new AuthError("unknown", error.message);
  }
  return new AuthError("unknown", "요청을 처리하지 못했습니다.");
}

function sanitizeName(value: string): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F\u00AD\u200B-\u200F\u2028-\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function normalizeEmailLocal(value: string): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F\u00AD\u200B-\u200F\u2028-\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : "";
}

function validatePasswordLocal(password: string): string {
  if (typeof password !== "string" || password.length < 10) return "비밀번호는 10자 이상이어야 합니다.";
  if (password.length > 200) return "비밀번호는 200자 이하여야 합니다.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return "영문 대문자와 소문자를 모두 포함해 주세요.";
  if (!/\d/.test(password)) return "숫자를 1개 이상 포함해 주세요.";
  if (!/[^A-Za-z0-9]/.test(password)) return "특수문자를 1개 이상 포함해 주세요.";
  return "";
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
    case "email_verification_expired":
      return "이메일 인증 코드가 만료되었습니다. 코드를 다시 받아주세요.";
    case "verification_attempts_exceeded":
      return "인증 시도 횟수를 초과했습니다. 코드를 다시 받아주세요.";
    case "invalid_email_verification_code":
      return "이메일 인증 코드가 맞지 않습니다.";
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
