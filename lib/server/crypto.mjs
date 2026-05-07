import crypto from "node:crypto";

const SCRYPT_PARAMS = {
  N: 1 << 16,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024,
  keylen: 64
};

const PEPPER = process.env.PASSWORD_PEPPER ?? "";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const peppered = applyPepper(password);
  const key = crypto
    .scryptSync(peppered, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS)
    .toString("base64url");
  return { hash: key, salt };
}

export function verifyPassword(password, salt, expectedHashB64) {
  if (!salt || !expectedHashB64) return false;
  try {
    const peppered = applyPepper(password);
    const expected = Buffer.from(expectedHashB64, "base64url");
    const actual = crypto.scryptSync(peppered, salt, expected.length, SCRYPT_PARAMS);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function dummyVerify(password) {
  try {
    crypto.scryptSync(applyPepper(String(password ?? "")), "dummy-salt-padding", SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  } catch {
    // ignore
  }
  return false;
}

export function applyPepper(password) {
  if (!PEPPER) return password;
  return crypto.createHmac("sha256", PEPPER).update(password).digest("base64url");
}

export function generateCode() {
  return `${crypto.randomInt(0, 1_000_000)}`.padStart(6, "0");
}

export function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("base64url");
}

export function generateUserId() {
  return `user_${crypto.randomUUID()}`;
}

export function constantTimeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}
