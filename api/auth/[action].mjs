import {
  handleSignup,
  handleLogin,
  handleVerifyEmail,
  handleResend,
  handleForgotRequest,
  handleForgotConfirm,
  handleLogout,
  handleMe
} from "../../lib/server/auth-handlers.mjs";
import { applySecurityHeaders, applyCors } from "../../lib/server/http.mjs";

const routes = {
  signup: { method: "POST", handler: handleSignup },
  login: { method: "POST", handler: handleLogin },
  logout: { method: "POST", handler: handleLogout },
  "verify-email": { method: "POST", handler: handleVerifyEmail },
  resend: { method: "POST", handler: handleResend },
  "forgot-request": { method: "POST", handler: handleForgotRequest },
  "forgot-confirm": { method: "POST", handler: handleForgotConfirm },
  me: { method: "GET", handler: handleMe }
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
    const safeMessage = error instanceof Error ? error.name : "unknown";
    console.error(`[auth/${action}]`, error?.message ?? error);
    if (!res.writableEnded) {
      res.status(500).json({ error: "server_error", code: safeMessage });
    }
  }
}
