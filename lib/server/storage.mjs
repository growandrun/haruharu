import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? "",
  token: process.env.KV_REST_API_TOKEN ?? ""
});

const ACCOUNT_PREFIX = "haru:account:";
const SESSION_PREFIX = "haru:session:";
const VERIFICATION_PREFIX = "haru:verification:";
const RATELIMIT_PREFIX = "haru:ratelimit:";
const STATS_PREFIX = "haru:stats:";
const USER_INDEX_KEY = "haru:users:index";

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

export async function incrementDailyStat(name) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${STATS_PREFIX}${name}:${today}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60 * 60 * 24 * 90);
}

export async function getDailyStat(name, date) {
  return (await redis.get(`${STATS_PREFIX}${name}:${date}`)) ?? 0;
}

const RECORDS_PREFIX = "haru:records:";

export async function getRecords(userId) {
  if (!userId) return null;
  return redis.get(`${RECORDS_PREFIX}${userId}`);
}

export async function setRecords(userId, records) {
  return redis.set(`${RECORDS_PREFIX}${userId}`, records);
}

export async function deleteAccount(email) {
  return redis.del(`${ACCOUNT_PREFIX}${email}`);
}

export async function deleteRecords(userId) {
  if (!userId) return 0;
  return redis.del(`${RECORDS_PREFIX}${userId}`);
}

/**
 * 특정 userId의 모든 세션을 Redis SCAN으로 찾아 일괄 삭제합니다.
 * 관리자 패널의 "세션 강제 만료" 기능에서 사용합니다.
 */
export async function deleteUserSessions(userId) {
  if (!userId) return 0;
  const keys = [];
  let cursor = 0;
  do {
    const [nextCursor, batch] = await redis.scan(cursor, {
      match: `${SESSION_PREFIX}*`,
      count: 200
    });
    keys.push(...batch);
    cursor = Number(nextCursor);
  } while (cursor !== 0);

  if (!keys.length) return 0;
  const sessions = await redis.mget(...keys);
  const toDelete = keys.filter((_, i) => sessions[i]?.userId === userId);
  if (!toDelete.length) return 0;
  await redis.del(...toDelete);
  return toDelete.length;
}

export async function getAllAccounts() {
  const keys = [];
  let cursor = 0;
  do {
    const [nextCursor, batch] = await redis.scan(cursor, {
      match: `${ACCOUNT_PREFIX}*`,
      count: 200
    });
    keys.push(...batch);
    cursor = Number(nextCursor);
  } while (cursor !== 0);

  if (!keys.length) return [];
  const accounts = await redis.mget(...keys);
  return accounts.filter(Boolean);
}
