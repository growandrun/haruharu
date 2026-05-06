import type { UserSettings } from "../types/app";

export const defaultSettings: UserSettings = {
  tier: "free",
  isLoggedIn: false,
  userId: undefined,
  authToken: undefined,
  emailVerified: false,
  signupEmailVerificationPending: false,
  paymentStatus: "none",
  pendingTier: undefined,
  depositorName: "",
  paymentRequestedAt: undefined,
  paymentApprovedAt: undefined,
  reminderHour: 22,
  reminderMinute: 0,
  summaryReminderEnabled: false,
  privacyMode: true,
  displayName: "",
  email: ""
};
