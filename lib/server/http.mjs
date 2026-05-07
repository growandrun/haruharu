const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PRODUCTION = NODE_ENV === "production";

export function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Cache-Control", "no-store");
}

export function applyCors(req, res) {
  const origin = req.headers?.origin;
  if (!origin) return true;

  const host = req.headers?.host;
  const sameOrigin = host && (origin === `https://${host}` || origin === `http://${host}`);

  let allowed = sameOrigin;
  if (ALLOWED_ORIGINS.length > 0) {
    allowed = sameOrigin || ALLOWED_ORIGINS.includes(origin);
  } else if (!IS_PRODUCTION && !sameOrigin) {
    allowed = true;
  }

  if (!allowed) return false;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

export function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? "unknown";
}

export function bearerToken(req) {
  const header = req.headers?.authorization;
  if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

export function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string" && req.body.length > 0) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

export function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F\u00AD\u200B-\u200F\u2028-\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) && cleaned.length <= 254 ? cleaned : "";
}

export function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F\u00AD\u200B-\u200F\u2028-\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 10) return "비밀번호는 10자 이상이어야 합니다.";
  if (password.length > 200) return "비밀번호는 200자 이하여야 합니다.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return "영문 대문자와 소문자를 모두 포함해 주세요.";
  if (!/\d/.test(password)) return "숫자를 1개 이상 포함해 주세요.";
  if (!/[^A-Za-z0-9]/.test(password)) return "특수문자를 1개 이상 포함해 주세요.";
  return "";
}

export function publicUser(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    emailVerified: Boolean(account.emailVerified),
    tier: account.tier ?? "free",
    paymentStatus: account.paymentStatus ?? "none",
    pendingTier: account.pendingTier,
    depositorName: account.depositorName ?? "",
    paymentRequestedAt: account.paymentRequestedAt,
    paymentApprovedAt: account.paymentApprovedAt
  };
}
