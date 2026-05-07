import { getUserCount, getRecentUsers, batchGetAccounts, getDailyStat } from "./storage.mjs";
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

  const [totalUsers, ...statRows] = await Promise.all([
    getUserCount(),
    ...days.flatMap((d) => [
      getDailyStat("signup", d),
      getDailyStat("verification", d),
      getDailyStat("login", d)
    ])
  ]);

  const chart = days.map((date, i) => ({
    date,
    signups: Number(statRows[i * 3] ?? 0),
    verifications: Number(statRows[i * 3 + 1] ?? 0),
    logins: Number(statRows[i * 3 + 2] ?? 0)
  }));

  const todaySignups = chart[6].signups;
  const weekSignups = chart.reduce((s, r) => s + r.signups, 0);
  const weekLogins = chart.reduce((s, r) => s + r.logins, 0);

  return res.status(200).json({ totalUsers, todaySignups, weekSignups, weekLogins, chart });
}

export async function handleAdminUsers(req, res) {
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: "unauthorized", message: "관리자 비밀번호가 틀렸습니다." });
  }

  const emails = await getRecentUsers(30);
  const accounts = await batchGetAccounts(emails);

  const users = accounts
    .map((account, i) => {
      if (!account) return null;
      return {
        email: maskEmail(emails[i]),
        name: account.name ?? "",
        tier: account.tier ?? "free",
        emailVerified: Boolean(account.emailVerified),
        paymentStatus: account.paymentStatus ?? "none",
        createdAt: account.createdAt ?? null
      };
    })
    .filter(Boolean);

  return res.status(200).json({ users });
}
