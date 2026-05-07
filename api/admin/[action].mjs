import {
  handleAdminStats,
  handleAdminUsers,
  handleAdminGetUser,
  handleAdminUpdateUser,
  handleAdminDeleteUser,
  handleAdminPayments,
  handleAdminApprovePayment,
  handleAdminRejectPayment
} from "../../lib/server/admin-handlers.mjs";
import { applySecurityHeaders, applyCors } from "../../lib/server/http.mjs";

const routes = {
  stats:            { method: "GET",  handler: handleAdminStats },
  users:            { method: "GET",  handler: handleAdminUsers },
  "get-user":       { method: "POST", handler: handleAdminGetUser },
  "update-user":    { method: "POST", handler: handleAdminUpdateUser },
  "delete-user":    { method: "POST", handler: handleAdminDeleteUser },
  payments:         { method: "GET",  handler: handleAdminPayments },
  "approve-payment":{ method: "POST", handler: handleAdminApprovePayment },
  "reject-payment": { method: "POST", handler: handleAdminRejectPayment }
};

export default async function handler(req, res) {
  applySecurityHeaders(res);

  if (!applyCors(req, res)) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const action = req.query?.action;
  const route = typeof action === "string" ? routes[action] : undefined;

  if (!route) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (req.method !== route.method) {
    res.setHeader("Allow", route.method);
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  try {
    await route.handler(req, res);
  } catch (error) {
    console.error(`[admin/${action}]`, error?.message ?? error);
    if (!res.writableEnded) {
      res.status(500).json({ error: "server_error" });
    }
  }
}
