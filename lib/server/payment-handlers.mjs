import { getAccount, setAccount } from "./storage.mjs";
import { publicUser } from "./http.mjs";
import { authenticate } from "./auth-utils.mjs";

const VALID_TIERS = ["pro"];

export async function handlePaymentRequest(req, res) {
  const auth = await authenticate(req);
  if (!auth) {
    return res.status(401).json({ error: "auth_required", message: "로그인이 필요합니다." });
  }

  const body = req.body ?? {};
  const tier = typeof body.tier === "string" ? body.tier : "";
  const depositorName = typeof body.depositorName === "string" ? body.depositorName.trim().slice(0, 40) : "";

  if (!VALID_TIERS.includes(tier)) {
    return res.status(400).json({ error: "invalid_tier", message: "올바른 플랜을 선택해 주세요." });
  }
  if (!depositorName) {
    return res.status(400).json({ error: "missing_depositor", message: "입금자명을 입력해 주세요." });
  }

  const { account } = auth;

  if (account.paymentStatus === "approved" && account.tier === tier) {
    return res.status(409).json({ error: "already_active", message: "이미 해당 플랜을 사용 중입니다." });
  }

  account.paymentStatus = "pending";
  account.pendingTier = tier;
  account.depositorName = depositorName;
  account.paymentRequestedAt = new Date().toISOString();
  account.paymentApprovedAt = undefined;
  await setAccount(account.email, account);

  return res.status(200).json({ user: publicUser(account) });
}
