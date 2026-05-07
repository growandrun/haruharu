import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? "",
  token: process.env.KV_REST_API_TOKEN ?? ""
});

const ACCOUNT_PREFIX = "haru:account:";
const SESSION_PREFIX = "haru:session:";
const VERIFICATION_PREFIX = "haru:verification:";
const RATELIMIT_PREFIX = "haru:ratelimit:";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const VERIFICATION_TTL_SECONDS = 60 * 30;

export async function getAccount(email) {
  if (!email) return null;
  return redis.get(`${ACCOUNT_PREFIX}${email}`);
}

export async function setAccount(email, account) {
  return redis.set(`${ACCOUNT_PREFIX}${email}`, account);
}

export async function getSession(tokenHash) {
  if (!tokenHash) return null;
  return redis.get(`${SESSION_PREFIX}${tokenHash}`);
}

export async function setSession(tokenHash, session) {
  return redis.set(`${SESSION_PREFIX}${tokenHash}`, session, { ex: SESSION_TTL_SECONDS });
}

export async function deleteSession(tokenHash) {
  return redis.del(`${SESSION_PREFIX}${tokenHash}`);
}

export async function getVerification(email) {
  if (!email) return null;
  return redis.get(`${VERIFICATION_PREFIX}${email}`);
}

export async function setVerification(email, verification) {
  return redis.set(`${VERIFICATION_PREFIX}${email}`, verification, { ex: VERIFICATION_TTL_SECONDS });
}

export async function deleteVerification(email) {
  return redis.del(`${VERIFICATION_PREFIX}${email}`);
}

export async function consumeRateLimit(key, windowSeconds, max) {
  const fullKey = `${RATELIMIT_PREFIX}${key}`;
  const count = await redis.incr(fullKey);
  if (count === 1) {
    await redis.expire(fullKey, windowSeconds);
  }
  return count <= max;
}
