import { getAllAccounts, getAccount, setAccount, deleteAccount, deleteVerification, getDailyStat } from "./storage.mjs";
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

function fullUser(account) {
  return {
    email: account.email,
    name: account.name ?? "",
    id: account.id,
    tier: account.tier ?? "free",
    emailVerified: Boolean(account.emailVerified),
    paymentStatus: account.paymentStatus ?? "none",
    pendingTier: account.pendingTier ?? null,
    depositorName: account.depositorName ?? "",
    paymentRequestedAt: account.paymentRequestedAt ?? null,
    paymentApprovedAt: account.paymentApprovedAt ?? null,
    createdAt: account.createdAt ?? null,
    isLocked: Boolean(account.loginLockedUntil && Date.now() < account.loginLockedUntil),
    lockedUntil: account.loginLockedUntil ?? null,
    loginFailureCount: account.loginFailureCount ?? 0
  };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function handleAdminStats(req, res) {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const days = Array.from({ length: 7 }, (_, i) => isoDate(6 - i));
  const today = days[6];
  const weekStart = days[0];

  const [accounts, ...loginRows] = await Promise.all([
    getAllAccounts(),
    ...days.map((d) => getDailyStat("login", d))
  ]);

  const totalUsers = accounts.length;
  const verifiedUsers = accounts.filter((a) => a.emailVerified).length;
  const pendingPayments = accounts.filter((a) => a.paymentStatus === "pending").length;

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

  return res.status(200).json({ totalUsers, verifiedUsers, pendingPayments, todaySignups, weekSignups, weekLogins, chart });
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function handleAdminUsers(req, res) {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const accounts = await getAllAccounts();
  accounts.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  const users = accounts.map((a) => ({
    ...fullUser(a),
    emailMasked: maskEmail(a.email)
  }));

  return res.status(200).json({ users });
}

export async function handleAdminGetUser(req, res) {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) return res.status(400).json({ error: "missing_email" });

  const account = await getAccount(email);
  if (!account) return res.status(404).json({ error: "user_not_found" });

  return res.status(200).json({ user: fullUser(account) });
}

export async function handleAdminUpdateUser(req, res) {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) return res.status(400).json({ error: "missing_email" });

  const account = await getAccount(email);
  if (!account) return res.status(404).json({ error: "user_not_found" });

  const changes = req.body?.changes ?? {};

  if (typeof changes.name === "string") {
    account.name = changes.name.trim().slice(0, 40) || account.name;
  }
  if (changes.tier === "free" || changes.tier === "pro") {
    account.tier = changes.tier;
  }
  if (typeof changes.emailVerified === "boolean") {
    account.emailVerified = changes.emailVerified;
    if (changes.emailVerified && !account.emailVerifiedAt) {
      account.emailVerifiedAt = new Date().toISOString();
    }
  }
  if (["none", "pending", "approved"].includes(changes.paymentStatus)) {
    account.paymentStatus = changes.paymentStatus;
  }
  if (changes.unlockAccount === true) {
    account.loginFailureCount = 0;
    account.loginLockedUntil = null;
  }

  await setAccount(email, account);
  return res.status(200).json({ user: fullUser(account) });
}

export async function handleAdminDeleteUser(req, res) {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) return res.status(400).json({ error: "missing_email" });

  const account = await getAccount(email);
  if (!account) return res.status(404).json({ error: "user_not_found" });

  await Promise.all([
    deleteAccount(email),
    deleteVerification(email)
  ]);

  return res.status(200).json({ ok: true });
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function handleAdminPayments(req, res) {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const accounts = await getAllAccounts();
  const pending = accounts
    .filter((a) => a.paymentStatus === "pending")
    .sort((a, b) => {
      const ta = a.paymentRequestedAt ? new Date(a.paymentRequestedAt).getTime() : 0;
      const tb = b.paymentRequestedAt ? new Date(b.paymentRequestedAt).getTime() : 0;
      return ta - tb;
    })
    .map((a) => ({
      email: a.email,
      emailMasked: maskEmail(a.email),
      name: a.name ?? "",
      pendingTier: a.pendingTier ?? "pro",
      depositorName: a.depositorName ?? "",
      paymentRequestedAt: a.paymentRequestedAt ?? null
    }));

  return res.status(200).json({ payments: pending });
}

export async function handleAdminApprovePayment(req, res) {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) return res.status(400).json({ error: "missing_email" });

  const account = await getAccount(email);
  if (!account) return res.status(404).json({ error: "user_not_found" });
  if (account.paymentStatus !== "pending") {
    return res.status(409).json({ error: "not_pending", message: "승인 대기 중인 결제 신청이 없습니다." });
  }

  account.tier = account.pendingTier ?? "pro";
  account.paymentStatus = "approved";
  account.paymentApprovedAt = new Date().toISOString();
  account.pendingTier = undefined;
  await setAccount(email, account);

  return res.status(200).json({ ok: true, user: fullUser(account) });
}

export async function handleAdminRejectPayment(req, res) {
  if (!checkAdminAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) return res.status(400).json({ error: "missing_email" });

  const account = await getAccount(email);
  if (!account) return res.status(404).json({ error: "user_not_found" });

  account.paymentStatus = "none";
  account.pendingTier = undefined;
  account.depositorName = "";
  account.paymentRequestedAt = undefined;
  await setAccount(email, account);

  return res.status(200).json({ ok: true });
}
