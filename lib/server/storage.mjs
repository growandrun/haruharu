import { kv } from "@vercel/kv";

const ACCOUNT_PREFIX = "haru:account:";
const SESSION_PREFIX = "haru:session:";
const VERIFICATION_PREFIX = "haru:verification:";
const RATELIMIT_PREFIX = "haru:ratelimit:";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const VERIFICATION_TTL_SECONDS = 60 * 30;

export async function getAccount(email) {
  if (!email) return null;
  return kv.get(`${ACCOUNT_PREFIX}${email}`);
}

export async function setAccount(email, account) {
  return kv.set(`${ACCOUNT_PREFIX}${email}`, account);
}

export async function getSession(tokenHash) {
  if (!tokenHash) return null;
  return kv.get(`${SESSION_PREFIX}${tokenHash}`);
}

export async function setSession(tokenHash, session) {
  return kv.set(`${SESSION_PREFIX}${tokenHash}`, session, { ex: SESSION_TTL_SECONDS });
}

export async function deleteSession(tokenHash) {
  return kv.del(`${SESSION_PREFIX}${tokenHash}`);
}

export async function getVerification(email) {
  if (!email) return null;
  return kv.get(`${VERIFICATION_PREFIX}${email}`);
}

export async function setVerification(email, verification) {
  return kv.set(`${VERIFICATION_PREFIX}${email}`, verification, { ex: VERIFICATION_TTL_SECONDS });
}

export async function deleteVerification(email) {
  return kv.del(`${VERIFICATION_PREFIX}${email}`);
}

export async function consumeRateLimit(key, windowSeconds, max) {
  const fullKey = `${RATELIMIT_PREFIX}${key}`;
  const count = await kv.incr(fullKey);
  if (count === 1) {
    await kv.expire(fullKey, windowSeconds);
  }
  return count <= max;
}
