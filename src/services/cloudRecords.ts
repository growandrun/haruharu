import type { DayRecord } from "../types/app";
import { getApiBase } from "../lib/apiBase";

async function apiFetch<T>(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<T> {
  const base = getApiBase();
  if (!base) throw new Error("API base URL을 확인할 수 없습니다.");

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(json.message ?? `records API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchCloudRecords(token: string): Promise<DayRecord[]> {
  const data = await apiFetch<{ records: DayRecord[] }>("GET", "/records/all", token);
  return data.records ?? [];
}

export async function syncCloudRecords(token: string, localRecords: DayRecord[]): Promise<DayRecord[]> {
  const data = await apiFetch<{ records: DayRecord[] }>("POST", "/records/sync", token, { records: localRecords });
  return data.records ?? [];
}

export async function saveCloudRecords(token: string, records: DayRecord[]): Promise<void> {
  await apiFetch<{ ok: boolean }>("POST", "/records/save", token, { records });
}
