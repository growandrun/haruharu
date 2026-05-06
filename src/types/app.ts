export type TabKey = "home" | "record" | "analysis" | "report" | "settings";

export type Expense = {
  id: string;
  label: string;
  amount: number;
  confidence: number;
  dateKey?: string;
};

export type Todo = {
  id: string;
  title: string;
  done: boolean;
  source: "ai" | "user";
  dateKey?: string;
};

export type Mood = {
  label: string;
  score: number;
  detail: string;
  dateKey?: string;
};

export type DayAnalysis = {
  summary: string;
  expenses: Expense[];
  todos: Todo[];
  moods: Mood[];
  notes: string[];
  tomorrowPlan: string[];
  wasteSignals: string[];
  createdAt: string;
};

export type DayRecord = {
  id: string;
  rawText: string;
  analysis: DayAnalysis;
  createdAt: string;
};

export type SubscriptionTier = "free" | "plus" | "premium";

export type PaymentApprovalStatus = "none" | "pending" | "approved" | "rejected";

export type UserSettings = {
  tier: SubscriptionTier;
  isLoggedIn: boolean;
  userId?: string;
  authToken?: string;
  emailVerified: boolean;
  signupEmailVerificationPending: boolean;
  paymentStatus: PaymentApprovalStatus;
  pendingTier?: SubscriptionTier;
  depositorName: string;
  paymentRequestedAt?: string;
  paymentApprovedAt?: string;
  reminderHour: number;
  reminderMinute: number;
  summaryReminderEnabled: boolean;
  privacyMode: boolean;
  displayName: string;
  email: string;
};
