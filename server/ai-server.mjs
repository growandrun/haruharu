import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

const fileEnv = readEnvFile(".env.ai");
const PORT = Number(process.env.AI_SERVER_PORT ?? fileEnv.AI_SERVER_PORT ?? 8787);
const MODEL = process.env.OPENAI_MODEL ?? fileEnv.OPENAI_MODEL ?? "gpt-5-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? fileEnv.OPENAI_API_KEY;
const ADMIN_APPROVAL_CODE = process.env.ADMIN_APPROVAL_CODE ?? fileEnv.ADMIN_APPROVAL_CODE ?? "";
const SMTP_HOST = process.env.SMTP_HOST ?? fileEnv.SMTP_HOST ?? "";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? fileEnv.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER ?? fileEnv.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? fileEnv.SMTP_PASS ?? "";
const SMTP_FROM = process.env.SMTP_FROM ?? fileEnv.SMTP_FROM ?? "";
const SMTP_SECURE = String(process.env.SMTP_SECURE ?? fileEnv.SMTP_SECURE ?? "false").toLowerCase() === "true";
const EMAIL_DEBUG_CODES = String(process.env.EMAIL_DEBUG_CODES ?? fileEnv.EMAIL_DEBUG_CODES ?? "true").toLowerCase() === "true";
const AUTH_DB_PATH = path.join(process.cwd(), ".local", "auth-db.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 30;
const AUTH_LIMIT_WINDOW_MS = 1000 * 60 * 15;
const AUTH_LIMIT_MAX = 12;
const rateLimits = new Map();

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    analysis: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        expenses: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              amount: { type: "number" },
              confidence: { type: "number" },
              dateKey: { type: "string" }
            },
            required: ["id", "label", "amount", "confidence", "dateKey"]
          }
        },
        todos: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              done: { type: "boolean" },
              source: { type: "string", enum: ["ai", "user"] },
              dateKey: { type: "string" }
            },
            required: ["id", "title", "done", "source", "dateKey"]
          }
        },
        moods: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              score: { type: "number" },
              detail: { type: "string" },
              dateKey: { type: "string" }
            },
            required: ["label", "score", "detail", "dateKey"]
          }
        },
        notes: {
          type: "array",
          items: { type: "string" }
        },
        tomorrowPlan: {
          type: "array",
          items: { type: "string" }
        },
        wasteSignals: {
          type: "array",
          items: { type: "string" }
        },
        createdAt: { type: "string" }
      },
      required: ["summary", "expenses", "todos", "moods", "notes", "tomorrowPlan", "wasteSignals", "createdAt"]
    }
  },
  required: ["analysis"]
};

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      model: MODEL,
      hasOpenAIKey: Boolean(OPENAI_API_KEY),
      auth: true,
      adminApprovalConfigured: Boolean(ADMIN_APPROVAL_CODE),
      emailDeliveryConfigured: emailDeliveryConfigured()
    });
    return;
  }

  const route = new URL(request.url ?? "/", "http://localhost").pathname;

  try {
    if (request.method === "POST" && route === "/auth/signup") {
      await handleSignup(request, response);
      return;
    }

    if (request.method === "POST" && route === "/auth/login") {
      await handleLogin(request, response);
      return;
    }

    if (request.method === "POST" && route === "/auth/logout") {
      await handleLogout(request, response);
      return;
    }

    if (request.method === "POST" && route === "/auth/verify-email") {
      await handleVerifyEmail(request, response);
      return;
    }

    if (request.method === "POST" && route === "/auth/resend-verification") {
      await handleResendVerification(request, response);
      return;
    }

    if (request.method === "GET" && route === "/auth/me") {
      await handleMe(request, response);
      return;
    }

    if (request.method === "POST" && route === "/payments/request") {
      await handlePaymentRequest(request, response);
      return;
    }

    if (request.method === "GET" && route === "/admin") {
      sendAdminPage(response);
      return;
    }

    if (request.method === "GET" && route === "/admin/payments/pending") {
      await handleAdminPendingPayments(request, response);
      return;
    }

    if (request.method === "POST" && route === "/admin/payments/approve") {
      await handleAdminPaymentDecision(request, response, "approved");
      return;
    }

    if (request.method === "POST" && route === "/admin/payments/reject") {
      await handleAdminPaymentDecision(request, response, "rejected");
      return;
    }
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "server_error" });
    return;
  }

  if (request.method !== "POST" || route !== "/analyze-day") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  const auth = authenticateRequest(request, true);
  if (!auth) {
    sendJson(response, 401, { error: "auth_required" });
    return;
  }

  if (!auth.user.emailVerified) {
    sendJson(response, 403, { error: "email_verification_required" });
    return;
  }

  if (!OPENAI_API_KEY) {
    sendJson(response, 500, {
      error: "missing_openai_api_key",
      message: "Set OPENAI_API_KEY in the environment or .env.ai."
    });
    return;
  }

  try {
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const recentRecords = Array.isArray(body.recentRecords) ? body.recentRecords.slice(0, 14) : [];
    const todayDateKey = typeof body.todayDateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.todayDateKey)
      ? body.todayDateKey
      : localDateKey();

    if (!text) {
      sendJson(response, 400, { error: "text_required" });
      return;
    }

    if (!canUseAnalysis(auth.user)) {
      sendJson(response, 429, { error: "daily_free_limit_reached" });
      return;
    }

    const analysis = await analyzeWithOpenAI(text, recentRecords, todayDateKey);
    markAnalysisUsed(auth.user);
    writeAuthDb(auth.db);
    sendJson(response, 200, analysis);
  } catch (error) {
    console.error(error);
    sendJson(response, 502, {
      error: "ai_request_failed",
      message: error instanceof Error ? error.message : "Unknown AI server error"
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AI server ready: http://localhost:${PORT}/analyze-day`);
});

async function handleSignup(request, response) {
  if (!consumeRateLimit(request, "signup")) {
    sendJson(response, 429, { error: "too_many_attempts" });
    return;
  }

  const body = await readJson(request, 20_000);
  const name = cleanText(body.name, 40);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const passwordIssue = validatePassword(password);

  if (!name || !email || passwordIssue) {
    sendJson(response, 400, {
      error: "invalid_signup",
      message: passwordIssue ?? "이름과 올바른 이메일을 입력해 주세요."
    });
    return;
  }

  const db = readAuthDb();
  if (db.users.some((user) => user.email === email)) {
    sendJson(response, 409, { error: "email_already_exists" });
    return;
  }

  const user = {
    id: `user_${crypto.randomUUID()}`,
    name,
    email,
    passwordHash: hashPassword(password),
    emailVerified: false,
    tier: "free",
    paymentStatus: "none",
    pendingTier: undefined,
    depositorName: "",
    paymentRequestedAt: undefined,
    paymentApprovedAt: undefined,
    createdAt: new Date().toISOString()
  };
  setEmailVerification(user);
  db.users.push(user);
  const session = createSession(db, user.id);
  writeAuthDb(db);
  await deliverVerificationCode(user);
  sendJson(response, 201, sessionPayload(user, session.token));
}

async function handleLogin(request, response) {
  if (!consumeRateLimit(request, "login")) {
    sendJson(response, 429, { error: "too_many_attempts" });
    return;
  }

  const body = await readJson(request, 20_000);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const db = readAuthDb();
  const user = db.users.find((item) => item.email === email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    sendJson(response, 401, { error: "invalid_credentials" });
    return;
  }

  const session = createSession(db, user.id);
  writeAuthDb(db);
  sendJson(response, 200, sessionPayload(user, session.token));
}

async function handleLogout(request, response) {
  const token = bearerToken(request);
  if (token) {
    const db = readAuthDb();
    const tokenHash = hashToken(token);
    db.sessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
    writeAuthDb(db);
  }
  sendJson(response, 200, { ok: true });
}

async function handleMe(request, response) {
  const user = authenticateRequest(request);
  if (!user) {
    sendJson(response, 401, { error: "auth_required" });
    return;
  }
  sendJson(response, 200, { user: publicUser(user) });
}

async function handleVerifyEmail(request, response) {
  if (!consumeRateLimit(request, "verify-email")) {
    sendJson(response, 429, { error: "too_many_attempts" });
    return;
  }

  const auth = authenticateRequest(request, true);
  if (!auth) {
    sendJson(response, 401, { error: "auth_required" });
    return;
  }

  const body = await readJson(request, 20_000);
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!verifyEmailCode(auth.user, code)) {
    sendJson(response, 400, { error: "invalid_email_verification_code" });
    return;
  }

  auth.user.emailVerified = true;
  auth.user.emailVerificationHash = undefined;
  auth.user.emailVerificationExpiresAt = undefined;
  auth.user.emailVerifiedAt = new Date().toISOString();
  writeAuthDb(auth.db);
  sendJson(response, 200, { user: publicUser(auth.user) });
}

async function handleResendVerification(request, response) {
  if (!consumeRateLimit(request, "resend-verification")) {
    sendJson(response, 429, { error: "too_many_attempts" });
    return;
  }

  const auth = authenticateRequest(request, true);
  if (!auth) {
    sendJson(response, 401, { error: "auth_required" });
    return;
  }

  if (auth.user.emailVerified) {
    sendJson(response, 200, { user: publicUser(auth.user) });
    return;
  }

  setEmailVerification(auth.user);
  writeAuthDb(auth.db);
  await deliverVerificationCode(auth.user);
  sendJson(response, 200, { ok: true });
}

async function handlePaymentRequest(request, response) {
  const auth = authenticateRequest(request, true);
  if (!auth) {
    sendJson(response, 401, { error: "auth_required" });
    return;
  }

  if (!auth.user.emailVerified) {
    sendJson(response, 403, { error: "email_verification_required" });
    return;
  }

  const body = await readJson(request, 20_000);
  const tier = body.tier === "plus" || body.tier === "premium" ? body.tier : "";
  const depositorName = cleanText(body.depositorName, 40);

  if (!tier || !depositorName) {
    sendJson(response, 400, { error: "invalid_payment_request" });
    return;
  }

  auth.user.paymentStatus = "pending";
  auth.user.pendingTier = tier;
  auth.user.depositorName = depositorName;
  auth.user.paymentRequestedAt = new Date().toISOString();
  auth.user.paymentApprovedAt = undefined;
  writeAuthDb(auth.db);
  sendJson(response, 200, { user: publicUser(auth.user) });
}

async function handleAdminPendingPayments(request, response) {
  if (!ADMIN_APPROVAL_CODE) {
    sendJson(response, 503, { error: "admin_approval_not_configured" });
    return;
  }

  if (!isAdminRequest(request)) {
    sendJson(response, 403, { error: "invalid_admin_approval" });
    return;
  }

  const db = readAuthDb();
  const users = db.users
    .filter((user) => user.paymentStatus === "pending" && user.pendingTier)
    .map(publicUser);
  sendJson(response, 200, { users });
}

async function handleAdminPaymentDecision(request, response, status) {
  if (!ADMIN_APPROVAL_CODE) {
    sendJson(response, 503, { error: "admin_approval_not_configured" });
    return;
  }

  const body = await readJson(request, 20_000);
  const code = typeof body.adminCode === "string" ? body.adminCode.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";

  if (!secureCompare(code, ADMIN_APPROVAL_CODE)) {
    sendJson(response, 403, { error: "invalid_admin_approval" });
    return;
  }

  const db = readAuthDb();
  const user = db.users.find((item) => item.id === userId);

  if (!user || !user.pendingTier || user.paymentStatus !== "pending") {
    sendJson(response, 404, { error: "pending_payment_not_found" });
    return;
  }

  if (status === "approved") {
    user.tier = user.pendingTier;
    user.paymentStatus = "approved";
    user.pendingTier = undefined;
    user.paymentApprovedAt = new Date().toISOString();
  } else {
    user.paymentStatus = "rejected";
    user.pendingTier = undefined;
    user.paymentApprovedAt = undefined;
  }

  writeAuthDb(db);
  sendJson(response, 200, { user: publicUser(user) });
}

async function analyzeWithOpenAI(text, recentRecords, todayDateKey) {
  const prompt = [
    "사용자의 하루 기록을 한국어 생활 관리 앱에 맞게 정리하세요.",
    "입력에서 명시된 사실만 분류하고, 모호한 금액이나 할 일은 과하게 추측하지 마세요.",
    `오늘 기준 날짜는 ${todayDateKey}입니다.`,
    "expenses, todos, moods의 dateKey는 반드시 YYYY-MM-DD로 작성하세요.",
    "사용자가 '5월 4일', '어제', '내일', '2026-05-04'처럼 날짜를 명시하면 해당 항목의 dateKey는 그 날짜로 두세요.",
    "날짜가 명시되지 않은 항목만 오늘 기준 날짜를 dateKey로 두세요.",
    "summary는 1~2문장으로 자연스럽고 짧게 작성하세요.",
    "expenses.amount는 숫자 원 단위로 작성하세요.",
    "todos는 실행 가능한 문장으로 쓰고 done은 항상 false, source는 항상 ai로 두세요.",
    "moods.score는 0~100 사이의 정서/컨디션 점수처럼 사용하세요.",
    "tomorrowPlan은 실제로 내일 할 수 있는 짧은 행동으로 작성하세요.",
    "",
    `오늘 기록:\n${text}`,
    "",
    `최근 기록 참고:\n${JSON.stringify(recentRecords, null, 2)}`
  ].join("\n");

  const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      input: prompt,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "haru_day_analysis",
          strict: true,
          schema: responseSchema
        }
      }
    })
  });

  const payload = await openAIResponse.json();

  if (!openAIResponse.ok) {
    throw new Error(payload?.error?.message ?? `OpenAI request failed with ${openAIResponse.status}`);
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error("OpenAI response did not include output text.");
  }

  return JSON.parse(outputText);
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readJson(request, limit = 80_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function readAuthDb() {
  ensureLocalDir();
  if (!fs.existsSync(AUTH_DB_PATH)) {
    return { users: [], sessions: [] };
  }

  const db = JSON.parse(fs.readFileSync(AUTH_DB_PATH, "utf8").replace(/^\uFEFF/, ""));
  return {
    users: Array.isArray(db.users) ? db.users : [],
    sessions: Array.isArray(db.sessions) ? db.sessions.filter((session) => new Date(session.expiresAt).getTime() > Date.now()) : []
  };
}

function writeAuthDb(db) {
  ensureLocalDir();
  const safeDb = {
    users: db.users.map((user) => {
      const { __lastVerificationCode, ...safeUser } = user;
      return safeUser;
    }),
    sessions: db.sessions.filter((session) => new Date(session.expiresAt).getTime() > Date.now())
  };
  fs.writeFileSync(AUTH_DB_PATH, `${JSON.stringify(safeDb, null, 2)}\n`);
}

function ensureLocalDir() {
  fs.mkdirSync(path.dirname(AUTH_DB_PATH), { recursive: true });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${key}`;
}

function verifyPassword(password, storedHash) {
  const [method, salt, key] = String(storedHash).split(":");
  if (method !== "scrypt" || !salt || !key) return false;

  const expected = Buffer.from(key, "base64url");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  db.sessions.push({
    userId,
    tokenHash: hashToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  });
  return { token };
}

function authenticateRequest(request, includeDb = false) {
  const token = bearerToken(request);
  if (!token) return undefined;

  const db = readAuthDb();
  const tokenHash = hashToken(token);
  const session = db.sessions.find((item) => item.tokenHash === tokenHash && new Date(item.expiresAt).getTime() > Date.now());
  if (!session) return undefined;

  const user = db.users.find((item) => item.id === session.userId);
  if (!user) return undefined;

  return includeDb ? { db, user, session } : user;
}

function bearerToken(request) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function setEmailVerification(user) {
  const code = `${crypto.randomInt(0, 1_000_000)}`.padStart(6, "0");
  user.emailVerificationHash = hashToken(code);
  user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
  user.__lastVerificationCode = code;
}

async function deliverVerificationCode(user) {
  if (!user.__lastVerificationCode) return;
  const code = user.__lastVerificationCode;
  delete user.__lastVerificationCode;

  if (!emailDeliveryConfigured()) {
    console.log(`[email-verification] ${user.email}: ${code}`);
    console.log("[email-verification] SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM in .env.ai.");
    return;
  }

  try {
    await sendEmail({
      to: user.email,
      subject: "하루정리 이메일 인증 코드",
      text: [
        `${user.name}님, 하루정리 이메일 인증 코드입니다.`,
        "",
        `인증 코드: ${code}`,
        "",
        "이 코드는 30분 동안 유효합니다.",
        "본인이 요청하지 않았다면 이 메일을 무시해 주세요."
      ].join("\n"),
      html: [
        "<div style=\"font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#111827\">",
        "<h1 style=\"font-size:22px;margin:0 0 12px\">하루정리 이메일 인증</h1>",
        `<p>${escapeHtml(user.name)}님, 아래 6자리 코드를 앱에 입력해 주세요.</p>`,
        `<p style=\"font-size:32px;font-weight:800;letter-spacing:6px;margin:20px 0;color:#0f766e\">${code}</p>`,
        "<p style=\"color:#64748b\">이 코드는 30분 동안 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>",
        "</div>"
      ].join("")
    });
    console.log(`[email-verification] sent to ${user.email}`);
    if (EMAIL_DEBUG_CODES) {
      console.log(`[email-verification-debug] ${user.email}: ${code}`);
    }
  } catch (error) {
    console.error(`[email-verification] failed to send to ${user.email}:`, error);
    console.log(`[email-verification] ${user.email}: ${code}`);
  }
}

function verifyEmailCode(user, code) {
  if (!code || !user.emailVerificationHash || !user.emailVerificationExpiresAt) return false;
  if (new Date(user.emailVerificationExpiresAt).getTime() < Date.now()) return false;
  return secureCompare(hashToken(code), user.emailVerificationHash);
}

function emailDeliveryConfigured() {
  return Boolean(SMTP_HOST && SMTP_PORT && SMTP_FROM && SMTP_USER && SMTP_PASS);
}

async function sendEmail({ to, subject, text, html }) {
  const client = new SmtpClient({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    user: SMTP_USER,
    pass: SMTP_PASS
  });

  await client.connect();
  try {
    await client.send({
      from: SMTP_FROM,
      to,
      subject,
      text,
      html
    });
  } finally {
    await client.quit().catch(() => undefined);
  }
}

function secureCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

class SmtpClient {
  constructor({ host, port, secure, user, pass }) {
    this.host = host;
    this.port = port;
    this.secure = secure;
    this.user = user;
    this.pass = pass;
    this.socket = undefined;
    this.buffer = "";
  }

  async connect() {
    this.socket = this.secure
      ? tls.connect({ host: this.host, port: this.port, servername: this.host })
      : net.connect({ host: this.host, port: this.port });

    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => {
      this.buffer += chunk;
    });

    await this.expect([220]);
    await this.command(`EHLO ${hostnameForSmtp()}`, [250]);

    if (!this.secure) {
      await this.command("STARTTLS", [220]);
      this.socket = tls.connect({ socket: this.socket, servername: this.host });
      this.socket.setEncoding("utf8");
      this.buffer = "";
      this.socket.on("data", (chunk) => {
        this.buffer += chunk;
      });
      await this.command(`EHLO ${hostnameForSmtp()}`, [250]);
    }

    await this.command("AUTH LOGIN", [334]);
    await this.command(Buffer.from(this.user).toString("base64"), [334]);
    await this.command(Buffer.from(this.pass).toString("base64"), [235]);
  }

  async send({ from, to, subject, text, html }) {
    await this.command(`MAIL FROM:<${extractEmail(from)}>`, [250]);
    await this.command(`RCPT TO:<${extractEmail(to)}>`, [250, 251]);
    await this.command("DATA", [354]);
    await this.writeData(formatEmailMessage({ from, to, subject, text, html }));
  }

  async quit() {
    if (!this.socket) return;
    await this.command("QUIT", [221]).catch(() => undefined);
    this.socket.end();
  }

  async command(line, expectedCodes) {
    this.socket.write(`${line}\r\n`);
    return this.expect(expectedCodes);
  }

  async writeData(message) {
    this.socket.write(`${message}\r\n.\r\n`);
    return this.expect([250]);
  }

  expect(expectedCodes) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const response = readSmtpResponse(this.buffer);
        if (!response.complete) {
          if (Date.now() - startedAt > 15000) {
            clearInterval(timer);
            reject(new Error("SMTP response timed out."));
          }
          return;
        }

        clearInterval(timer);
        this.buffer = this.buffer.slice(response.endIndex);
        if (expectedCodes.includes(response.code)) {
          resolve(response.text);
        } else {
          reject(new Error(`SMTP expected ${expectedCodes.join("/")} but received ${response.text}`));
        }
      }, 20);
    });
  }
}

function readSmtpResponse(buffer) {
  const lines = buffer.split(/\r?\n/);
  let consumedLength = 0;

  for (const line of lines) {
    if (!line) break;
    consumedLength += line.length + 2;
    if (/^\d{3} /.test(line)) {
      return {
        complete: true,
        code: Number(line.slice(0, 3)),
        text: buffer.slice(0, consumedLength).trim(),
        endIndex: consumedLength
      };
    }
  }

  return { complete: false };
}

function formatEmailMessage({ from, to, subject, text, html }) {
  const boundary = `haru_${crypto.randomBytes(12).toString("hex")}`;
  return [
    `From: ${encodeMailAddress(from)}`,
    `To: ${encodeMailAddress(to)}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    `Message-ID: <${crypto.randomUUID()}@haru-jeongri.local>`,
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    chunkBase64(Buffer.from(text, "utf8").toString("base64")),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    chunkBase64(Buffer.from(html, "utf8").toString("base64")),
    `--${boundary}--`
  ].join("\r\n");
}

function encodeMailAddress(value) {
  const email = extractEmail(value);
  const name = String(value).replace(/<[^>]+>/g, "").trim();
  if (!name || name === email) return email;
  return `${encodeMimeWord(name)} <${email}>`;
}

function encodeMimeWord(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), "utf8").toString("base64")}?=`;
}

function chunkBase64(value) {
  return String(value).match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function extractEmail(value) {
  const match = String(value).match(/<([^>]+)>/);
  return (match?.[1] ?? String(value)).trim();
}

function hostnameForSmtp() {
  return "haru-jeongri.local";
}

function sessionPayload(user, token) {
  return {
    token,
    user: publicUser(user)
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    tier: user.tier,
    paymentStatus: user.paymentStatus,
    pendingTier: user.pendingTier,
    depositorName: user.depositorName,
    paymentRequestedAt: user.paymentRequestedAt,
    paymentApprovedAt: user.paymentApprovedAt
  };
}

function canUseAnalysis(user) {
  if (user.tier !== "free") return true;
  const usage = todayUsage(user);
  return usage.aiAnalysisCount < 3;
}

function markAnalysisUsed(user) {
  const usage = todayUsage(user);
  usage.aiAnalysisCount += 1;
  user.usage = usage;
}

function todayUsage(user) {
  const today = new Date().toISOString().slice(0, 10);
  if (!user.usage || user.usage.date !== today) {
    user.usage = {
      date: today,
      aiAnalysisCount: 0
    };
  }
  return user.usage;
}

function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function validatePassword(password) {
  if (password.length < 10) return "비밀번호는 10자 이상이어야 합니다.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return "영문 대문자와 소문자를 모두 포함해 주세요.";
  if (!/\d/.test(password)) return "숫자를 1개 이상 포함해 주세요.";
  if (!/[^A-Za-z0-9]/.test(password)) return "특수문자를 1개 이상 포함해 주세요.";
  return "";
}

function consumeRateLimit(request, key) {
  const ip = request.socket.remoteAddress ?? "unknown";
  const rateKey = `${key}:${ip}`;
  const now = Date.now();
  const bucket = rateLimits.get(rateKey) ?? { count: 0, resetAt: now + AUTH_LIMIT_WINDOW_MS };

  if (bucket.resetAt < now) {
    bucket.count = 0;
    bucket.resetAt = now + AUTH_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  rateLimits.set(rateKey, bucket);
  return bucket.count <= AUTH_LIMIT_MAX;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Cross-Origin-Resource-Policy", "same-site");
}

function isAdminRequest(request) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const queryCode = url.searchParams.get("adminCode") ?? "";
  const headerCode = request.headers["x-admin-code"];
  const code = typeof headerCode === "string" ? headerCode : queryCode;
  return secureCompare(code, ADMIN_APPROVAL_CODE);
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(html);
}

function sendAdminPage(response) {
  sendHtml(
    response,
    200,
    `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>하루정리 관리자</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f7f8; color: #111827; }
    main { max-width: 760px; margin: 0 auto; padding: 32px 18px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { color: #64748b; line-height: 1.5; }
    input, button { min-height: 44px; border-radius: 8px; font: inherit; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #d9e3e6; padding: 0 12px; margin: 14px 0; }
    button { border: 0; padding: 0 14px; background: #0f766e; color: white; font-weight: 800; cursor: pointer; }
    .card { background: white; border: 1px solid #d9e3e6; border-radius: 8px; padding: 16px; margin-top: 14px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .reject { background: #ef4444; }
    .muted { color: #64748b; font-size: 13px; }
    code { background: #e6f7f6; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <main>
    <h1>하루정리 관리자</h1>
    <p>계좌이체 입금 확인 후 승인 또는 반려하세요. 관리자 코드는 서버의 <code>.env.ai</code>에만 있어야 합니다.</p>
    <input id="code" type="password" placeholder="관리자 승인 코드" />
    <button onclick="loadPending()">승인 대기 목록 불러오기</button>
    <section id="list"></section>
  </main>
  <script>
    async function loadPending() {
      const code = document.querySelector("#code").value.trim();
      const response = await fetch("/admin/payments/pending", { headers: { "X-Admin-Code": code } });
      const payload = await response.json();
      const list = document.querySelector("#list");
      if (!response.ok) {
        list.innerHTML = '<div class="card">관리자 코드가 맞지 않거나 설정이 없습니다.</div>';
        return;
      }
      if (!payload.users.length) {
        list.innerHTML = '<div class="card">승인 대기 중인 결제가 없습니다.</div>';
        return;
      }
      list.innerHTML = payload.users.map(user => \`
        <article class="card">
          <strong>\${escapeHtml(user.name)} / \${escapeHtml(user.email)}</strong>
          <p class="muted">신청 플랜: \${escapeHtml(user.pendingTier)} · 입금자명: \${escapeHtml(user.depositorName || "")}</p>
          <p class="muted">신청일: \${escapeHtml(user.paymentRequestedAt || "")}</p>
          <div class="row">
            <button onclick="decide('\${user.id}', 'approve')">승인</button>
            <button class="reject" onclick="decide('\${user.id}', 'reject')">반려</button>
          </div>
        </article>
      \`).join("");
    }
    async function decide(userId, action) {
      const code = document.querySelector("#code").value.trim();
      const response = await fetch(action === "approve" ? "/admin/payments/approve" : "/admin/payments/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminCode: code, userId })
      });
      if (!response.ok) alert("처리하지 못했습니다.");
      await loadPending();
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    }
  </script>
</body>
</html>`
  );
}

function readEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return {};

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((env, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) return env;
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = value;
      return env;
    }, {});
}
