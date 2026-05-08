import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST ?? "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587", 10);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const MAIL_FROM = process.env.MAIL_FROM ?? (SMTP_USER ? `하루정리 <${SMTP_USER}>` : "");
const APP_NAME = process.env.APP_NAME ?? "하루정리";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

export function isEmailConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

export async function sendVerificationEmail({ to, name, code }) {
  return sendCodeEmail({
    to,
    subject: `${APP_NAME} 이메일 인증 코드`,
    headline: "이메일 인증 코드",
    name,
    code,
    purpose: "회원가입을 마치려면 아래 6자리 인증 코드를 앱에 입력해 주세요."
  });
}

export async function sendPasswordResetEmail({ to, name, code }) {
  return sendCodeEmail({
    to,
    subject: `${APP_NAME} 비밀번호 재설정 코드`,
    headline: "비밀번호 재설정 코드",
    name,
    code,
    purpose: "비밀번호를 재설정하려면 아래 6자리 인증 코드를 앱에 입력해 주세요."
  });
}

export async function sendPaymentApprovedEmail({ to, name, tier }) {
  const transport = getTransporter();
  if (!transport) return; // SMTP 미설정 시 조용히 무시

  const safeName = (name ?? "").trim();
  const greeting = safeName ? `${escapeHtml(safeName)}님,` : "안녕하세요,";
  const tierName = tier === "pro" ? "PRO" : escapeHtml(String(tier));
  const subject = `${APP_NAME} ${tierName} 플랜 승인이 완료되었습니다`;

  const html = [
    `<!doctype html>`,
    `<html lang="ko">`,
    `<head><meta charset="utf-8" /><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:24px;background:#F5F8FA;font-family:'Helvetica Neue',Helvetica,Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB">`,
    `<tr><td style="padding:28px 28px 12px">`,
    `<div style="font-size:13px;font-weight:700;color:#0F766E;letter-spacing:1px;text-transform:uppercase">${escapeHtml(APP_NAME)}</div>`,
    `<h1 style="font-size:22px;margin:8px 0 0;color:#111827">🎉 ${tierName} 플랜 승인 완료</h1>`,
    `</td></tr>`,
    `<tr><td style="padding:0 28px">`,
    `<p style="line-height:1.6;color:#374151">${greeting} 결제가 확인되어 <strong>${tierName}</strong> 플랜이 활성화되었습니다.</p>`,
    `<div style="background:#ECFDF5;border-radius:12px;padding:20px 24px;margin:20px 0;text-align:center">`,
    `<div style="font-size:32px;margin-bottom:8px">✅</div>`,
    `<div style="font-size:18px;font-weight:800;color:#0F766E">${tierName} 플랜 활성화됨</div>`,
    `<div style="font-size:13px;color:#6B7280;margin-top:6px">앱을 열어 프리미엄 기능을 이용해 보세요.</div>`,
    `</div>`,
    `</td></tr>`,
    `<tr><td style="padding:24px 28px;border-top:1px solid #F3F4F6;color:#9CA3AF;font-size:12px;line-height:1.6">`,
    `이 메일은 ${escapeHtml(APP_NAME)} 시스템이 자동으로 발송했습니다. 문의사항은 앱 고객센터를 이용해 주세요.`,
    `</td></tr>`,
    `</table>`,
    `</body></html>`
  ].join("");

  const text = [
    `${safeName ? `${safeName}님,` : "안녕하세요,"}`,
    ``,
    `결제가 확인되어 ${tierName} 플랜이 활성화되었습니다.`,
    `앱을 열어 프리미엄 기능을 이용해 보세요.`,
    ``,
    APP_NAME
  ].join("\n");

  await transport.sendMail({ from: MAIL_FROM, to, subject, text, html });
}

async function sendCodeEmail({ to, subject, headline, name, code, purpose }) {
  const transport = getTransporter();
  if (!transport) {
    throw new Error("SMTP is not configured.");
  }

  const safeName = (name ?? "").trim();
  const greeting = safeName ? `${escapeHtml(safeName)}님,` : "안녕하세요,";

  const html = [
    `<!doctype html>`,
    `<html lang="ko">`,
    `<head><meta charset="utf-8" /><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:24px;background:#F5F8FA;font-family:'Helvetica Neue',Helvetica,Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB">`,
    `<tr><td style="padding:28px 28px 12px">`,
    `<div style="font-size:13px;font-weight:700;color:#0F766E;letter-spacing:1px;text-transform:uppercase">${escapeHtml(APP_NAME)}</div>`,
    `<h1 style="font-size:22px;margin:8px 0 0;color:#111827">${escapeHtml(headline)}</h1>`,
    `</td></tr>`,
    `<tr><td style="padding:0 28px">`,
    `<p style="line-height:1.6;color:#374151">${greeting} ${escapeHtml(purpose)}</p>`,
    `<div style="font-size:36px;font-weight:800;letter-spacing:8px;text-align:center;margin:24px 0;padding:18px 0;background:#ECFDF5;color:#0F766E;border-radius:12px;font-family:'SF Mono','Menlo','Consolas',monospace">${escapeHtml(code)}</div>`,
    `<p style="line-height:1.6;color:#6B7280;font-size:13px">이 코드는 30분 동안 유효합니다. 5회 이상 잘못 입력하면 코드가 무효화됩니다. 본인이 요청하지 않았다면 이 메일은 무시해 주세요.</p>`,
    `</td></tr>`,
    `<tr><td style="padding:24px 28px;border-top:1px solid #F3F4F6;color:#9CA3AF;font-size:12px;line-height:1.6">`,
    `이 메일은 ${escapeHtml(APP_NAME)} 시스템이 자동으로 발송했습니다. 회신 주소는 모니터링되지 않습니다.`,
    `</td></tr>`,
    `</table>`,
    `</body></html>`
  ].join("");

  const text = [
    `${safeName ? `${safeName}님,` : "안녕하세요,"} ${purpose}`,
    "",
    `인증 코드: ${code}`,
    "",
    "이 코드는 30분 동안 유효합니다.",
    "본인이 요청하지 않았다면 이 메일은 무시해 주세요.",
    "",
    APP_NAME
  ].join("\n");

  await transport.sendMail({ from: MAIL_FROM, to, subject, text, html });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
