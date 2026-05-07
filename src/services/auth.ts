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
  email?: string;
  name?: string;
  ok?: boolean;
  nextAllowedAt?: number;
  remaining?: number;
  lockedMinutes?: number;
  error?: string;
  message?: string;
};

import { getApiBase } from "../lib/apiBase";

const AUTH_BASE_URL = getApiBase();

export class AuthError extends Error {
  code: string;
  detail: { remaining?: number; lockedMinutes?: number; nextAllowedAt?: number; email?: string };

  constructor(
    code: string,
    message: string,
    detail?: { remaining?: number; lockedMinutes?: number; nextAllowedAt?: number; email?: string }
  ) {
    super(message);
    this.code = code;
    this.detail = detail ?? {};
  }
}

export type SignupResult = {
  settings: UserSettings;
  nextAllowedAt: number;
};

export type ResendResult = {
  nextAllowedAt: number;
};

export function hasAuthServer() {
  return Boolean(AUTH_BASE_URL);
}

export async function signup(name: string, email: string, password: string): Promise<SignupResult> {
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
    throw new AuthError("server_required", "인증 서버가 연결되지 않았습니다.");
  }

  const payload = await authRequest("/auth/signup", { name: trimmedName, email: trimmedEmail, password });
  const nextAllowedAt = payload.nextAllowedAt ?? Date.now() + 3 * 60 * 1000;

  return {
    settings: pendingVerificationSettings(trimmedName, trimmedEmail),
    nextAllowedAt
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
    throw new AuthError("server_required", "인증 서버가 연결되지 않았습니다.");
  }

  const payload = await authRequest("/auth/login", { email: trimmedEmail, password });
  return settingsFromAuth(payload);
}

export async function logout(token?: string) {
  if (!token || !AUTH_BASE_URL) return;
  await fetch(`${AUTH_BASE_URL}/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  }).catch(() => undefined);
}

export async function verifyEmail(token: string | undefined, code: string, email?: string): Promise<UserSettings> {
  const trimmedCode = code.trim();
  if (!/^\d{6}$/.test(trimmedCode)) {
    throw new AuthError("invalid_code_format", "6자리 숫자 코드를 입력해 주세요.");
  }
  const trimmedEmail = email ? normalizeEmailLocal(email) : "";
  if (!AUTH_BASE_URL) {
    throw new AuthError("server_required", "인증 서버가 연결되지 않았습니다.");
  }

  const payload = token
    ? await authRequest("/auth/verify-email", { code: trimmedCode, email: trimmedEmail }, token)
    : await authRequest("/auth/verify-email", { code: trimmedCode, email: trimmedEmail });
  return settingsFromAuth(payload);
}

export async function resendVerification(token: string | undefined, email?: string): Promise<ResendResult> {
  const trimmedEmail = email ? normalizeEmailLocal(email) : "";
  if (!trimmedEmail) {
    throw new AuthError("missing_email", "이메일이 누락되었습니다.");
  }
  if (!AUTH_BASE_URL) {
    throw new AuthError("server_required", "인증 서버가 연결되지 않았습니다.");
  }

  const payload = token
    ? await authRequest("/auth/resend", { email: trimmedEmail }, token)
    : await authRequest("/auth/resend", { email: trimmedEmail });
  return { nextAllowedAt: payload.nextAllowedAt ?? Date.now() + 3 * 60 * 1000 };
}

export async function requestPasswordReset(email: string): Promise<ResendResult> {
  const trimmedEmail = normalizeEmailLocal(email);
  if (!trimmedEmail) {
    throw new AuthError("invalid_email", "올바른 이메일 주소를 입력해 주세요.");
  }
  if (!AUTH_BASE_URL) {
    throw new AuthError("server_required", "인증 서버가 연결되지 않았습니다.");
  }

  const payload = await authRequest("/auth/forgot-request", { email: trimmedEmail });
  return { nextAllowedAt: payload.nextAllowedAt ?? Date.now() + 3 * 60 * 1000 };
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
    throw new AuthError("server_required", "인증 서버가 연결되지 않았습니다.");
  }

  const payload = await authRequest("/auth/forgot-confirm", {
    email: trimmedEmail,
    code: trimmedCode,
    newPassword
  });
  return settingsFromAuth(payload);
}

export async function requestPayment(token: string, tier: SubscriptionTier, depositorName: string): Promise<UserSettings> {
  if (!AUTH_BASE_URL) {
    throw new AuthError("server_required", "결제 신청은 인증 서버가 연결된 환경에서만 가능합니다.");
  }
  const payload = await authRequest("/payments/request", { tier, depositorName }, token);
  return settingsFromUser(payload.user);
}

async function authRequest(path: string, body: unknown, token?: string): Promise<AuthResponse> {
  if (!AUTH_BASE_URL) {
    throw new AuthError("server_required", "인증 서버 주소가 설정되지 않았습니다.");
  }

  let response: Response;
  try {
    response = await fetch(`${AUTH_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new AuthError("network_error", "네트워크 연결을 확인해 주세요.");
  }

  let payload: AuthResponse = {};
  try {
    payload = (await response.json()) as AuthResponse;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new AuthError(payload.error ?? "request_failed", payload.message ?? authErrorMessage(payload.error), {
      remaining: payload.remaining,
      lockedMinutes: payload.lockedMinutes,
      nextAllowedAt: payload.nextAllowedAt,
      email: payload.email
    });
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

function pendingVerificationSettings(name: string, email: string): UserSettings {
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
    displayName: name,
    email
  };
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
    case "too_many_attempts_email":
      return "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    case "email_not_found":
      return "등록되지 않은 이메일입니다.";
    case "invalid_password":
      return "비밀번호가 일치하지 않습니다.";
    case "account_locked":
      return "계정이 일시적으로 잠겼습니다.";
    case "email_not_verified":
      return "이메일 인증이 필요합니다.";
    case "verification_expired":
      return "인증 코드가 만료되었습니다.";
    case "verification_attempts_exceeded":
      return "인증 시도 횟수를 초과했습니다.";
    case "invalid_code":
    case "invalid_email_verification_code":
      return "인증 코드가 맞지 않습니다.";
    case "cooldown_active":
      return "잠시 후 다시 시도해 주세요.";
    case "email_send_failed":
      return "메일 발송에 실패했습니다.";
    case "email_unavailable":
      return "이메일 발송 서비스가 설정되지 않았습니다.";
    case "daily_free_limit_reached":
      return "무료 플랜의 오늘 AI 분석 한도를 모두 사용했습니다.";
    default:
      return "요청을 처리하지 못했습니다.";
  }
}

