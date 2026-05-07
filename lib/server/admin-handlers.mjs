import { getAllAccounts, getDailyStat } from "./storage.mjs";
import { bearerToken } from "./http.mjs";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

function checkAdminAuth(req) {
  if (!ADMIN_SECRET) return false;
  return bearerToken(req) === ADMIN_SECRET;
}

function isoDate(offsetDays = 0) {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function maskEmail(email) {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length - 1));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

export async function handleAdminStats(req, res) {
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: "unauthorized", message: "관리자 비밀번호가 틀렸습니다." });
  }

  const days = Array.from({ length: 7 }, (_, i) => isoDate(6 - i));
  const today = days[6];
  const weekStart = days[0];

  const [accounts, ...loginRows] = await Promise.all([
    getAllAccounts(),
    ...days.map((d) => getDailyStat("login", d))
  ]);

  const totalUsers = accounts.length;
  const verifiedUsers = accounts.filter((a) => a.emailVerified).length;

  // signup counts from createdAt field on each account (works for all existing users)
  const signupByDay = {};
  for (const a of accounts) {
    const day = typeof a.createdAt === "string" ? a.createdAt.slice(0, 10) : null;
    if (day) signupByDay[day] = (signupByDay[day] ?? 0) + 1;
  }

  const todaySignups = signupByDay[today] ?? 0;
  const weekSignups = Object.entries(signupByDay)
    .filter(([d]) => d >= weekStart && d <= today)
    .reduce((s, [, c]) => s + c, 0);
  const weekLogins = loginRows.reduce((s, v) => s + Number(v ?? 0), 0);

  const chart = days.map((date, i) => ({
    date,
    signups: signupByDay[date] ?? 0,
    logins: Number(loginRows[i] ?? 0)
  }));

  return res.status(200).json({
    totalUsers,
    verifiedUsers,
    todaySignups,
    weekSignups,
    weekLogins,
    chart
  });
}

export async function handleAdminUsers(req, res) {
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: "unauthorized", message: "관리자 비밀번호가 틀렸습니다." });
  }

  const accounts = await getAllAccounts();

  // Sort by createdAt descending (most recent first)
  accounts.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  const users = accounts.slice(0, 50).map((a) => ({
    email: maskEmail(a.email ?? ""),
    name: a.name ?? "",
    tier: a.tier ?? "free",
    emailVerified: Boolean(a.emailVerified),
    paymentStatus: a.paymentStatus ?? "none",
    createdAt: a.createdAt ?? null
  }));

  return res.status(200).json({ users });
}
