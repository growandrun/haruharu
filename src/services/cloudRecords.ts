import type { DayRecord } from "../types/app";

function getBase(): string {
  const loc = (globalThis as unknown as { location?: { protocol?: string; host?: string; hostname?: string } }).location;
  if (loc?.protocol?.startsWith("http") && loc.host) {
    if (loc.hostname === "localhost" || loc.hostname === "127.0.0.1") {
      return `${loc.protocol}//${loc.hostname}:8787/api`;
    }
    return `${loc.protocol}//${loc.host}/api`;
  }
  return "";
}

async function apiFetch<T>(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, {
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
