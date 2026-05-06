import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "haru-jeongri:demo-accounts";
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_BITS = 256;
const VERIFICATION_TTL_MS = 30 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export type DemoAccount = {
  id: string;
  email: string;
  name: string;
  passwordHashHex: string;
  passwordSaltHex: string;
  emailVerified: boolean;
  pendingVerification?: PendingVerification;
  createdAt: string;
  loginFailureCount: number;
  loginLockedUntil?: number;
};

type PendingVerification = {
  code: string;
  expiresAt: number;
  attempts: number;
  purpose: "signup" | "password_reset";
};

type Store = {
  accounts: Record<string, DemoAccount>;
};

export class DemoAccountError extends Error {
  code: string;
  remaining?: number;
  lockedMinutes?: number;

  constructor(code: string, message: string, extra?: { remaining?: number; lockedMinutes?: number }) {
    super(message);
    this.code = code;
    this.remaining = extra?.remaining;
    this.lockedMinutes = extra?.lockedMinutes;
  }
}

async function loadStore(): Promise<Store> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return { accounts: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { accounts: parsed.accounts ?? {} };
  } catch {
    return { accounts: {} };
  }
}

async function saveStore(store: Store) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getCrypto(): Crypto | null {
  const ref = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!ref || typeof ref.subtle === "undefined" || typeof ref.getRandomValues !== "function") {
    return null;
  }
  return ref;
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hashPassword(password: string, saltHex?: string): Promise<{ hashHex: string; saltHex: string }> {
  const cryptoRef = getCrypto();
  if (!cryptoRef) {
    throw new DemoAccountError(
      "crypto_unavailable",
      "이 브라우저는 안전한 비밀번호 저장을 지원하지 않습니다. 최신 브라우저로 다시 시도해 주세요."
    );
  }

  const saltSource = saltHex ? hexToBytes(saltHex) : cryptoRef.getRandomValues(new Uint8Array(16));
  const salt = new Uint8Array(saltSource);
  const passwordBuffer = new TextEncoder().encode(password);
  const subtle = cryptoRef.subtle as unknown as {
    importKey: (...args: unknown[]) => Promise<unknown>;
    deriveBits: (...args: unknown[]) => Promise<ArrayBuffer>;
  };
  const baseKey = await subtle.importKey("raw", passwordBuffer, { name: "PBKDF2" }, false, ["deriveBits"]);
  const derivedBits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    baseKey,
    PBKDF2_KEY_BITS
  );
  return {
    hashHex: bytesToHex(derivedBits),
    saltHex: bytesToHex(salt)
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function generateCode(): string {
  const cryptoRef = getCrypto();
  if (!cryptoRef) return `${Math.floor(Math.random() * 1_000_000)}`.padStart(6, "0");
  const buffer = new Uint32Array(1);
  cryptoRef.getRandomValues(buffer);
  return `${buffer[0] % 1_000_000}`.padStart(6, "0");
}

function generateAccountId(): string {
  const cryptoRef = getCrypto();
  if (!cryptoRef) return `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bytes = new Uint8Array(16);
  cryptoRef.getRandomValues(bytes);
  return `demo-${bytesToHex(bytes)}`;
}

export async function signupAccount(name: string, email: string, password: string): Promise<DemoAccount> {
  const store = await loadStore();
  if (store.accounts[email]) {
    throw new DemoAccountError("email_exists", "이미 가입된 이메일입니다. 로그인하시거나 비밀번호를 재설정해 주세요.");
  }
  const { hashHex, saltHex } = await hashPassword(password);
  const account: DemoAccount = {
    id: generateAccountId(),
    email,
    name,
    passwordHashHex: hashHex,
    passwordSaltHex: saltHex,
    emailVerified: false,
    pendingVerification: {
      code: generateCode(),
      expiresAt: Date.now() + VERIFICATION_TTL_MS,
      attempts: 0,
      purpose: "signup"
    },
    createdAt: new Date().toISOString(),
    loginFailureCount: 0,
    loginLockedUntil: undefined
  };
  store.accounts[email] = account;
  await saveStore(store);
  return account;
}

export async function verifyAccountEmail(email: string, code: string): Promise<DemoAccount> {
  const store = await loadStore();
  const account = store.accounts[email];
  if (!account) {
    throw new DemoAccountError("email_not_found", "등록되지 않은 이메일입니다.");
  }
  if (account.emailVerified && (!account.pendingVerification || account.pendingVerification.purpose !== "password_reset")) {
    return account;
  }
  if (!account.pendingVerification) {
    throw new DemoAccountError("verification_not_issued", "인증 코드가 발급되지 않았습니다. 코드를 다시 받아주세요.");
  }
  if (account.pendingVerification.purpose !== "signup") {
    throw new DemoAccountError("wrong_purpose", "이 코드는 비밀번호 재설정용입니다.");
  }

  const pending = account.pendingVerification;
  if (Date.now() > pending.expiresAt) {
    delete account.pendingVerification;
    await saveStore(store);
    throw new DemoAccountError("verification_expired", "인증 코드가 만료되었습니다. 코드를 다시 받아주세요.");
  }
  if (pending.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    delete account.pendingVerification;
    await saveStore(store);
    throw new DemoAccountError("verification_attempts_exceeded", "인증 시도 횟수를 초과했습니다. 코드를 다시 받아주세요.");
  }
  if (!/^\d{6}$/.test(code)) {
    pending.attempts += 1;
    await saveStore(store);
    throw new DemoAccountError("invalid_code_format", "6자리 숫자 코드를 입력해 주세요.", {
      remaining: MAX_VERIFICATION_ATTEMPTS - pending.attempts
    });
  }
  if (!constantTimeEqual(code, pending.code)) {
    pending.attempts += 1;
    await saveStore(store);
    const remaining = MAX_VERIFICATION_ATTEMPTS - pending.attempts;
    throw new DemoAccountError("invalid_code", `인증 코드가 맞지 않습니다. (남은 시도 ${remaining}회)`, { remaining });
  }

  account.emailVerified = true;
  delete account.pendingVerification;
  account.loginFailureCount = 0;
  account.loginLockedUntil = undefined;
  await saveStore(store);
  return account;
}

export async function loginAccount(email: string, password: string): Promise<DemoAccount> {
  const store = await loadStore();
  const account = store.accounts[email];

  if (!account) {
    throw new DemoAccountError("email_not_found", "등록되지 않은 이메일입니다. 회원가입이 먼저 필요합니다.");
  }

  if (account.loginLockedUntil && Date.now() < account.loginLockedUntil) {
    const remainingMs = account.loginLockedUntil - Date.now();
    const remainingMin = Math.max(1, Math.ceil(remainingMs / 60_000));
    throw new DemoAccountError("account_locked", `보안을 위해 로그인이 ${remainingMin}분 동안 잠겼습니다.`, {
      lockedMinutes: remainingMin
    });
  }

  const { hashHex } = await hashPassword(password, account.passwordSaltHex);
  if (!constantTimeEqual(hashHex, account.passwordHashHex)) {
    account.loginFailureCount = (account.loginFailureCount ?? 0) + 1;
    if (account.loginFailureCount >= MAX_LOGIN_FAILURES) {
      account.loginLockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
      account.loginFailureCount = 0;
      await saveStore(store);
      throw new DemoAccountError(
        "account_locked",
        `비밀번호 ${MAX_LOGIN_FAILURES}회 오류로 ${LOGIN_LOCKOUT_MS / 60_000}분 동안 로그인이 잠겼습니다.`,
        { lockedMinutes: LOGIN_LOCKOUT_MS / 60_000 }
      );
    }
    await saveStore(store);
    const remaining = MAX_LOGIN_FAILURES - account.loginFailureCount;
    throw new DemoAccountError("invalid_password", `비밀번호가 일치하지 않습니다. (남은 시도 ${remaining}회)`, { remaining });
  }

  if (!account.emailVerified) {
    throw new DemoAccountError("email_not_verified", "이메일 인증이 완료되지 않았습니다. 인증을 먼저 완료해 주세요.");
  }

  account.loginFailureCount = 0;
  account.loginLockedUntil = undefined;
  await saveStore(store);
  return account;
}

export async function regenerateVerificationCode(email: string, purpose: "signup" | "password_reset" = "signup"): Promise<string> {
  const store = await loadStore();
  const account = store.accounts[email];
  if (!account) {
    throw new DemoAccountError("email_not_found", "등록되지 않은 이메일입니다.");
  }
  if (purpose === "signup" && account.emailVerified) {
    throw new DemoAccountError("already_verified", "이미 인증이 완료된 계정입니다.");
  }
  const code = generateCode();
  account.pendingVerification = {
    code,
    expiresAt: Date.now() + VERIFICATION_TTL_MS,
    attempts: 0,
    purpose
  };
  await saveStore(store);
  return code;
}

export async function getPendingVerificationCode(email: string): Promise<string | null> {
  if (!email) return null;
  const store = await loadStore();
  const account = store.accounts[email];
  if (!account) return null;
  if (!account.pendingVerification) return null;
  if (Date.now() > account.pendingVerification.expiresAt) return null;
  return account.pendingVerification.code;
}

export async function getAccountByEmail(email: string): Promise<DemoAccount | null> {
  if (!email) return null;
  const store = await loadStore();
  return store.accounts[email] ?? null;
}

export async function startPasswordReset(email: string): Promise<string> {
  const store = await loadStore();
  const account = store.accounts[email];
  if (!account) {
    throw new DemoAccountError("email_not_found", "등록되지 않은 이메일입니다.");
  }
  const code = generateCode();
  account.pendingVerification = {
    code,
    expiresAt: Date.now() + VERIFICATION_TTL_MS,
    attempts: 0,
    purpose: "password_reset"
  };
  await saveStore(store);
  return code;
}

export async function completePasswordReset(email: string, code: string, newPassword: string): Promise<DemoAccount> {
  const store = await loadStore();
  const account = store.accounts[email];
  if (!account) {
    throw new DemoAccountError("email_not_found", "등록되지 않은 이메일입니다.");
  }
  if (!account.pendingVerification || account.pendingVerification.purpose !== "password_reset") {
    throw new DemoAccountError("verification_not_issued", "비밀번호 재설정 코드가 발급되지 않았습니다.");
  }

  const pending = account.pendingVerification;
  if (Date.now() > pending.expiresAt) {
    delete account.pendingVerification;
    await saveStore(store);
    throw new DemoAccountError("verification_expired", "인증 코드가 만료되었습니다. 코드를 다시 받아주세요.");
  }
  if (pending.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    delete account.pendingVerification;
    await saveStore(store);
    throw new DemoAccountError("verification_attempts_exceeded", "인증 시도 횟수를 초과했습니다. 코드를 다시 받아주세요.");
  }
  if (!/^\d{6}$/.test(code)) {
    pending.attempts += 1;
    await saveStore(store);
    throw new DemoAccountError("invalid_code_format", "6자리 숫자 코드를 입력해 주세요.", {
      remaining: MAX_VERIFICATION_ATTEMPTS - pending.attempts
    });
  }
  if (!constantTimeEqual(code, pending.code)) {
    pending.attempts += 1;
    await saveStore(store);
    const remaining = MAX_VERIFICATION_ATTEMPTS - pending.attempts;
    throw new DemoAccountError("invalid_code", `인증 코드가 맞지 않습니다. (남은 시도 ${remaining}회)`, { remaining });
  }

  const { hashHex, saltHex } = await hashPassword(newPassword);
  account.passwordHashHex = hashHex;
  account.passwordSaltHex = saltHex;
  account.emailVerified = true;
  account.loginFailureCount = 0;
  account.loginLockedUntil = undefined;
  delete account.pendingVerification;
  await saveStore(store);
  return account;
}
