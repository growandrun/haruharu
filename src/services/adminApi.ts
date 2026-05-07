export type AdminStats = {
  totalUsers: number;
  verifiedUsers: number;
  pendingPayments: number;
  todaySignups: number;
  weekSignups: number;
  weekLogins: number;
  chart: Array<{ date: string; signups: number; logins: number }>;
};

export type AdminUser = {
  email: string;
  emailMasked: string;
  name: string;
  id: string;
  tier: string;
  emailVerified: boolean;
  paymentStatus: string;
  pendingTier: string | null;
  depositorName: string;
  paymentRequestedAt: string | null;
  paymentApprovedAt: string | null;
  createdAt: string | null;
  isLocked: boolean;
  lockedUntil: number | null;
  loginFailureCount: number;
};

export type PendingPayment = {
  email: string;
  emailMasked: string;
  name: string;
  pendingTier: string;
  depositorName: string;
  paymentRequestedAt: string | null;
};

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

async function req<T>(method: "GET" | "POST", path: string, secret: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (res.status === 401) throw new Error("비밀번호가 틀렸습니다.");
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(json.message ?? "요청 실패");
  }
  return res.json() as Promise<T>;
}

export const fetchAdminStats = (s: string) => req<AdminStats>("GET", "/admin/stats", s);
export const fetchAdminUsers = (s: string) => req<{ users: AdminUser[] }>("GET", "/admin/users", s);
export const fetchAdminGetUser = (s: string, email: string) => req<{ user: AdminUser }>("POST", "/admin/get-user", s, { email });
export const fetchAdminUpdateUser = (s: string, email: string, changes: Partial<AdminUser> & { unlockAccount?: boolean }) =>
  req<{ user: AdminUser }>("POST", "/admin/update-user", s, { email, changes });
export const fetchAdminDeleteUser = (s: string, email: string) => req<{ ok: boolean }>("POST", "/admin/delete-user", s, { email });
export const fetchAdminPayments = (s: string) => req<{ payments: PendingPayment[] }>("GET", "/admin/payments", s);
export const fetchAdminApprovePayment = (s: string, email: string) => req<{ ok: boolean }>("POST", "/admin/approve-payment", s, { email });
export const fetchAdminRejectPayment = (s: string, email: string) => req<{ ok: boolean }>("POST", "/admin/reject-payment", s, { email });
