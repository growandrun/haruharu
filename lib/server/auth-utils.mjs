/**
 * 공유 인증 유틸리티
 * records-handlers, payment-handlers, auth-handlers가 공통으로 사용합니다.
 */
import { bearerToken } from "./http.mjs";
import { hashToken } from "./crypto.mjs";
import { getSession, deleteSession, getAccount } from "./storage.mjs";

/**
 * Bearer 토큰으로 세션을 검증하고 account를 반환합니다.
 * 만료된 세션은 자동으로 삭제합니다.
 * @returns {{ account, token, tokenHash, session } | null}
 */
export async function authenticate(req) {
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
