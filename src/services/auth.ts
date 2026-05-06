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
const DEMO_CODE_TTL_MS = 30 * 60 * 1000;
const DEMO_MAX_ATTEMPTS = 5;

type DemoSession = {
  name: string;
  email: string;
  userId: string;
  code: string;
  expiresAt: number;
  attempts: number;
  consumed: boolean;
};

let demoSession: DemoSession | null = null;

export function hasAuthServer() {
  return Boolean(AUTH_BASE_URL);
}

export function isDemoMode() {
  return !AUTH_BASE_URL;
}

export function getDemoVerificationCode(): string | null {
  if (!isDemoMode()) return null;
  if (!demoSession) return null;
  if (Date.now() > demoSession.expiresAt) return null;
  if (demoSession.consumed) return null;
  return demoSession.code;
}

export async function signup(name: string, email: string, password: string): Promise<UserSettings> {
  if (!AUTH_BASE_URL) {
    return demoSignup(name, email, password);
  }
  await authRequest("/auth/signup", { name, email, password });
  const trimmedName = sanitizeName(name);
  const trimmedEmail = normalizeEmailLocal(email);
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
  if (!AUTH_BASE_URL) {
    if (demoSession && demoSession.consumed && demoSession.email === normalizeEmailLocal(email)) {
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

export async function verifyEmail(token: string | undefined, code: string, email?: string): Promise<UserSettings> {
  if (!AUTH_BASE_URL || token === DEMO_TOKEN) {
    return demoVerifyEmail(code);
  }
  const payload = token
    ? await authRequest("/auth/verify-email", { code }, token)
    : await authRequest("/auth/verify-email", { code, email });
  return settingsFromAuth(payload);
}

export async function resendVerification(token: string | undefined, email?: string) {
  if (!AUTH_BASE_URL || token === DEMO_TOKEN) {
    if (!demoSession) {
      throw new Error("재발송할 인증 정보가 없습니다. 회원가입을 다시 진행해 주세요.");
    }
    rotateDemoCode(demoSession);
    return;
  }
  if (token) {
    await authRequest("/auth/resend-verification", { email }, token);
  } else {
    await authRequest("/auth/resend-verification", { email });
  }
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

function demoSignup(name: string, email: string, password: string): UserSettings {
  const trimmedName = sanitizeName(name);
  const trimmedEmail = normalizeEmailLocal(email);
  if (!trimmedName || !trimmedEmail) {
    throw new Error("이름과 올바른 이메일을 입력해 주세요.");
  }
  const passwordIssue = validatePasswordLocal(password);
  if (passwordIssue) {
    throw new Error(passwordIssue);
  }
  const userId = `demo-${cryptoRandomId()}`;
  demoSession = {
    name: trimmedName,
    email: trimmedEmail,
    userId,
    code: generateDemoCode(),
    expiresAt: Date.now() + DEMO_CODE_TTL_MS,
    attempts: 0,
    consumed: false
  };

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

function demoVerifyEmail(code: string): UserSettings {
  const trimmed = code.trim();

  if (!demoSession) {
    throw new Error("인증 세션이 만료되었습니다. 회원가입을 다시 진행해 주세요.");
  }

  if (demoSession.consumed) {
    return demoVerifiedSettings();
  }

  if (Date.now() > demoSession.expiresAt) {
    demoSession = null;
    throw new Error("인증 코드가 만료되었습니다. 코드를 다시 받아주세요.");
  }

  if (!/^\d{6}$/.test(trimmed)) {
    demoSession.attempts += 1;
    if (demoSession.attempts >= DEMO_MAX_ATTEMPTS) {
      demoSession = null;
      throw new Error("인증 시도 횟수를 초과했습니다. 회원가입을 다시 진행해 주세요.");
    }
    throw new Error("6자리 숫자 코드를 입력해 주세요.");
  }

  if (!constantTimeEqual(trimmed, demoSession.code)) {
    demoSession.attempts += 1;
    const remaining = DEMO_MAX_ATTEMPTS - demoSession.attempts;
    if (remaining <= 0) {
      demoSession = null;
      throw new Error("인증 시도 횟수를 초과했습니다. 회원가입을 다시 진행해 주세요.");
    }
    throw new Error(`인증 코드가 맞지 않습니다. (남은 시도 ${remaining}회)`);
  }

  demoSession.consumed = true;
  return demoVerifiedSettings();
}

function demoVerifiedSettings(): UserSettings {
  const name = demoSession?.name ?? "";
  const email = demoSession?.email ?? "";
  const userId = demoSession?.userId ?? `demo-${cryptoRandomId()}`;

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

function rotateDemoCode(session: DemoSession) {
  session.code = generateDemoCode();
  session.expiresAt = Date.now() + DEMO_CODE_TTL_MS;
  session.attempts = 0;
}

function generateDemoCode(): string {
  const cryptoRef = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (cryptoRef?.getRandomValues) {
    const buffer = new Uint32Array(1);
    cryptoRef.getRandomValues(buffer);
    return `${buffer[0] % 1_000_000}`.padStart(6, "0");
  }
  return `${Math.floor(Math.random() * 1_000_000)}`.padStart(6, "0");
}

function cryptoRandomId(): string {
  const cryptoRef = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (cryptoRef?.getRandomValues) {
    const buffer = new Uint8Array(16);
    cryptoRef.getRandomValues(buffer);
    return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
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
