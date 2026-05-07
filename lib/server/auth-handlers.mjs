import {
  hashPassword,
  verifyPassword,
  dummyVerify,
  generateCode,
  generateToken,
  hashToken,
  generateUserId,
  constantTimeEqual
} from "./crypto.mjs";
import {
  getAccount,
  setAccount,
  getSession,
  setSession,
  deleteSession,
  getVerification,
  setVerification,
  deleteVerification,
  consumeRateLimit
} from "./storage.mjs";
import { sendVerificationEmail, sendPasswordResetEmail, isEmailConfigured } from "./email.mjs";
import {
  bearerToken,
  cleanText,
  clientIp,
  normalizeEmail,
  publicUser,
  readBody,
  validatePassword
} from "./http.mjs";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 30 * 60 * 1000;
const RESEND_COOLDOWN_MS = 3 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

const send = (res, status, body) => res.status(status).json(body);

async function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = await getSession(tokenHash);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    await deleteSession(tokenHash);
    return null;
  }
  const account = await getAccount(session.email);
  if (!account) return null;
  return { account, token, tokenHash, session };
}

async function issueSession(account) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = Date.now();
  await setSession(tokenHash, {
    userId: account.id,
    email: account.email,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastUsedAt: now
  });
  return token;
}

async function checkCooldown(email) {
  const verification = await getVerification(email);
  if (!verification?.lastSentAt) return null;
  const allowedAt = verification.lastSentAt + RESEND_COOLDOWN_MS;
  if (Date.now() < allowedAt) return allowedAt;
  return null;
}

export async function handleSignup(req, res) {
  if (!isEmailConfigured()) {
    return send(res, 503, { error: "email_unavailable", message: "이메일 발송이 설정되지 않았습니다." });
  }

  const ip = clientIp(req);
  if (!(await consumeRateLimit(`signup:ip:${ip}`, 900, 12))) {
    return send(res, 429, { error: "too_many_attempts", message: "잠시 후 다시 시도해 주세요." });
  }

  const body = readBody(req);
  const name = cleanText(body.name, 40);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!name) return send(res, 400, { error: "invalid_name", message: "이름을 입력해 주세요." });
  if (!email) return send(res, 400, { error: "invalid_email", message: "올바른 이메일 주소를 입력해 주세요." });
  const pwIssue = validatePassword(password);
  if (pwIssue) return send(res, 400, { error: "invalid_password_format", message: pwIssue });

  if (!(await consumeRateLimit(`signup:email:${email}`, 3600, 5))) {
    return send(res, 429, { error: "too_many_attempts", message: "잠시 후 다시 시도해 주세요." });
  }

  const existing = await getAccount(email);
  if (existing) {
    return send(res, 409, {
      error: "email_already_exists",
      message: "이미 가입된 이메일입니다. 로그인하시거나 비밀번호를 재설정해 주세요."
    });
  }

  const { hash, salt } = hashPassword(password);
  const account = {
    id: generateUserId(),
    email,
    name,
    passwordHash: hash,
    passwordSalt: salt,
    emailVerified: false,
    tier: "free",
    paymentStatus: "none",
    depositorName: "",
    createdAt: new Date().toISOString(),
    loginFailureCount: 0,
    loginLockedUntil: null
  };
  await setAccount(email, account);

  const code = generateCode();
  const now = Date.now();
  await setVerification(email, {
    codeHash: hashToken(code),
    expiresAt: now + VERIFICATION_TTL_MS,
    attempts: 0,
    purpose: "signup",
    lastSentAt: now,
    sentCount: 1
  });

  try {
    await sendVerificationEmail({ to: email, name, code });
  } catch (error) {
    console.error("[signup] email send failed:", error?.message ?? error);
    return send(res, 502, {
      error: "email_send_failed",
      message: "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요."
    });
  }

  return send(res, 202, {
    ok: true,
    email,
    name,
    nextAllowedAt: now + RESEND_COOLDOWN_MS,
    message: "확인 메일을 보냈습니다. 이메일을 확인해 주세요."
  });
}

export async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (!(await consumeRateLimit(`login:ip:${ip}`, 900, 20))) {
    return send(res, 429, { error: "too_many_attempts", message: "잠시 후 다시 시도해 주세요." });
  }

  const body = readBody(req);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) return send(res, 400, { error: "invalid_email", message: "올바른 이메일 주소를 입력해 주세요." });
  if (!password) return send(res, 400, { error: "missing_password", message: "비밀번호를 입력해 주세요." });

  const account = await getAccount(email);
  if (!account) {
    dummyVerify(password);
    return send(res, 404, {
      error: "email_not_found",
      message: "등록되지 않은 이메일입니다. 회원가입이 먼저 필요합니다."
    });
  }

  if (account.loginLockedUntil && Date.now() < account.loginLockedUntil) {
    const minutes = Math.max(1, Math.ceil((account.loginLockedUntil - Date.now()) / 60_000));
    return send(res, 429, {
      error: "account_locked",
      message: `보안을 위해 로그인이 ${minutes}분 동안 잠겼습니다.`,
      lockedMinutes: minutes
    });
  }

  if (!verifyPassword(password, account.passwordSalt, account.passwordHash)) {
    account.loginFailureCount = (account.loginFailureCount ?? 0) + 1;
    if (account.loginFailureCount >= MAX_LOGIN_FAILURES) {
      account.loginLockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
      account.loginFailureCount = 0;
      await setAccount(email, account);
      return send(res, 429, {
        error: "account_locked",
        message: `비밀번호 오류로 ${LOGIN_LOCKOUT_MS / 60_000}분 동안 로그인이 잠겼습니다.`,
        lockedMinutes: LOGIN_LOCKOUT_MS / 60_000
      });
    }
    await setAccount(email, account);
    const remaining = MAX_LOGIN_FAILURES - account.loginFailureCount;
    return send(res, 401, {
      error: "invalid_password",
      message: `비밀번호가 일치하지 않습니다. (남은 시도 ${remaining}회)`,
      remaining
    });
  }

  if (!account.emailVerified) {
    return send(res, 403, {
      error: "email_not_verified",
      message: "이메일 인증이 완료되지 않았습니다. 인증 메일의 코드를 입력해 주세요.",
      email: account.email
    });
  }

  account.loginFailureCount = 0;
  account.loginLockedUntil = null;
  await setAccount(email, account);

  const token = await issueSession(account);
  return send(res, 200, { token, user: publicUser(account) });
}

export async function handleVerifyEmail(req, res) {
  const ip = clientIp(req);
  if (!(await consumeRateLimit(`verify:ip:${ip}`, 900, 30))) {
    return send(res, 429, { error: "too_many_attempts", message: "잠시 후 다시 시도해 주세요." });
  }

  const body = readBody(req);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  let email = normalizeEmail(body.email);

  if (!email) {
    const auth = await authenticate(req);
    if (auth) email = auth.account.email;
  }

  if (!email) return send(res, 400, { error: "missing_email", message: "이메일이 필요합니다." });

  const account = await getAccount(email);
  if (!account) {
    return send(res, 400, { error: "invalid_code", message: "인증 코드가 맞지 않습니다." });
  }

  const verification = await getVerification(email);
  if (!verification) {
    return send(res, 400, {
      error: "verification_not_issued",
      message: "인증 코드가 발급되지 않았거나 만료되었습니다. 코드를 다시 받아주세요."
    });
  }

  if (Date.now() > verification.expiresAt) {
    await deleteVerification(email);
    return send(res, 400, { error: "verification_expired", message: "인증 코드가 만료되었습니다. 코드를 다시 받아주세요." });
  }

  if ((verification.attempts ?? 0) >= MAX_VERIFICATION_ATTEMPTS) {
    await deleteVerification(email);
    return send(res, 429, {
      error: "verification_attempts_exceeded",
      message: "인증 시도 횟수를 초과했습니다. 코드를 다시 받아주세요."
    });
  }

  if (verification.purpose !== "signup") {
    return send(res, 400, { error: "wrong_purpose", message: "이 코드는 다른 용도로 발급되었습니다." });
  }

  if (!/^\d{6}$/.test(code) || !constantTimeEqual(hashToken(code), verification.codeHash)) {
    verification.attempts = (verification.attempts ?? 0) + 1;
    await setVerification(email, verification);
    const remaining = MAX_VERIFICATION_ATTEMPTS - verification.attempts;
    return send(res, 400, {
      error: "invalid_code",
      message: remaining > 0
        ? `인증 코드가 맞지 않습니다. (남은 시도 ${remaining}회)`
        : "인증 시도 횟수를 초과했습니다. 코드를 다시 받아주세요.",
      remaining
    });
  }

  account.emailVerified = true;
  account.emailVerifiedAt = new Date().toISOString();
  account.loginFailureCount = 0;
  account.loginLockedUntil = null;
  await setAccount(email, account);
  await deleteVerification(email);

  const token = await issueSession(account);
  return send(res, 200, { token, user: publicUser(account) });
}

export async function handleResend(req, res) {
  if (!isEmailConfigured()) {
    return send(res, 503, { error: "email_unavailable", message: "이메일 발송이 설정되지 않았습니다." });
  }

  const ip = clientIp(req);
  if (!(await consumeRateLimit(`resend:ip:${ip}`, 3600, 20))) {
    return send(res, 429, { error: "too_many_attempts", message: "잠시 후 다시 시도해 주세요." });
  }

  const body = readBody(req);
  let email = normalizeEmail(body.email);
  if (!email) {
    const auth = await authenticate(req);
    if (auth) email = auth.account.email;
  }
  if (!email) return send(res, 400, { error: "missing_email", message: "이메일이 필요합니다." });

  const account = await getAccount(email);
  if (!account || account.emailVerified) {
    return send(res, 200, { ok: true, nextAllowedAt: Date.now() + RESEND_COOLDOWN_MS });
  }

  const cooldownUntil = await checkCooldown(email);
  if (cooldownUntil) {
    return send(res, 429, {
      error: "cooldown_active",
      message: "인증 메일을 이미 보냈습니다. 잠시 후 다시 시도해 주세요.",
      nextAllowedAt: cooldownUntil
    });
  }

  if (!(await consumeRateLimit(`resend:email:${email}`, 3600, 6))) {
    return send(res, 429, {
      error: "too_many_attempts_email",
      message: "이 이메일로 너무 많은 인증 메일을 보냈습니다. 한 시간 후 다시 시도해 주세요."
    });
  }

  const previous = await getVerification(email);
  const code = generateCode();
  const now = Date.now();
  await setVerification(email, {
    codeHash: hashToken(code),
    expiresAt: now + VERIFICATION_TTL_MS,
    attempts: 0,
    purpose: "signup",
    lastSentAt: now,
    sentCount: (previous?.sentCount ?? 0) + 1
  });

  try {
    await sendVerificationEmail({ to: email, name: account.name, code });
  } catch (error) {
    console.error("[resend] email send failed:", error?.message ?? error);
    return send(res, 502, {
      error: "email_send_failed",
      message: "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요."
    });
  }

  return send(res, 200, { ok: true, nextAllowedAt: now + RESEND_COOLDOWN_MS });
}

export async function handleForgotRequest(req, res) {
  if (!isEmailConfigured()) {
    return send(res, 503, { error: "email_unavailable", message: "이메일 발송이 설정되지 않았습니다." });
  }

  const ip = clientIp(req);
  if (!(await consumeRateLimit(`forgot:ip:${ip}`, 3600, 20))) {
    return send(res, 429, { error: "too_many_attempts", message: "잠시 후 다시 시도해 주세요." });
  }

  const body = readBody(req);
  const email = normalizeEmail(body.email);
  if (!email) return send(res, 400, { error: "invalid_email", message: "올바른 이메일 주소를 입력해 주세요." });

  if (!(await consumeRateLimit(`forgot:email:${email}`, 3600, 6))) {
    return send(res, 429, {
      error: "too_many_attempts_email",
      message: "재설정 요청 한도를 초과했습니다. 한 시간 후 다시 시도해 주세요."
    });
  }

  const account = await getAccount(email);
  if (!account) {
    return send(res, 404, {
      error: "email_not_found",
      message: "등록되지 않은 이메일입니다."
    });
  }

  const cooldownUntil = await checkCooldown(email);
  if (cooldownUntil) {
    return send(res, 429, {
      error: "cooldown_active",
      message: "재설정 메일을 이미 보냈습니다. 잠시 후 다시 시도해 주세요.",
      nextAllowedAt: cooldownUntil
    });
  }

  const code = generateCode();
  const now = Date.now();
  await setVerification(email, {
    codeHash: hashToken(code),
    expiresAt: now + VERIFICATION_TTL_MS,
    attempts: 0,
    purpose: "password_reset",
    lastSentAt: now,
    sentCount: 1
  });

  try {
    await sendPasswordResetEmail({ to: email, name: account.name, code });
  } catch (error) {
    console.error("[forgot-request] email send failed:", error?.message ?? error);
    return send(res, 502, {
      error: "email_send_failed",
      message: "재설정 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요."
    });
  }

  return send(res, 202, { ok: true, nextAllowedAt: now + RESEND_COOLDOWN_MS });
}

export async function handleForgotConfirm(req, res) {
  const ip = clientIp(req);
  if (!(await consumeRateLimit(`forgot-confirm:ip:${ip}`, 900, 30))) {
    return send(res, 429, { error: "too_many_attempts", message: "잠시 후 다시 시도해 주세요." });
  }

  const body = readBody(req);
  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!email) return send(res, 400, { error: "invalid_email", message: "올바른 이메일 주소를 입력해 주세요." });
  if (!/^\d{6}$/.test(code)) return send(res, 400, { error: "invalid_code_format", message: "6자리 숫자 코드를 입력해 주세요." });
  const pwIssue = validatePassword(newPassword);
  if (pwIssue) return send(res, 400, { error: "invalid_password_format", message: pwIssue });

  const account = await getAccount(email);
  if (!account) return send(res, 400, { error: "invalid_code", message: "인증 코드가 맞지 않습니다." });

  const verification = await getVerification(email);
  if (!verification) {
    return send(res, 400, { error: "verification_not_issued", message: "재설정 코드가 발급되지 않았거나 만료되었습니다." });
  }
  if (Date.now() > verification.expiresAt) {
    await deleteVerification(email);
    return send(res, 400, { error: "verification_expired", message: "코드가 만료되었습니다. 코드를 다시 받아주세요." });
  }
  if ((verification.attempts ?? 0) >= MAX_VERIFICATION_ATTEMPTS) {
    await deleteVerification(email);
    return send(res, 429, { error: "verification_attempts_exceeded", message: "인증 시도 횟수를 초과했습니다." });
  }
  if (verification.purpose !== "password_reset") {
    return send(res, 400, { error: "wrong_purpose", message: "이 코드는 비밀번호 재설정용이 아닙니다." });
  }

  if (!constantTimeEqual(hashToken(code), verification.codeHash)) {
    verification.attempts = (verification.attempts ?? 0) + 1;
    await setVerification(email, verification);
    const remaining = MAX_VERIFICATION_ATTEMPTS - verification.attempts;
    return send(res, 400, {
      error: "invalid_code",
      message: remaining > 0
        ? `인증 코드가 맞지 않습니다. (남은 시도 ${remaining}회)`
        : "인증 시도 횟수를 초과했습니다. 코드를 다시 받아주세요.",
      remaining
    });
  }

  const { hash, salt } = hashPassword(newPassword);
  account.passwordHash = hash;
  account.passwordSalt = salt;
  account.emailVerified = true;
  account.loginFailureCount = 0;
  account.loginLockedUntil = null;
  await setAccount(email, account);
  await deleteVerification(email);

  const token = await issueSession(account);
  return send(res, 200, { token, user: publicUser(account) });
}

export async function handleLogout(req, res) {
  const auth = await authenticate(req);
  if (auth) {
    await deleteSession(auth.tokenHash);
  }
  return send(res, 200, { ok: true });
}

export async function handleMe(req, res) {
  const auth = await authenticate(req);
  if (!auth) return send(res, 401, { error: "auth_required" });
  return send(res, 200, { user: publicUser(auth.account) });
}
