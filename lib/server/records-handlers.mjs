import { getRecords, setRecords } from "./storage.mjs";
import { getSession } from "./storage.mjs";
import { bearerToken } from "./http.mjs";
import { hashToken } from "./crypto.mjs";
import { getAccount } from "./storage.mjs";

const MAX_RECORDS = 3000;
const MAX_RECORD_BYTES = 5 * 1024 * 1024; // 5 MB per user

async function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const session = await getSession(hashToken(token));
  if (!session || Date.now() > session.expiresAt) return null;
  const account = await getAccount(session.email);
  if (!account) return null;
  return { account, session };
}

function mergeRecords(serverRecords, clientRecords) {
  const byId = new Map();
  for (const r of serverRecords) {
    if (r?.id) byId.set(r.id, r);
  }
  for (const r of clientRecords) {
    if (!r?.id) continue;
    const existing = byId.get(r.id);
    if (!existing || r.createdAt > existing.createdAt) {
      byId.set(r.id, r);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, MAX_RECORDS);
}

// GET /api/records/all — 서버에서 전체 기록 조회
export async function handleRecordsGet(req, res) {
  const auth = await authenticate(req);
  if (!auth) return res.status(401).json({ error: "auth_required" });

  const records = (await getRecords(auth.account.id)) ?? [];
  return res.status(200).json({ records });
}

// POST /api/records/sync — 로컬 기록과 서버 기록을 병합 후 저장
export async function handleRecordsSync(req, res) {
  const auth = await authenticate(req);
  if (!auth) return res.status(401).json({ error: "auth_required" });

  const clientRecords = Array.isArray(req.body?.records) ? req.body.records : [];
  const serverRecords = (await getRecords(auth.account.id)) ?? [];
  const merged = mergeRecords(serverRecords, clientRecords);

  const json = JSON.stringify(merged);
  if (Buffer.byteLength(json) > MAX_RECORD_BYTES) {
    return res.status(413).json({ error: "records_too_large", message: "기록 용량 한도를 초과했습니다." });
  }

  await setRecords(auth.account.id, merged);
  return res.status(200).json({ records: merged });
}

// POST /api/records/save — 서버 기록을 클라이언트 기록으로 완전 교체
export async function handleRecordsSave(req, res) {
  const auth = await authenticate(req);
  if (!auth) return res.status(401).json({ error: "auth_required" });

  const clientRecords = Array.isArray(req.body?.records) ? req.body.records : [];
  const trimmed = clientRecords
    .filter((r) => r?.id)
    .slice(0, MAX_RECORDS);

  const json = JSON.stringify(trimmed);
  if (Buffer.byteLength(json) > MAX_RECORD_BYTES) {
    return res.status(413).json({ error: "records_too_large", message: "기록 용량 한도를 초과했습니다." });
  }

  await setRecords(auth.account.id, trimmed);
  return res.status(200).json({ ok: true, count: trimmed.length });
}
