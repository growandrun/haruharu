export type AdminStats = {
  totalUsers: number;
  todaySignups: number;
  weekSignups: number;
  weekLogins: number;
  chart: Array<{
    date: string;
    signups: number;
    verifications: number;
    logins: number;
  }>;
};

export type AdminUser = {
  email: string;
  name: string;
  tier: string;
  emailVerified: boolean;
  paymentStatus: string;
  createdAt: string | null;
};

function getAdminBaseUrl(): string {
  const loc = (globalThis as unknown as { location?: { protocol?: string; host?: string; hostname?: string } }).location;
  if (loc?.protocol?.startsWith("http") && loc.host) {
    if (loc.hostname === "localhost" || loc.hostname === "127.0.0.1") {
      return `${loc.protocol}//${loc.hostname}:8787/api`;
    }
    return `${loc.protocol}//${loc.host}/api`;
  }
  return "";
}

async function adminFetch<T>(path: string, secret: string): Promise<T> {
  const base = getAdminBaseUrl();
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  if (res.status === 401) throw new Error("비밀번호가 틀렸습니다.");
  if (!res.ok) throw new Error("데이터를 불러오지 못했습니다.");
  return res.json() as Promise<T>;
}

export function fetchAdminStats(secret: string): Promise<AdminStats> {
  return adminFetch<AdminStats>("/admin/stats", secret);
}

export function fetchAdminUsers(secret: string): Promise<{ users: AdminUser[] }> {
  return adminFetch<{ users: AdminUser[] }>("/admin/users", secret);
}
