import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts } from "expo-font";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  Home,
  Lock,
  Mic,
  Moon,
  PenLine,
  Plus,
  ReceiptText,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound
} from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { analyzeDay } from "./src/services/ai";
import {
  AuthError,
  confirmPasswordReset as confirmPasswordResetRequest,
  login as loginRequest,
  logout as logoutRequest,
  requestPasswordReset as requestPasswordResetCode,
  requestPayment as requestPaymentRequest,
  resendVerification,
  signup as signupRequest,
  verifyEmail
} from "./src/services/auth";
import { cancelDailySummaryReminder, scheduleDailySummaryReminder } from "./src/services/notifications";
import { loadRecords, loadSettings, resetLocalData, saveRecords, saveSettings } from "./src/services/storage";
import { defaultSettings } from "./src/data/sample";
import { colors, spacing } from "./src/theme/colors";
import type { DayRecord, Expense, Mood, SubscriptionTier, TabKey, Todo, UserSettings } from "./src/types/app";
import { formatDateLabel, formatWon, shortTime, sum } from "./src/lib/format";

type AppIcon = React.ComponentType<{ size?: number; color?: string }>;

const tabs: Array<{ key: TabKey; label: string; icon: AppIcon }> = [
  { key: "home", label: "홈", icon: Home },
  { key: "record", label: "기록", icon: PenLine },
  { key: "analysis", label: "정리", icon: Sparkles },
  { key: "report", label: "리포트", icon: TrendingUp },
  { key: "settings", label: "설정", icon: Settings }
];

const planCopy: Record<SubscriptionTier, { name: string; price: string; detail: string }> = {
  free: { name: "무료", price: "0원", detail: "하루 기록 3개, 기본 요약" },
  plus: { name: "유료", price: "월 4,900원", detail: "무제한 기록, AI 하루 분석, 소비/감정 패턴" },
  premium: { name: "프리미엄", price: "월 9,900원", detail: "목표 관리, PDF 리포트, 캘린더/음성 확장" }
};

const bankTransferInfo = {
  bank: "카카오뱅크",
  account: "3333-00-0000000",
  holder: "하루정리"
};

const font = {
  regular: "Pretendard-Regular",
  semibold: "Pretendard-SemiBold",
  bold: "Pretendard-Bold",
  extraBold: "Pretendard-ExtraBold"
};

const releaseLinks = {
  privacy: "https://harujeongri.com/privacy",
  terms: "https://harujeongri.com/terms",
  support: "https://harujeongri.com/support"
};

const appVersion = "0.1.0";

function formatCooldown(totalSeconds: number) {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes > 0) {
    return `${minutes}분 ${seconds.toString().padStart(2, "0")}초`;
  }
  return `${seconds}초`;
}

function formatReminderTime(hour: number, minute: number) {
  return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`;
}

function clampTimeValue(value: string, max: number) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return 0;
  return Math.min(max, Number(digits));
}

function dateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recordDateKey(record: DayRecord) {
  return dateKeyFromDate(new Date(record.createdAt));
}

function isDateKey(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function expenseDateKey(expense: Expense, record: DayRecord) {
  return isDateKey(expense.dateKey) ? expense.dateKey! : recordDateKey(record);
}

function todoDateKey(todo: Todo, record: DayRecord) {
  return isDateKey(todo.dateKey) ? todo.dateKey! : recordDateKey(record);
}

function moodDateKey(mood: Mood, record: DayRecord) {
  return isDateKey(mood.dateKey) ? mood.dateKey! : recordDateKey(record);
}

function dateKeysForRecord(record: DayRecord) {
  const itemKeys = [
    ...record.analysis.expenses.map((expense) => expenseDateKey(expense, record)),
    ...record.analysis.todos.map((todo) => todoDateKey(todo, record)),
    ...record.analysis.moods.map((mood) => moodDateKey(mood, record))
  ].filter(isDateKey);

  return Array.from(new Set(itemKeys.length ? itemKeys : [recordDateKey(record)]));
}

function dateKeyInRange(dateKey: string, start: Date, end: Date) {
  const startKey = dateKeyFromDate(start);
  const endKey = dateKeyFromDate(end);
  return dateKey >= startKey && dateKey < endKey;
}

function recordsForDate(records: DayRecord[], date = new Date()) {
  const targetKey = dateKeyFromDate(date);
  return records.filter((record) => dateKeysForRecord(record).includes(targetKey));
}

function recordsToday(records: DayRecord[]) {
  return recordsForDate(records).length;
}

function startOfLocalWeek(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfLocalWeek(date = new Date()) {
  const end = startOfLocalWeek(date);
  end.setDate(end.getDate() + 7);
  return end;
}

function recordsForCurrentWeek(records: DayRecord[], date = new Date()) {
  const start = startOfLocalWeek(date);
  const end = endOfLocalWeek(date);
  return records.filter((record) => dateKeysForRecord(record).some((key) => dateKeyInRange(key, start, end)));
}

function recordsForCurrentMonth(records: DayRecord[], date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return records.filter((record) => dateKeysForRecord(record).some((key) => dateKeyInRange(key, start, end)));
}

function projectedMonthExpense(records: DayRecord[], date = new Date()) {
  const monthExpense = totalExpenseForRange(
    records,
    new Date(date.getFullYear(), date.getMonth(), 1),
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  );
  const elapsedDays = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Math.round((monthExpense / Math.max(elapsedDays, 1)) * daysInMonth);
}

function totalExpenseForDate(records: DayRecord[], date = new Date()) {
  const targetKey = dateKeyFromDate(date);
  return sum(
    records.flatMap((record) =>
      record.analysis.expenses
        .filter((expense) => expenseDateKey(expense, record) === targetKey)
        .map((expense) => expense.amount)
    )
  );
}

function totalExpenseForRange(records: DayRecord[], start: Date, end: Date) {
  return sum(
    records.flatMap((record) =>
      record.analysis.expenses
        .filter((expense) => dateKeyInRange(expenseDateKey(expense, record), start, end))
        .map((expense) => expense.amount)
    )
  );
}

function frequentExpenseForRange(records: DayRecord[], start: Date, end: Date) {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    record.analysis.expenses.forEach((expense) => {
      if (dateKeyInRange(expenseDateKey(expense, record), start, end)) {
        counts.set(expense.label, (counts.get(expense.label) ?? 0) + 1);
      }
    });
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "아직 없음";
}

function todosForDate(records: DayRecord[], date = new Date()) {
  const targetKey = dateKeyFromDate(date);
  return records.flatMap((record) => record.analysis.todos.filter((todo) => todoDateKey(todo, record) === targetKey));
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long"
  }).format(date);
}

function formatDateKeyLabel(dateKey?: string) {
  if (!isDateKey(dateKey)) return "";
  const [year, month, day] = dateKey!.split("-").map(Number);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric"
  }).format(new Date(year, month - 1, day));
}

function withDateLabel(label: string, dateKey?: string) {
  const dateLabel = formatDateKeyLabel(dateKey);
  return dateLabel ? `${dateLabel} · ${label}` : label;
}

function buildMonthDays(monthDate: Date): Array<Date | null> {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: Array<Date | null> = Array.from({ length: firstDay.getDay() }, () => null);

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(new Date(year, month, day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function getHomeBrief(summary?: string) {
  if (!summary) {
    return {
      title: "오늘 기록을 남겨보세요",
      detail: "소비, 할 일, 감정이 한 번에 정리됩니다."
    };
  }

  if (summary.includes("첫 기록")) {
    return {
      title: "첫 기록으로 기준을 만들고 있어요",
      detail: summary.replace("첫 기록이라 기준을 만들고 있습니다.", "").trim()
    };
  }

  const sentences = summary
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return {
    title: sentences[0] ?? "오늘의 흐름을 정리했어요",
    detail: sentences.slice(1).join(" ")
  };
}

function AppShell() {
  const [fontsLoaded] = useFonts({
    "Pretendard-Regular": require("./assets/fonts/Pretendard-Regular.otf"),
    "Pretendard-SemiBold": require("./assets/fonts/Pretendard-SemiBold.otf"),
    "Pretendard-Bold": require("./assets/fonts/Pretendard-Bold.otf"),
    "Pretendard-ExtraBold": require("./assets/fonts/Pretendard-ExtraBold.otf")
  });
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [records, setRecords] = useState<DayRecord[]>([]);
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [entry, setEntry] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [loginName, setLoginName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [authStage, setAuthStage] = useState<"signup" | "login" | "forgot_request" | "forgot_confirm">("signup");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [authError, setAuthError] = useState("");
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifyCodeError, setVerifyCodeError] = useState("");
  const [resendSubmitting, setResendSubmitting] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [checkoutTier, setCheckoutTier] = useState<SubscriptionTier | null>(null);
  const [depositorName, setDepositorName] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetNewPasswordConfirm, setResetNewPasswordConfirm] = useState("");

  useEffect(() => {
    async function boot() {
      const [loadedRecords, loadedSettings] = await Promise.all([loadRecords(), loadSettings()]);
      setRecords(loadedRecords);
      setSettings(loadedSettings);
      setDraftName(loadedSettings.displayName);
      setDraftEmail(loadedSettings.email);
      setLoginName(loadedSettings.displayName);
      setLoginEmail(loadedSettings.email);
      setDepositorName(loadedSettings.depositorName);
      setLoading(false);
    }

    void boot();
  }, []);

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldownSeconds]);


  const latestRecord = records[0];
  const todayRecords = useMemo(() => recordsForDate(records), [records]);
  const todayRecord = todayRecords[0];
  const weekStart = useMemo(() => startOfLocalWeek(), [records]);
  const weekEnd = useMemo(() => endOfLocalWeek(), [records]);
  const todayExpense = useMemo(
    () => totalExpenseForDate(records),
    [records]
  );
  const weeklyExpense = useMemo(
    () => totalExpenseForRange(records, weekStart, weekEnd),
    [records, weekStart, weekEnd]
  );
  const frequentExpense = useMemo(() => frequentExpenseForRange(records, weekStart, weekEnd), [records, weekStart, weekEnd]);
  const todayTodos = useMemo(
    () => todosForDate(records),
    [records]
  );

  async function updateRecords(nextRecords: DayRecord[]) {
    setRecords(nextRecords);
    await saveRecords(nextRecords);
  }

  async function updateSettings(nextSettings: UserSettings) {
    setSettings(nextSettings);
    await saveSettings(nextSettings);
  }

  function mergeServerSettings(serverSettings: UserSettings) {
    return {
      ...settings,
      ...serverSettings,
      authToken: serverSettings.authToken ?? settings.authToken,
      reminderHour: settings.reminderHour,
      reminderMinute: settings.reminderMinute,
      summaryReminderEnabled: settings.summaryReminderEnabled,
      privacyMode: settings.privacyMode
    };
  }

  async function signup() {
    const name = loginName.trim();
    const email = loginEmail.trim();
    const password = loginPassword;

    setAuthError("");

    if (!name) {
      setAuthError("이름을 입력해 주세요.");
      return;
    }
    if (!email) {
      setAuthError("이메일을 입력해 주세요.");
      return;
    }
    if (password !== passwordConfirm) {
      setAuthError("비밀번호와 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setAuthSubmitting(true);
    try {
      const { settings: serverSettings, nextAllowedAt } = await signupRequest(name, email, password);
      setLoginPassword("");
      setPasswordConfirm("");
      setEmailCode("");
      setResendCooldownSeconds(secondsUntil(nextAllowedAt));
      setAuthNotice("");
      setDraftName(serverSettings.displayName);
      setDraftEmail(serverSettings.email);

      if (serverSettings.signupEmailVerificationPending && !serverSettings.emailVerified) {
        await updateSettings({ ...defaultSettings, ...serverSettings });
      } else {
        setLoginName("");
        setLoginEmail(serverSettings.email);
        setAuthStage("login");
        setAuthNotice("가입이 완료되었습니다. 로그인해 주세요.");
      }
    } catch (error) {
      const cooldownAt = error instanceof AuthError ? error.detail.nextAllowedAt : undefined;
      if (cooldownAt) setResendCooldownSeconds(secondsUntil(cooldownAt));
      setAuthError(authErrorToMessage(error, "회원가입을 처리하지 못했습니다."));
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function login() {
    const email = loginEmail.trim();
    const password = loginPassword;

    setAuthError("");

    if (!email) {
      setAuthError("이메일을 입력해 주세요.");
      return;
    }
    if (!password) {
      setAuthError("비밀번호를 입력해 주세요.");
      return;
    }

    setAuthSubmitting(true);
    setAuthNotice("");
    try {
      const serverSettings = await loginRequest(email, password);
      const nextSettings = { ...defaultSettings, ...serverSettings, signupEmailVerificationPending: false };
      setLoginName(nextSettings.displayName);
      setDraftName(nextSettings.displayName);
      setDraftEmail(nextSettings.email);
      setLoginPassword("");
      setPasswordConfirm("");
      setEmailCode("");
      setResendCooldownSeconds(0);
      await updateSettings(nextSettings);
    } catch (error) {
      if (error instanceof AuthError && error.code === "email_not_verified") {
        setAuthError(error.message);
        setAuthStage("login");
        Alert.alert(
          "이메일 인증 필요",
          "회원가입 시 받은 인증 코드를 입력해 주세요. 코드를 받지 못했다면 비밀번호 찾기로 새 코드를 받을 수 있습니다."
        );
      } else {
        setAuthError(authErrorToMessage(error, "로그인을 처리하지 못했습니다."));
      }
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function submitForgotRequest() {
    const email = resetEmail.trim();
    setAuthError("");

    if (!email) {
      setAuthError("이메일을 입력해 주세요.");
      return;
    }

    setAuthSubmitting(true);
    try {
      const { nextAllowedAt } = await requestPasswordResetCode(email);
      setResendCooldownSeconds(secondsUntil(nextAllowedAt));
      setAuthStage("forgot_confirm");
      setAuthNotice("재설정 코드를 이메일로 보냈습니다. 메일함을 확인해 주세요.");
      setResetCode("");
      setResetNewPassword("");
      setResetNewPasswordConfirm("");
    } catch (error) {
      const cooldownAt = error instanceof AuthError ? error.detail.nextAllowedAt : undefined;
      if (cooldownAt) {
        setResendCooldownSeconds(secondsUntil(cooldownAt));
        setAuthStage("forgot_confirm");
      }
      setAuthError(authErrorToMessage(error, "재설정 코드를 보내지 못했습니다."));
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function submitForgotConfirm() {
    setAuthError("");
    if (resetNewPassword !== resetNewPasswordConfirm) {
      setAuthError("새 비밀번호와 확인이 일치하지 않습니다.");
      return;
    }

    setAuthSubmitting(true);
    try {
      const serverSettings = await confirmPasswordResetRequest(resetEmail.trim(), resetCode, resetNewPassword);
      const nextSettings = { ...defaultSettings, ...serverSettings, signupEmailVerificationPending: false };
      setLoginEmail(nextSettings.email);
      setDraftName(nextSettings.displayName);
      setDraftEmail(nextSettings.email);
      setResetEmail("");
      setResetCode("");
      setResetNewPassword("");
      setResetNewPasswordConfirm("");
      setAuthStage("login");
      setAuthNotice("비밀번호가 변경되었습니다. 새 비밀번호로 자동 로그인됩니다.");
      await updateSettings(nextSettings);
    } catch (error) {
      setAuthError(authErrorToMessage(error, "비밀번호 재설정에 실패했습니다."));
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function logout() {
    await logoutRequest(settings.authToken);
    await updateSettings({
      ...settings,
      isLoggedIn: false,
      displayName: "",
      email: "",
      authToken: undefined,
      userId: undefined,
      signupEmailVerificationPending: false
    });
    setLoginName("");
    setLoginEmail("");
    setLoginPassword("");
    setPasswordConfirm("");
    setAuthStage("login");
    setAuthNotice("");
    setAuthError("");
    setResetEmail("");
    setResetCode("");
    setResetNewPassword("");
    setResetNewPasswordConfirm("");
    setDraftName("");
    setDraftEmail("");
    setActiveTab("home");
  }

  function authErrorToMessage(error: unknown, fallback: string): string {
    if (error instanceof AuthError) return error.message;
    if (error instanceof Error) return error.message;
    return fallback;
  }

  function secondsUntil(timestamp: number | undefined): number {
    if (!timestamp) return 0;
    return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
  }

  async function confirmEmailCode() {
    const code = emailCode.trim();

    if (!code) {
      Alert.alert("인증 코드를 입력해 주세요", "이메일로 받은 6자리 코드를 입력해야 합니다.");
      return;
    }

    setVerifyCodeError("");
    setVerifySubmitting(true);
    try {
      const serverSettings = await verifyEmail(settings.authToken, code, settings.email);
      await updateSettings({ ...mergeServerSettings(serverSettings), signupEmailVerificationPending: false });
      setEmailCode("");
      setResendCooldownSeconds(0);
    } catch (error) {
      setVerifyCodeError(error instanceof Error ? error.message : "이메일 인증을 처리하지 못했습니다.");
    } finally {
      setVerifySubmitting(false);
    }
  }

  async function resendEmailCode() {
    if (resendCooldownSeconds > 0) return;

    setResendSubmitting(true);
    try {
      const { nextAllowedAt } = await resendVerification(settings.authToken, settings.email);
      setResendCooldownSeconds(secondsUntil(nextAllowedAt));
      Alert.alert(
        "인증 코드를 다시 보냈어요",
        "이메일을 확인해 주세요. 메일이 보이지 않으면 스팸 메일함도 확인해 주세요."
      );
    } catch (error) {
      const cooldownAt = error instanceof AuthError ? error.detail.nextAllowedAt : undefined;
      if (cooldownAt) setResendCooldownSeconds(secondsUntil(cooldownAt));
      Alert.alert("재전송 실패", error instanceof Error ? error.message : "인증 코드를 다시 만들지 못했습니다.");
    } finally {
      setResendSubmitting(false);
    }
  }

  async function selectPlan(tier: SubscriptionTier) {
    if (tier === "free") {
      await updateSettings({
        ...settings,
        tier: "free",
        paymentStatus: "none",
        pendingTier: undefined,
        depositorName: "",
        paymentRequestedAt: undefined,
        paymentApprovedAt: undefined
      });
      setCheckoutTier(null);
      Alert.alert("무료 플랜으로 변경했어요", "무료 플랜은 하루 기록 3개와 기본 요약을 사용할 수 있습니다.");
      return;
    }

    setCheckoutTier(tier);
    setDepositorName(settings.depositorName || settings.displayName);
  }

  async function requestBankTransfer(tier: SubscriptionTier, name: string) {
    const trimmedName = name.trim();

    if (!trimmedName) {
      Alert.alert("입금자명을 입력해 주세요", "관리자가 입금 내역을 확인할 수 있도록 입금자명을 입력해야 합니다.");
      return;
    }

    if (!settings.authToken) {
      Alert.alert("로그인이 필요해요", "결제 신청은 로그인된 계정에서만 가능합니다.");
      return;
    }

    try {
      const serverSettings = await requestPaymentRequest(settings.authToken, tier, trimmedName);
      await updateSettings(mergeServerSettings(serverSettings));
      setCheckoutTier(null);
      setActiveTab("settings");
      Alert.alert("승인 대기 중", "입금 확인 후 관리자가 승인하면 선택한 플랜을 사용할 수 있습니다.");
    } catch (error) {
      Alert.alert("결제 신청 실패", error instanceof Error ? error.message : "결제 신청을 처리하지 못했습니다.");
    }
  }

  async function submitEntry() {
    const trimmed = entry.trim();
    if (!trimmed) {
      Alert.alert("기록이 비어 있어요", "오늘 있었던 일을 한두 문장만 적어도 정리할 수 있습니다.");
      return;
    }
    if (settings.tier === "free" && recordsToday(records) >= 3) {
      Alert.alert("무료 기록 한도", "무료 플랜은 하루 3개까지 기록할 수 있습니다. 유료 플랜에서 무제한 기록을 사용할 수 있어요.");
      setActiveTab("settings");
      return;
    }

    setAnalyzing(true);
    try {
      const analysis = await analyzeDay(trimmed, records, settings.authToken);
      const record: DayRecord = {
        id: `record-${Date.now()}`,
        rawText: trimmed,
        analysis,
        createdAt: new Date().toISOString()
      };
      await updateRecords([record, ...records]);
      setEntry("");
      setActiveTab("analysis");
    } catch (error) {
      Alert.alert("AI 정리를 사용할 수 없어요", error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function toggleTodo(todo: Todo) {
    const todayDateKey = dateKeyFromDate(new Date());
    const nextRecords = records.map((record) => {
      if (!record.analysis.todos.some((item) => item.id === todo.id && todoDateKey(item, record) === todayDateKey)) return record;
      return {
        ...record,
        analysis: {
          ...record.analysis,
          todos: record.analysis.todos.map((item) =>
            item.id === todo.id && todoDateKey(item, record) === todayDateKey ? { ...item, done: !item.done } : item
          )
        }
      };
    });
    await updateRecords(nextRecords);
  }

  async function saveProfile() {
    await updateSettings({ ...settings, displayName: draftName.trim(), email: draftEmail.trim() });
    Alert.alert("저장했어요", "프로필 정보가 이 기기에 저장되었습니다.");
  }

  async function saveReminder(hour: number, minute: number) {
    const result = await scheduleDailySummaryReminder(hour, minute);
    const nextSettings = {
      ...settings,
      reminderHour: hour,
      reminderMinute: minute,
      summaryReminderEnabled: result.enabled
    };
    await updateSettings(nextSettings);
    Alert.alert(result.enabled ? "알림을 켰어요" : "알림을 켤 수 없어요", result.message);
  }

  async function disableReminder() {
    await cancelDailySummaryReminder();
    await updateSettings({ ...settings, summaryReminderEnabled: false });
    Alert.alert("알림을 껐어요", "매일 요약 알림 예약을 취소했습니다.");
  }

  async function performResetLocalData() {
    await cancelDailySummaryReminder();
    await resetLocalData();
    setRecords([]);
    setSettings(defaultSettings);
    setDraftName("");
    setDraftEmail("");
    setLoginName("");
    setLoginEmail("");
    setEmailCode("");
    setResendCooldownSeconds(0);
    setDepositorName("");
    setCheckoutTier(null);
    setEntry("");
    setActiveTab("home");
  }

  async function confirmResetLocalData() {
    if (Platform.OS === "web") {
      const webConfirm = (globalThis as unknown as { confirm?: (message: string) => boolean }).confirm;
      const shouldReset = webConfirm?.(
        "이 기기에 저장된 기록과 설정을 모두 삭제할까요? 다른 기기의 데이터에는 영향을 주지 않습니다."
      );
      if (shouldReset) {
        await performResetLocalData();
      }
      return;
    }

    Alert.alert(
      "로컬 데이터 초기화",
      "이 기기에 저장된 기록과 설정을 모두 삭제합니다. 다른 기기의 데이터에는 영향을 주지 않습니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "초기화",
          style: "destructive",
          onPress: performResetLocalData
        }
      ]
    );
  }

  if (loading || !fontsLoaded) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.forest} />
        <Text style={styles.loadingText}>하루를 불러오는 중</Text>
      </SafeAreaView>
    );
  }

  if (!settings.isLoggedIn) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
          <ScrollView contentContainerStyle={styles.authContent} showsVerticalScrollIndicator={false}>
            {authStage === "forgot_request" ? (
              <ForgotPasswordRequestScreen
                email={resetEmail}
                setEmail={setResetEmail}
                notice={authNotice}
                error={authError}
                onSubmit={submitForgotRequest}
                onBack={() => {
                  setAuthStage("login");
                  setAuthError("");
                  setAuthNotice("");
                }}
                submitting={authSubmitting}
              />
            ) : authStage === "forgot_confirm" ? (
              <ForgotPasswordConfirmScreen
                email={resetEmail}
                code={resetCode}
                setCode={setResetCode}
                newPassword={resetNewPassword}
                setNewPassword={setResetNewPassword}
                newPasswordConfirm={resetNewPasswordConfirm}
                setNewPasswordConfirm={setResetNewPasswordConfirm}
                notice={authNotice}
                error={authError}
                onSubmit={submitForgotConfirm}
                onBack={() => {
                  setAuthStage("forgot_request");
                  setAuthError("");
                  setAuthNotice("");
                }}
                submitting={authSubmitting}
              />
            ) : (
              <LoginScreen
                mode={authStage === "signup" ? "signup" : "login"}
                name={loginName}
                email={loginEmail}
                password={loginPassword}
                passwordConfirm={passwordConfirm}
                notice={authNotice}
                error={authError}
                setMode={(mode) => {
                  setAuthStage(mode);
                  setAuthNotice("");
                  setAuthError("");
                }}
                setName={setLoginName}
                setEmail={setLoginEmail}
                setPassword={setLoginPassword}
                setPasswordConfirm={setPasswordConfirm}
                onSignup={signup}
                onLogin={login}
                onForgotPassword={() => {
                  setAuthStage("forgot_request");
                  setAuthError("");
                  setAuthNotice("");
                  setResetEmail(loginEmail);
                }}
                submitting={authSubmitting}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (settings.signupEmailVerificationPending && !settings.emailVerified) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
          <ScrollView contentContainerStyle={styles.authContent} showsVerticalScrollIndicator={false}>
            <VerifyEmailScreen
              email={settings.email}
              code={emailCode}
              setCode={(v) => { setEmailCode(v); setVerifyCodeError(""); }}
              onVerify={confirmEmailCode}
              onResend={resendEmailCode}
              onLogout={logout}
              verifySubmitting={verifySubmitting}
              codeError={verifyCodeError}
              resendSubmitting={resendSubmitting}
              resendCooldownSeconds={resendCooldownSeconds}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
        <View style={styles.app}>
          <Header settings={settings} />
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {checkoutTier ? (
              <CheckoutScreen
                tier={checkoutTier}
                depositorName={depositorName}
                setDepositorName={setDepositorName}
                onSubmit={() => requestBankTransfer(checkoutTier, depositorName)}
                onCancel={() => setCheckoutTier(null)}
              />
            ) : activeTab === "home" && (
              <HomeScreen
                current={todayRecord}
                todayExpense={todayExpense}
                weeklyExpense={weeklyExpense}
                frequentExpense={frequentExpense}
                todayTodos={todayTodos}
                onRecord={() => setActiveTab("record")}
                onToggleTodo={toggleTodo}
              />
            )}
            {!checkoutTier && activeTab === "record" && (
              <RecordScreen
                entry={entry}
                setEntry={setEntry}
                analyzing={analyzing}
                settings={settings}
                recordCount={recordsToday(records)}
                onSubmit={submitEntry}
              />
            )}
            {!checkoutTier && activeTab === "analysis" && <AnalysisScreen current={latestRecord} />}
            {!checkoutTier && activeTab === "report" && (
              <ReportScreen records={records} weeklyExpense={weeklyExpense} frequentExpense={frequentExpense} />
            )}
            {!checkoutTier && activeTab === "settings" && (
              <SettingsScreen
                settings={settings}
                draftName={draftName}
                draftEmail={draftEmail}
                setDraftName={setDraftName}
                setDraftEmail={setDraftEmail}
                onSaveProfile={saveProfile}
                onUpdateSettings={updateSettings}
                onSelectPlan={selectPlan}
                onLogout={logout}
                recordsCount={records.length}
                onResetLocalData={confirmResetLocalData}
                onSaveReminder={saveReminder}
                onDisableReminder={disableReminder}
              />
            )}
          </ScrollView>
          <TabBar
            activeTab={activeTab}
            onChange={(tab) => {
              setCheckoutTier(null);
              setActiveTab(tab);
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LoginScreen({
  mode,
  name,
  email,
  password,
  passwordConfirm,
  notice,
  error,
  setMode,
  setName,
  setEmail,
  setPassword,
  setPasswordConfirm,
  onSignup,
  onLogin,
  onForgotPassword,
  submitting
}: {
  mode: "signup" | "login";
  name: string;
  email: string;
  password: string;
  passwordConfirm: string;
  notice: string;
  error: string;
  setMode: (value: "signup" | "login") => void;
  setName: (value: string) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setPasswordConfirm: (value: string) => void;
  onSignup: () => void;
  onLogin: () => void;
  onForgotPassword: () => void;
  submitting: boolean;
}) {
  const isSignup = mode === "signup";

  return (
    <View style={styles.authScreen}>
      <View style={styles.authBrandMark}>
        <Sparkles size={28} color={colors.surface} />
      </View>
      <Text style={styles.authTitle}>하루정리</Text>
      <Text style={styles.authSubtitle}>로그인하면 기록, 결제 신청, 승인 상태가 이 기기에 저장됩니다.</Text>

      <View style={styles.authCard}>
        <View style={styles.authModeRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMode("signup")}
            disabled={submitting}
            style={({ pressed }) => [
              styles.authModeButton,
              isSignup && styles.authModeButtonActive,
              pressed && styles.buttonPressed,
              submitting && styles.buttonDisabled
            ]}
          >
            <Text style={[styles.authModeText, isSignup && styles.authModeTextActive]}>회원가입</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMode("login")}
            disabled={submitting}
            style={({ pressed }) => [
              styles.authModeButton,
              !isSignup && styles.authModeButtonActive,
              pressed && styles.buttonPressed,
              submitting && styles.buttonDisabled
            ]}
          >
            <Text style={[styles.authModeText, !isSignup && styles.authModeTextActive]}>로그인</Text>
          </Pressable>
        </View>
        {notice ? (
          <View style={styles.authNotice}>
            <Check size={16} color={colors.forestDark} />
            <Text style={styles.authNoticeText}>{notice}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.authErrorBox}>
            <Text style={styles.authErrorText}>{error}</Text>
          </View>
        ) : null}
        <Text style={styles.authCardTitle}>{isSignup ? "보안 계정 만들기" : "다시 로그인"}</Text>
        {isSignup ? (
          <View style={styles.authInputRow}>
            <UserRound size={18} color={colors.forestDark} />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="이름"
              placeholderTextColor={colors.subtle}
              autoCapitalize="words"
              maxLength={40}
              style={styles.authInput}
            />
          </View>
        ) : null}
        <View style={styles.authInputRow}>
          <ShieldCheck size={18} color={colors.forestDark} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="이메일"
            placeholderTextColor={colors.subtle}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            style={styles.authInput}
          />
        </View>
        <View style={styles.authInputRow}>
          <Lock size={18} color={colors.forestDark} />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="비밀번호"
            placeholderTextColor={colors.subtle}
            secureTextEntry
            textContentType={isSignup ? "newPassword" : "password"}
            autoComplete={isSignup ? "new-password" : "current-password"}
            autoCapitalize="none"
            style={styles.authInput}
          />
        </View>
        {isSignup ? (
          <>
            <View style={styles.authInputRow}>
              <Lock size={18} color={colors.forestDark} />
              <TextInput
                value={passwordConfirm}
                onChangeText={setPasswordConfirm}
                placeholder="비밀번호 확인"
                placeholderTextColor={colors.subtle}
                secureTextEntry
                textContentType="newPassword"
                autoComplete="new-password"
                autoCapitalize="none"
                style={styles.authInput}
              />
            </View>
            <Text style={styles.authRuleText}>10자 이상, 영문 대소문자·숫자·특수문자를 모두 포함해야 합니다.</Text>
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={isSignup ? onSignup : onLogin}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed, submitting && styles.buttonDisabled]}
        >
          {submitting ? <ActivityIndicator color={colors.surface} /> : <Lock size={18} color={colors.surface} />}
          <Text style={styles.primaryButtonText}>{submitting ? "처리 중" : isSignup ? "회원가입" : "로그인"}</Text>
        </Pressable>
        {!isSignup ? (
          <Pressable
            accessibilityRole="button"
            onPress={onForgotPassword}
            disabled={submitting}
            style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.linkButtonText}>비밀번호를 잊으셨나요?</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ForgotPasswordRequestScreen({
  email,
  setEmail,
  notice,
  error,
  onSubmit,
  onBack,
  submitting
}: {
  email: string;
  setEmail: (value: string) => void;
  notice: string;
  error: string;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
}) {
  return (
    <View style={styles.authScreen}>
      <View style={styles.authBrandMark}>
        <ShieldCheck size={28} color={colors.surface} />
      </View>
      <Text style={styles.authTitle}>비밀번호 재설정</Text>
      <Text style={styles.authSubtitle}>가입한 이메일을 입력하면 6자리 인증 코드를 보내드립니다.</Text>

      <View style={styles.authCard}>
        {notice ? (
          <View style={styles.authNotice}>
            <Check size={16} color={colors.forestDark} />
            <Text style={styles.authNoticeText}>{notice}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.authErrorBox}>
            <Text style={styles.authErrorText}>{error}</Text>
          </View>
        ) : null}
        <Text style={styles.authCardTitle}>이메일 확인</Text>
        <View style={styles.authInputRow}>
          <ShieldCheck size={18} color={colors.forestDark} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="이메일"
            placeholderTextColor={colors.subtle}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            style={styles.authInput}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={onSubmit}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed, submitting && styles.buttonDisabled]}
        >
          {submitting ? <ActivityIndicator color={colors.surface} /> : <Check size={18} color={colors.surface} />}
          <Text style={styles.primaryButtonText}>{submitting ? "전송 중" : "재설정 코드 받기"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          disabled={submitting}
          style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.linkButtonText}>로그인으로 돌아가기</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ForgotPasswordConfirmScreen({
  email,
  code,
  setCode,
  newPassword,
  setNewPassword,
  newPasswordConfirm,
  setNewPasswordConfirm,
  notice,
  error,
  onSubmit,
  onBack,
  submitting
}: {
  email: string;
  code: string;
  setCode: (value: string) => void;
  newPassword: string;
  setNewPassword: (value: string) => void;
  newPasswordConfirm: string;
  setNewPasswordConfirm: (value: string) => void;
  notice: string;
  error: string;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
}) {
  return (
    <View style={styles.authScreen}>
      <View style={styles.authBrandMark}>
        <Lock size={28} color={colors.surface} />
      </View>
      <Text style={styles.authTitle}>새 비밀번호 설정</Text>
      <Text style={styles.authSubtitle}>{email} 계정의 비밀번호를 새로 만들어 주세요.</Text>

      <View style={styles.authCard}>
        {notice ? (
          <View style={styles.authNotice}>
            <Check size={16} color={colors.forestDark} />
            <Text style={styles.authNoticeText}>{notice}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.authErrorBox}>
            <Text style={styles.authErrorText}>{error}</Text>
          </View>
        ) : null}
        <Text style={styles.authCardTitle}>인증 코드와 새 비밀번호</Text>
        <View style={styles.authInputRow}>
          <Lock size={18} color={colors.forestDark} />
          <TextInput
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6자리 인증 코드"
            placeholderTextColor={colors.subtle}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.authInput}
          />
        </View>
        <View style={styles.authInputRow}>
          <Lock size={18} color={colors.forestDark} />
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="새 비밀번호"
            placeholderTextColor={colors.subtle}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            autoCapitalize="none"
            style={styles.authInput}
          />
        </View>
        <View style={styles.authInputRow}>
          <Lock size={18} color={colors.forestDark} />
          <TextInput
            value={newPasswordConfirm}
            onChangeText={setNewPasswordConfirm}
            placeholder="새 비밀번호 확인"
            placeholderTextColor={colors.subtle}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            autoCapitalize="none"
            style={styles.authInput}
          />
        </View>
        <Text style={styles.authRuleText}>10자 이상, 영문 대소문자·숫자·특수문자를 모두 포함해야 합니다.</Text>
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={onSubmit}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed, submitting && styles.buttonDisabled]}
        >
          {submitting ? <ActivityIndicator color={colors.surface} /> : <Check size={18} color={colors.surface} />}
          <Text style={styles.primaryButtonText}>{submitting ? "변경 중" : "비밀번호 변경"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          disabled={submitting}
          style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.linkButtonText}>이전 단계로</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CheckoutScreen({
  tier,
  depositorName,
  setDepositorName,
  onSubmit,
  onCancel
}: {
  tier: SubscriptionTier;
  depositorName: string;
  setDepositorName: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const plan = planCopy[tier];

  return (
    <View style={styles.screen}>
      <Section title="계좌이체 결제">
        <View style={styles.checkoutHero}>
          <View style={styles.checkoutIcon}>
            <CreditCard size={22} color={colors.surface} />
          </View>
          <Text style={styles.checkoutTitle}>{plan.name} 플랜 신청</Text>
          <Text style={styles.checkoutPrice}>{plan.price}</Text>
          <Text style={styles.checkoutCopy}>
            아래 계좌로 이체한 뒤 입금자명을 남겨주세요. 관리자가 입금을 확인하면 플랜이 승인됩니다.
          </Text>
        </View>

        <InfoRow label="은행" value={bankTransferInfo.bank} icon={CreditCard} />
        <InfoRow label="계좌번호" value={bankTransferInfo.account} icon={FileText} />
        <InfoRow label="예금주" value={bankTransferInfo.holder} icon={ShieldCheck} />

        <View style={styles.checkoutForm}>
          <Text style={styles.checkoutLabel}>입금자명</Text>
          <TextInput
            value={depositorName}
            onChangeText={setDepositorName}
            placeholder="실제 입금자명"
            placeholderTextColor={colors.subtle}
            style={styles.checkoutInput}
          />
          <View style={styles.checkoutActions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}>
              <Text style={styles.secondaryButtonText}>취소</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onSubmit} style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}>
              <Check size={18} color={colors.surface} />
              <Text style={styles.primaryButtonText}>입금 신청</Text>
            </Pressable>
          </View>
        </View>
      </Section>
    </View>
  );
}

function VerifyEmailScreen({
  email,
  code,
  setCode,
  onVerify,
  onResend,
  onLogout,
  verifySubmitting,
  codeError,
  resendSubmitting,
  resendCooldownSeconds
}: {
  email: string;
  code: string;
  setCode: (value: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onLogout: () => void;
  verifySubmitting: boolean;
  codeError: string;
  resendSubmitting: boolean;
  resendCooldownSeconds: number;
}) {
  const resendDisabled = resendSubmitting || resendCooldownSeconds > 0;

  return (
    <View style={styles.authScreen}>
      <View style={styles.authBrandMark}>
        <ShieldCheck size={28} color={colors.surface} />
      </View>
      <Text style={styles.authTitle}>이메일 인증</Text>
      <Text style={styles.authSubtitle}>
        {email}로 6자리 인증 코드를 보냈습니다. 메일이 도착하지 않으면 스팸 메일함도 확인해 주세요.
      </Text>

      <View style={styles.authCard}>
        <Text style={styles.authCardTitle}>인증 코드 입력</Text>
        <View style={styles.authInputRow}>
          <Lock size={18} color={colors.forestDark} />
          <TextInput
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6자리 코드"
            placeholderTextColor={colors.subtle}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.authInput}
          />
        </View>
        {codeError ? (
          <Text style={styles.authErrorText}>{codeError}</Text>
        ) : (
          <Text style={styles.authRuleText}>
            이메일로 받은 6자리 코드를 입력해 주세요. 5회 이상 틀리면 코드가 무효화되며 다시 받으셔야 합니다.
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={verifySubmitting}
          onPress={onVerify}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed, verifySubmitting && styles.buttonDisabled]}
        >
          {verifySubmitting ? <ActivityIndicator color={colors.surface} /> : <Check size={18} color={colors.surface} />}
          <Text style={styles.primaryButtonText}>{verifySubmitting ? "확인 중" : "인증 완료"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={resendDisabled}
          onPress={onResend}
          style={({ pressed }) => [
            styles.secondaryWideButton,
            pressed && styles.buttonPressed,
            resendDisabled && styles.buttonDisabled
          ]}
        >
          {resendSubmitting ? <ActivityIndicator color={colors.forestDark} /> : null}
          <Text style={styles.secondaryButtonText}>
            {resendSubmitting
              ? "재발송 중"
              : resendCooldownSeconds > 0
                ? `${formatCooldown(resendCooldownSeconds)} 후 다시 보낼 수 있습니다`
                : "인증 코드 다시 받기"}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onLogout} style={({ pressed }) => [styles.logoutButton, pressed && styles.buttonPressed]}>
          <Text style={styles.logoutButtonText}>다른 계정으로 로그인</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Header({ settings }: { settings: UserSettings }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandCluster}>
        <View style={styles.brandMark}>
          <Sparkles size={18} color={colors.surface} />
        </View>
        <View>
          <Text style={styles.appName}>하루정리</Text>
          <Text style={styles.headerSub}>{settings.displayName ? `${settings.displayName}님의 오늘` : "생활을 정리하는 AI 데스크"}</Text>
        </View>
      </View>
      <View style={styles.planBadge}>
        <Text style={styles.planBadgeText}>{planCopy[settings.tier].name}</Text>
      </View>
    </View>
  );
}

function HomeScreen({
  current,
  todayExpense,
  weeklyExpense,
  frequentExpense,
  todayTodos,
  onRecord,
  onToggleTodo
}: {
  current?: DayRecord;
  todayExpense: number;
  weeklyExpense: number;
  frequentExpense: string;
  todayTodos: Todo[];
  onRecord: () => void;
  onToggleTodo: (todo: Todo) => void;
}) {
  const moodLabel = current?.analysis.moods[0]?.label ?? "대기";
  const todoCount = todayTodos.filter((todo) => !todo.done).length;
  const brief = getHomeBrief(current?.analysis.summary);
  const nextPlan = current?.analysis.tomorrowPlan[0] ?? "첫 기록을 남기면 내일 계획을 만들어드릴게요.";

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#07383D", "#0EA5A4"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.todayPanel}>
        <View style={styles.homeHeroHeader}>
          <View>
            <Text style={styles.dateText}>{current ? formatDateLabel(current.createdAt) : "오늘"}</Text>
            <Text style={styles.todayEyebrow}>TODAY BRIEF</Text>
          </View>
          <View style={styles.homeStatusPill}>
            <Moon size={14} color={colors.tealLine} />
            <Text style={styles.homeStatusText}>{moodLabel}</Text>
          </View>
        </View>

        <View style={styles.todayCopyBlock}>
          <Text numberOfLines={2} style={styles.todayTitle}>
            {brief.title}
          </Text>
          {brief.detail ? (
            <Text numberOfLines={2} style={styles.todayDetail}>
              {brief.detail}
            </Text>
          ) : null}
        </View>

        <View style={styles.homeNextBox}>
          <Text style={styles.homeNextLabel}>다음에 할 일</Text>
          <Text numberOfLines={2} style={styles.homeNextText}>{nextPlan}</Text>
        </View>

        <View style={styles.homeHeroActions}>
          <Pressable accessibilityRole="button" onPress={onRecord} style={({ pressed }) => [styles.homePrimaryAction, pressed && styles.buttonPressed]}>
            <PenLine size={18} color={colors.forestDark} />
            <Text style={styles.homePrimaryActionText}>오늘 기록하기</Text>
          </Pressable>
          <View style={styles.homeSecondaryAction}>
            <ClipboardList size={17} color={colors.tealLine} />
            <Text style={styles.homeSecondaryActionText}>{todoCount}개 남음</Text>
          </View>
        </View>

        <View style={styles.heroChips}>
          <View style={styles.heroChip}>
            <ReceiptText size={15} color={colors.tealLine} />
            <Text style={styles.heroChipText}>{formatWon(todayExpense)}</Text>
          </View>
          <View style={styles.heroChip}>
            <CreditCard size={15} color={colors.tealLine} />
            <Text style={styles.heroChipText}>{frequentExpense}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.metricGrid}>
        <Metric label="오늘 지출" value={formatWon(todayExpense)} tone="green" icon={ReceiptText} />
        <Metric label="이번 주" value={formatWon(weeklyExpense)} tone="blue" icon={CalendarDays} />
        <Metric label="자주 쓰는 항목" value={frequentExpense} tone="coral" icon={CreditCard} />
        <Metric label="오늘 기분" value={current?.analysis.moods[0]?.label ?? "대기"} tone="purple" icon={Moon} />
      </View>

      <Section title="오늘 할 일" action="기록 추가" onAction={onRecord}>
        {todayTodos.length ? (
          todayTodos.map((todo, index) => (
            <TodoRow key={`${todo.id}-${index}`} todo={todo} onToggle={() => onToggleTodo(todo)} />
          ))
        ) : (
          <EmptyLine text="기록을 남기면 할 일을 자동으로 찾아드립니다." />
        )}
      </Section>

      <Section title="내일 추천">
        {current?.analysis.tomorrowPlan.map((item, index) => (
          <NumberedLine key={item} index={index + 1} text={item} />
        )) ?? <EmptyLine text="오늘 기록이 생기면 내일 계획이 생성됩니다." />}
      </Section>
    </View>
  );
}

function RecordScreen({
  entry,
  setEntry,
  analyzing,
  settings,
  recordCount,
  onSubmit
}: {
  entry: string;
  setEntry: (value: string) => void;
  analyzing: boolean;
  settings: UserSettings;
  recordCount: number;
  onSubmit: () => void;
}) {
  const remaining = settings.tier === "free" ? Math.max(0, 3 - recordCount) : "무제한";

  return (
    <View style={styles.screen}>
      <Section title="하루 입력">
        <TextInput
          value={entry}
          onChangeText={setEntry}
          multiline
          textAlignVertical="top"
          placeholder="예: 오늘 점심 9,000원, 커피 5,500원 썼고 과제는 못 끝냈고 친구랑 약속 잡아야 함. 요즘 좀 피곤함."
          placeholderTextColor={colors.subtle}
          style={styles.input}
        />
        <View style={styles.recordActions}>
          <Pressable
            accessibilityRole="button"
            style={styles.secondaryButton}
            onPress={() => Alert.alert("음성 입력", "프리미엄 음성 입력은 네이티브 녹음과 서버 전사 API를 연결하면 활성화됩니다.")}
          >
            <Mic size={18} color={colors.forestDark} />
            <Text style={styles.secondaryButtonText}>음성</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={analyzing} onPress={onSubmit} style={styles.primaryButton}>
            {analyzing ? <ActivityIndicator color={colors.surface} /> : <Sparkles size={18} color={colors.surface} />}
            <Text style={styles.primaryButtonText}>{analyzing ? "정리 중" : "AI 정리"}</Text>
          </Pressable>
        </View>
        <Text style={styles.limitText}>오늘 남은 무료 기록: {remaining}</Text>
      </Section>

      <Section title="입력 예시">
        {[
          "회의가 길어져서 운동을 못 했고 택시 14000원 썼음.",
          "커피 4800원, 점심 12000원. 내일 보고서 제출해야 함.",
          "오늘은 기분이 괜찮았고 친구 생일 선물 사야 함."
        ].map((sample) => (
          <Pressable key={sample} accessibilityRole="button" onPress={() => setEntry(sample)} style={styles.sampleRow}>
            <Text style={styles.sampleText}>{sample}</Text>
            <ChevronRight size={18} color={colors.subtle} />
          </Pressable>
        ))}
      </Section>
    </View>
  );
}

function AnalysisScreen({ current }: { current?: DayRecord }) {
  if (!current) {
    return (
      <View style={styles.screen}>
        <EmptyState title="아직 정리할 기록이 없어요" body="기록하기 탭에서 하루를 적으면 AI 정리 카드가 만들어집니다." />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
        <Section title="최근 요약">
        <View style={styles.summaryCard}>
          <Sparkles size={22} color={colors.forestDark} />
          <Text style={styles.summaryText}>{current.analysis.summary}</Text>
          <Text style={styles.timestamp}>{shortTime(current.createdAt)} 분석</Text>
        </View>
      </Section>

      <Section title="소비">
        {current.analysis.expenses.length ? (
          <>
              {current.analysis.expenses.map((expense) => (
                <InfoRow key={expense.id} label={withDateLabel(expense.label, expenseDateKey(expense, current))} value={formatWon(expense.amount)} />
              ))}
            <Divider />
            <InfoRow
              label="총 지출"
              value={formatWon(sum(current.analysis.expenses.map((expense) => expense.amount)))}
              strong
            />
          </>
        ) : (
          <EmptyLine text="소비로 보이는 항목이 없습니다." />
        )}
      </Section>

      <Section title="감정">
        {current.analysis.moods.map((mood) => (
          <View key={mood.label} style={styles.moodRow}>
            <View>
                <Text style={styles.moodLabel}>{withDateLabel(mood.label, moodDateKey(mood, current))}</Text>
              <Text style={styles.moodDetail}>{mood.detail}</Text>
            </View>
            <Text style={styles.moodScore}>{mood.score}</Text>
          </View>
        ))}
      </Section>

      <Section title="메모">
        {current.analysis.notes.length ? (
          current.analysis.notes.map((note) => <BulletLine key={note} text={note} />)
        ) : (
          <EmptyLine text="별도 메모는 감지되지 않았습니다." />
        )}
      </Section>

      <Section title="내일 계획">
        {current.analysis.tomorrowPlan.map((item, index) => (
          <NumberedLine key={item} index={index + 1} text={item} />
        ))}
      </Section>
    </View>
  );
}

function ReportScreen({
  records,
  weeklyExpense,
  frequentExpense
}: {
  records: DayRecord[];
  weeklyExpense: number;
  frequentExpense: string;
}) {
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKeyFromDate(new Date()));
  const postponed = records.flatMap((record) => record.analysis.todos.filter((todo) => !todo.done)).slice(0, 6);
  const wasteCount = records.flatMap((record) => record.analysis.wasteSignals).length;
  const projectedMonth = projectedMonthExpense(records);
  const calendarDays = useMemo(() => buildMonthDays(calendarMonth), [calendarMonth]);
  const recordsByDate = useMemo(() => {
    const grouped = new Map<string, DayRecord[]>();
    records.forEach((record) => {
      dateKeysForRecord(record).forEach((key) => {
        grouped.set(key, [...(grouped.get(key) ?? []), record]);
      });
    });
    return grouped;
  }, [records]);
  const selectedRecords = recordsByDate.get(selectedDateKey) ?? [];
  const todayDateKey = dateKeyFromDate(new Date());

  function moveMonth(offset: number) {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1));
  }

  return (
    <View style={styles.screen}>
      <View style={styles.metricGrid}>
        <Metric label="주간 지출" value={formatWon(weeklyExpense)} tone="green" icon={ReceiptText} />
        <Metric label="예상 월 지출" value={formatWon(projectedMonth)} tone="coral" icon={TrendingUp} />
      </View>

      <Section title="기록 달력">
        <View style={styles.calendarHeader}>
          <Pressable accessibilityRole="button" onPress={() => moveMonth(-1)} style={styles.calendarNavButton}>
            <ChevronLeft size={20} color={colors.forestDark} />
          </Pressable>
          <View style={styles.calendarTitleWrap}>
            <CalendarDays size={18} color={colors.forestDark} />
            <Text style={styles.calendarMonthText}>{monthLabel(calendarMonth)}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => moveMonth(1)} style={styles.calendarNavButton}>
            <ChevronRight size={20} color={colors.forestDark} />
          </Pressable>
        </View>
        <View style={styles.weekdayRow}>
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
            <Text key={day} style={styles.weekdayText}>
              {day}
            </Text>
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {calendarDays.map((day, index) => {
            const key = day ? dateKeyFromDate(day) : `empty-${index}`;
            const hasRecords = day ? recordsByDate.has(key) : false;
            const selected = key === selectedDateKey;
            const today = key === todayDateKey;

            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                disabled={!day}
                onPress={() => day && setSelectedDateKey(key)}
                style={[
                  styles.calendarCell,
                  !day && styles.calendarCellEmpty,
                  today && styles.calendarCellToday,
                  selected && styles.calendarCellSelected
                ]}
              >
                <Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>
                  {day ? day.getDate() : ""}
                </Text>
                {hasRecords ? <View style={[styles.calendarDot, selected && styles.calendarDotSelected]} /> : null}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.selectedRecordArea}>
          <Text style={styles.selectedRecordTitle}>
            {selectedDateKey.replaceAll("-", ".")} 기록
          </Text>
            {selectedRecords.length ? (
              selectedRecords.map((record) => <RecordHistoryCard key={`${selectedDateKey}-${record.id}`} record={record} dateKey={selectedDateKey} />)
          ) : (
            <EmptyLine text="선택한 날짜에는 아직 기록이 없습니다." />
          )}
        </View>
      </Section>

      <Section title="소비 패턴">
        <InfoRow label="자주 쓰는 항목" value={frequentExpense} />
        <InfoRow label="낭비 가능성 신호" value={`${wasteCount}회`} />
        <InfoRow label="최근 기록 수" value={`${records.length}개`} />
      </Section>

      <Section title="감정 패턴">
        {records.slice(0, 5).map((record) => (
          <InfoRow
            key={record.id}
            label={formatDateLabel(record.createdAt)}
            value={record.analysis.moods[0]?.label ?? "보통"}
          />
        ))}
      </Section>

      <Section title="미룬 일 목록">
        {postponed.length ? postponed.map((todo) => <BulletLine key={todo.id} text={todo.title} />) : <EmptyLine text="미룬 일이 없습니다." />}
      </Section>
    </View>
  );
}

function SettingsScreen({
  settings,
  draftName,
  draftEmail,
  setDraftName,
  setDraftEmail,
  onSaveProfile,
  onUpdateSettings,
  onSelectPlan,
  onLogout,
  recordsCount,
  onResetLocalData,
  onSaveReminder,
  onDisableReminder
}: {
  settings: UserSettings;
  draftName: string;
  draftEmail: string;
  setDraftName: (value: string) => void;
  setDraftEmail: (value: string) => void;
  onSaveProfile: () => void;
  onUpdateSettings: (settings: UserSettings) => void;
  onSelectPlan: (tier: SubscriptionTier) => void;
  onLogout: () => void;
  recordsCount: number;
  onResetLocalData: () => void;
  onSaveReminder: (hour: number, minute: number) => void;
  onDisableReminder: () => void;
}) {
  const [draftHour, setDraftHour] = useState(`${settings.reminderHour}`.padStart(2, "0"));
  const [draftMinute, setDraftMinute] = useState(`${settings.reminderMinute}`.padStart(2, "0"));

  useEffect(() => {
    setDraftHour(`${settings.reminderHour}`.padStart(2, "0"));
    setDraftMinute(`${settings.reminderMinute}`.padStart(2, "0"));
  }, [settings.reminderHour, settings.reminderMinute]);

  const parsedHour = clampTimeValue(draftHour, 23);
  const parsedMinute = clampTimeValue(draftMinute, 59);

  return (
    <View style={styles.screen}>
      <Section title="회원가입">
        <View style={styles.profileRow}>
          <UserRound size={22} color={colors.forestDark} />
          <TextInput value={draftName} onChangeText={setDraftName} placeholder="이름" placeholderTextColor={colors.subtle} style={styles.profileInput} />
        </View>
        <View style={styles.profileRow}>
          <Lock size={22} color={colors.forestDark} />
          <TextInput
            value={draftEmail}
            onChangeText={setDraftEmail}
            placeholder="이메일"
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor={colors.subtle}
            style={styles.profileInput}
          />
        </View>
        <Pressable accessibilityRole="button" onPress={onSaveProfile} style={styles.primaryButton}>
          <Check size={18} color={colors.surface} />
          <Text style={styles.primaryButtonText}>프로필 저장</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onLogout} style={styles.logoutButton}>
          <Lock size={18} color={colors.forestDark} />
          <Text style={styles.logoutButtonText}>로그아웃</Text>
        </Pressable>
      </Section>

      <Section title="구독">
        {(Object.keys(planCopy) as SubscriptionTier[]).map((tier) => {
          const selected = settings.tier === tier;
          return (
            <Pressable
              key={tier}
              accessibilityRole="button"
              onPress={() => onSelectPlan(tier)}
              style={[styles.planRow, selected && styles.planRowSelected]}
            >
              <View style={styles.planIcon}>
                {selected ? <Check size={18} color={colors.surface} /> : <CreditCard size={18} color={colors.forestDark} />}
              </View>
              <View style={styles.planCopy}>
                <Text style={styles.planTitle}>{planCopy[tier].name}</Text>
                <Text style={styles.planDetail}>{planCopy[tier].detail}</Text>
              </View>
              <Text style={styles.planPrice}>{planCopy[tier].price}</Text>
            </Pressable>
          );
        })}
        {settings.paymentStatus === "pending" && settings.pendingTier ? (
          <View style={styles.pendingPaymentBox}>
            <View style={styles.pendingPaymentHeader}>
              <Lock size={18} color={colors.forestDark} />
              <Text style={styles.pendingPaymentTitle}>관리자 승인 대기 중</Text>
            </View>
            <Text style={styles.pendingPaymentText}>
              {planCopy[settings.pendingTier].name} 플랜 입금 신청이 접수되었습니다. 관리자는 서버 관리자 페이지에서 입금을 확인한 뒤 승인합니다.
            </Text>
          </View>
        ) : null}
      </Section>

      <Section title="알림과 개인정보">
        <View style={styles.reminderPanel}>
          <View style={styles.reminderHeader}>
            <View style={styles.infoLabelWrap}>
              <Bell size={18} color={colors.forestDark} />
              <Text style={styles.infoLabel}>요약 알림 시간</Text>
            </View>
            <Text style={styles.reminderStatus}>
              {settings.summaryReminderEnabled ? "켜짐" : "꺼짐"}
            </Text>
          </View>
          <View style={styles.timeEditor}>
            <TextInput
              value={draftHour}
              onChangeText={(value) => setDraftHour(value.replace(/\D/g, "").slice(0, 2))}
              onBlur={() => setDraftHour(`${parsedHour}`.padStart(2, "0"))}
              keyboardType="number-pad"
              maxLength={2}
              selectTextOnFocus
              style={styles.timeInput}
            />
            <Text style={styles.timeSeparator}>:</Text>
            <TextInput
              value={draftMinute}
              onChangeText={(value) => setDraftMinute(value.replace(/\D/g, "").slice(0, 2))}
              onBlur={() => setDraftMinute(`${parsedMinute}`.padStart(2, "0"))}
              keyboardType="number-pad"
              maxLength={2}
              selectTextOnFocus
              style={styles.timeInput}
            />
          </View>
          <View style={styles.reminderActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onSaveReminder(parsedHour, parsedMinute)}
              style={styles.reminderPrimaryButton}
            >
              <Text style={styles.reminderPrimaryText}>알림 저장</Text>
            </Pressable>
            {settings.summaryReminderEnabled ? (
              <Pressable accessibilityRole="button" onPress={onDisableReminder} style={styles.reminderSecondaryButton}>
                <Text style={styles.reminderSecondaryText}>끄기</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.reminderHint}>
            {Platform.OS === "web"
              ? "웹 미리보기에서는 시간이 저장되고, 실제 알림은 iOS/Android 앱에서 동작합니다."
              : `${formatReminderTime(parsedHour, parsedMinute)}에 하루 요약 알림을 보냅니다.`}
          </Text>
        </View>
        <View style={styles.switchRow}>
          <View>
            <Text style={styles.switchTitle}>개인정보 보호 모드</Text>
            <Text style={styles.switchDetail}>민감한 기록은 기기에 우선 저장</Text>
          </View>
          <Switch
            value={settings.privacyMode}
            onValueChange={(privacyMode) => onUpdateSettings({ ...settings, privacyMode })}
            trackColor={{ false: colors.line, true: colors.mint }}
            thumbColor={settings.privacyMode ? colors.forest : colors.subtle}
          />
        </View>
      </Section>

      <Section title="로컬 저장">
        <InfoRow label="이 기기에 저장된 기록" value={`${recordsCount}개`} icon={ClipboardList} />
        <InfoRow label="저장 방식" value="기기별 로컬 저장" icon={ShieldCheck} />
        <Pressable accessibilityRole="button" onPress={onResetLocalData} style={styles.dangerRow}>
          <View style={styles.infoLabelWrap}>
            <RotateCcw size={18} color={colors.coral} />
            <Text style={styles.dangerLabel}>로컬 데이터 초기화</Text>
          </View>
          <ChevronRight size={18} color={colors.subtle} />
        </Pressable>
      </Section>

      <Section title="앱 정보">
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(releaseLinks.privacy)} style={styles.linkRow}>
          <View style={styles.infoLabelWrap}>
            <ShieldCheck size={18} color={colors.forestDark} />
            <Text style={styles.infoLabel}>개인정보 처리방침</Text>
          </View>
          <ChevronRight size={18} color={colors.subtle} />
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(releaseLinks.terms)} style={styles.linkRow}>
          <View style={styles.infoLabelWrap}>
            <FileText size={18} color={colors.forestDark} />
            <Text style={styles.infoLabel}>이용약관</Text>
          </View>
          <ChevronRight size={18} color={colors.subtle} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            Alert.alert(
              "AI 분석 안내",
              "AI 정리는 입력 내용을 바탕으로 한 참고 정보입니다. 재정, 의료, 법률, 심리 상담 등 전문적 판단을 대체하지 않습니다."
            )
          }
          style={styles.linkRow}
        >
          <View style={styles.infoLabelWrap}>
            <Sparkles size={18} color={colors.forestDark} />
            <Text style={styles.infoLabel}>AI 분석 안내</Text>
          </View>
          <ChevronRight size={18} color={colors.subtle} />
        </Pressable>
        <InfoRow label="버전" value={appVersion} />
      </Section>
    </View>
  );
}

function TabBar({ activeTab, onChange }: { activeTab: TabKey; onChange: (tab: TabKey) => void }) {
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            onPress={() => onChange(tab.key)}
            style={[styles.tabItem, active && styles.tabItemActive]}
          >
            <Icon size={21} color={active ? colors.surface : colors.subtle} />
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Section({
  title,
  action,
  onAction,
  children
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action ? (
          <Pressable accessibilityRole="button" onPress={onAction} style={styles.textAction}>
            <Text style={styles.textActionLabel}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Metric({
  label,
  value,
  tone,
  icon: Icon
}: {
  label: string;
  value: string;
  tone: "green" | "blue" | "coral" | "purple";
  icon: AppIcon;
}) {
  const toneMap = {
    green: colors.tealSoft,
    blue: colors.blueSoft,
    coral: colors.blush,
    purple: colors.purpleSoft
  };
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: toneMap[tone] }]}>
        <Icon size={18} color={colors.forestDark} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={2} adjustsFontSizeToFit style={styles.metricValue}>
        {value}
      </Text>
    </View>
  );
}

function TodoRow({ todo, onToggle }: { todo: Todo; onToggle: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: todo.done }} onPress={onToggle} style={styles.todoRow}>
      <View style={[styles.checkbox, todo.done && styles.checkboxDone]}>{todo.done ? <Check size={14} color={colors.surface} /> : null}</View>
      <Text style={[styles.todoText, todo.done && styles.todoTextDone]}>{todo.title}</Text>
    </Pressable>
  );
}

function InfoRow({
  label,
  value,
  strong,
  icon: Icon
}: {
  label: string;
  value: string;
  strong?: boolean;
  icon?: AppIcon;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabelWrap}>
        {Icon ? <Icon size={18} color={colors.forestDark} /> : null}
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={[styles.infoValue, strong && styles.infoValueStrong]}>{value}</Text>
    </View>
  );
}

function RecordHistoryCard({ record, dateKey }: { record: DayRecord; dateKey?: string }) {
  const expenses = dateKey
    ? record.analysis.expenses.filter((expense) => expenseDateKey(expense, record) === dateKey)
    : record.analysis.expenses;
  const todos = dateKey ? record.analysis.todos.filter((todo) => todoDateKey(todo, record) === dateKey) : record.analysis.todos;
  const moods = dateKey ? record.analysis.moods.filter((mood) => moodDateKey(mood, record) === dateKey) : record.analysis.moods;
  const expenseTotal = sum(expenses.map((expense) => expense.amount));

  return (
    <View style={styles.recordHistoryCard}>
      <View style={styles.recordHistoryMeta}>
        <Text style={styles.recordHistoryTime}>{shortTime(record.createdAt)}</Text>
          <Text style={styles.recordHistoryMood}>{moods[0]?.label ?? "보통"}</Text>
      </View>
      <Text style={styles.recordHistorySummary}>{record.analysis.summary}</Text>
      <Text numberOfLines={3} style={styles.recordHistoryRaw}>
        {record.rawText}
      </Text>
      <View style={styles.recordHistoryStats}>
        <View style={styles.recordHistoryPill}>
          <ReceiptText size={14} color={colors.forestDark} />
          <Text style={styles.recordHistoryPillText}>{formatWon(expenseTotal)}</Text>
        </View>
        <View style={styles.recordHistoryPill}>
          <ClipboardList size={14} color={colors.forestDark} />
            <Text style={styles.recordHistoryPillText}>{todos.length}개 할 일</Text>
        </View>
      </View>
    </View>
  );
}

function BulletLine({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bullet} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function NumberedLine({ index, text }: { index: number; text: string }) {
  return (
    <View style={styles.numberRow}>
      <View style={styles.numberBubble}>
        <Text style={styles.numberText}>{index}</Text>
      </View>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <Text style={styles.emptyLine}>{text}</Text>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyState}>
      <ClipboardList size={36} color={colors.forestDark} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.page
  },
  keyboard: {
    flex: 1
  },
  app: {
    flex: 1,
    backgroundColor: colors.page
  },
  authContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    justifyContent: "center"
  },
  authScreen: {
    gap: spacing.md
  },
  authBrandMark: {
    width: 58,
    height: 58,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.forestDark
  },
  authTitle: {
    color: colors.ink,
    fontSize: 34,
    lineHeight: 40,
    fontFamily: font.extraBold,
    fontWeight: "900",
    letterSpacing: 0
  },
  authSubtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: font.semibold,
    fontWeight: "700"
  },
  authCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line
  },
  demoNoticeCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#F59E0B"
  },
  demoNoticeTitle: {
    color: "#92400E",
    fontSize: 15,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  demoNoticeText: {
    color: "#78350F",
    fontSize: 13,
    fontFamily: font.regular,
    lineHeight: 18
  },
  demoNoticeCode: {
    color: "#7C2D12",
    fontSize: 32,
    fontFamily: font.extraBold,
    fontWeight: "900",
    letterSpacing: 6,
    textAlign: "center",
    paddingVertical: spacing.sm
  },
  authCardTitle: {
    color: colors.ink,
    fontSize: 19,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  authModeRow: {
    minHeight: 44,
    padding: 4,
    borderRadius: 8,
    backgroundColor: colors.elevated,
    flexDirection: "row",
    gap: 4
  },
  authModeButton: {
    flex: 1,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center"
  },
  authModeButtonActive: {
    backgroundColor: colors.forest
  },
  authModeText: {
    color: colors.muted,
    fontSize: 14,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  authModeTextActive: {
    color: colors.surface
  },
  authNotice: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealLine,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  authNoticeText: {
    flex: 1,
    color: colors.forestDark,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  authErrorBox: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#F87171"
  },
  authErrorText: {
    color: "#991B1B",
    fontSize: 13,
    lineHeight: 18,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  linkButton: {
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md
  },
  linkButtonText: {
    color: colors.forestDark,
    fontSize: 13,
    fontFamily: font.semibold,
    fontWeight: "700",
    textDecorationLine: "underline"
  },
  authInputRow: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.elevated,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  authInput: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    fontFamily: font.bold,
    fontWeight: "700"
  },
  authRuleText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: font.semibold,
    fontWeight: "700"
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.page
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.muted,
    fontSize: 15,
    fontFamily: font.semibold,
    fontWeight: "600"
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  brandCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.forestDark
  },
  appName: {
    color: colors.ink,
    fontSize: 24,
    fontFamily: font.extraBold,
    fontWeight: "900",
    letterSpacing: 0
  },
  headerSub: {
    color: colors.muted,
    marginTop: 2,
    fontSize: 13,
    fontFamily: font.semibold,
    fontWeight: "600"
  },
  planBadge: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.tealLine
  },
  planBadgeText: {
    color: colors.forestDark,
    fontSize: 12,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl
  },
  screen: {
    gap: spacing.xl
  },
  todayPanel: {
    minHeight: 360,
    borderRadius: 8,
    padding: spacing.lg,
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)"
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0
  },
  todayPanelTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  homeHeroHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md
  },
  homeStatusPill: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)"
  },
  homeStatusText: {
    color: colors.surface,
    fontSize: 13,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  dateText: {
    color: colors.tealLine,
    fontSize: 13,
    fontFamily: font.bold,
    fontWeight: "800",
    marginBottom: 0
  },
  todayEyebrow: {
    color: colors.tealLine,
    fontSize: 11,
    fontFamily: font.extraBold,
    fontWeight: "900",
    letterSpacing: 0,
    marginTop: spacing.md
  },
  todayTitle: {
    color: colors.surface,
    fontSize: 22,
    lineHeight: 29,
    fontFamily: font.extraBold,
    fontWeight: "900",
    letterSpacing: 0,
    flexShrink: 1
  },
  todayCopyBlock: {
    gap: spacing.xs,
    marginTop: spacing.md
  },
  todayDetail: {
    color: colors.tealLine,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  homeNextBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    gap: 4,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)"
  },
  homeNextLabel: {
    color: colors.tealLine,
    fontSize: 11,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  homeNextText: {
    color: colors.surface,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  homeHeroActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md
  },
  homePrimaryAction: {
    minHeight: 50,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.surface,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs
  },
  homePrimaryActionText: {
    color: colors.forestDark,
    fontSize: 15,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  homeSecondaryAction: {
    minHeight: 50,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)"
  },
  homeSecondaryActionText: {
    color: colors.surface,
    fontSize: 14,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  heroChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md
  },
  heroChip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)"
  },
  heroChipText: {
    color: colors.surface,
    fontSize: 13,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    marginLeft: "auto"
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.sm
  },
  metricCard: {
    width: "48.5%",
    height: 120,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  metricValue: {
    color: colors.ink,
    fontSize: 21,
    lineHeight: 25,
    fontFamily: font.extraBold,
    fontWeight: "900",
    letterSpacing: 0,
    marginTop: 3
  },
  section: {
    gap: spacing.sm
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 19,
    fontFamily: font.extraBold,
    fontWeight: "900",
    letterSpacing: 0
  },
  textAction: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center"
  },
  textActionLabel: {
    color: colors.forest,
    fontSize: 13,
    fontFamily: font.bold,
    fontWeight: "900"
  },
  sectionBody: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden"
  },
  todoRow: {
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center"
  },
  checkboxDone: {
    borderColor: colors.forest,
    backgroundColor: colors.forest
  },
  todoText: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: font.bold,
    fontWeight: "700"
  },
  todoTextDone: {
    color: colors.subtle,
    textDecorationLine: "line-through"
  },
  input: {
    minHeight: 210,
    padding: spacing.lg,
    color: colors.ink,
    fontSize: 16,
    lineHeight: 24,
    fontFamily: font.semibold,
    fontWeight: "600"
  },
  recordActions: {
    flexDirection: "row",
    padding: spacing.lg,
    gap: spacing.sm
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    backgroundColor: colors.forest,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    flex: 1
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }]
  },
  buttonDisabled: {
    opacity: 0.52
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  secondaryButton: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs
  },
  secondaryButtonText: {
    color: colors.forestDark,
    fontSize: 15,
    fontFamily: font.bold,
    fontWeight: "900"
  },
  limitText: {
    color: colors.muted,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    fontSize: 13,
    fontFamily: font.semibold,
    fontWeight: "700"
  },
  sampleRow: {
    minHeight: 60,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  sampleText: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: font.semibold,
    fontWeight: "700"
  },
  summaryCard: {
    padding: spacing.xl,
    gap: spacing.md
  },
  summaryText: {
    color: colors.ink,
    fontSize: 17,
    lineHeight: 26,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  timestamp: {
    color: colors.subtle,
    fontSize: 12,
    fontFamily: font.semibold,
    fontWeight: "700"
  },
  infoRow: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  linkRow: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  reminderPanel: {
    padding: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  reminderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  reminderStatus: {
    color: colors.forestDark,
    fontSize: 13,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  timeEditor: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm
  },
  timeInput: {
    width: 74,
    height: 54,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.elevated,
    color: colors.ink,
    fontSize: 25,
    fontFamily: font.extraBold,
    fontWeight: "900",
    textAlign: "center"
  },
  timeSeparator: {
    color: colors.muted,
    fontSize: 24,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  reminderActions: {
    flexDirection: "row",
    gap: spacing.sm
  },
  reminderPrimaryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    backgroundColor: colors.forest,
    alignItems: "center",
    justifyContent: "center",
    flex: 1
  },
  reminderPrimaryText: {
    color: colors.surface,
    fontSize: 14,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  reminderSecondaryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center"
  },
  reminderSecondaryText: {
    color: colors.forestDark,
    fontSize: 14,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  reminderHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: font.semibold,
    fontWeight: "600"
  },
  pendingPaymentBox: {
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.tealSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.tealLine
  },
  pendingPaymentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  pendingPaymentTitle: {
    color: colors.forestDark,
    fontSize: 15,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  pendingPaymentText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: font.semibold,
    fontWeight: "700"
  },
  adminCodeInput: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.tealLine,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 14,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  secondaryWideButton: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.tealLine
  },
  dangerRow: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  infoLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 1
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 14,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  dangerLabel: {
    color: colors.coral,
    fontSize: 14,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  infoValue: {
    color: colors.ink,
    fontSize: 15,
    fontFamily: font.extraBold,
    fontWeight: "900",
    textAlign: "right",
    flexShrink: 0
  },
  infoValueStrong: {
    color: colors.forestDark,
    fontSize: 17
  },
  calendarHeader: {
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  calendarNavButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tealSoft
  },
  calendarTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs
  },
  calendarMonthText: {
    color: colors.ink,
    fontSize: 16,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  weekdayRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    flexDirection: "row"
  },
  weekdayText: {
    flex: 1,
    color: colors.subtle,
    fontSize: 11,
    fontFamily: font.bold,
    fontWeight: "800",
    textAlign: "center"
  },
  calendarGrid: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap"
  },
  calendarCell: {
    width: "14.2857%",
    aspectRatio: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.line
  },
  calendarCellEmpty: {
    opacity: 0,
    borderWidth: 0
  },
  calendarCellToday: {
    borderColor: colors.tealLine,
    backgroundColor: colors.tealSoft
  },
  calendarCellSelected: {
    backgroundColor: colors.forest,
    borderColor: colors.forest
  },
  calendarDayText: {
    color: colors.ink,
    fontSize: 13,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  calendarDayTextSelected: {
    color: colors.surface
  },
  calendarDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 3,
    backgroundColor: colors.forest
  },
  calendarDotSelected: {
    backgroundColor: colors.surface
  },
  selectedRecordArea: {
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line
  },
  selectedRecordTitle: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: font.bold,
    fontWeight: "800",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm
  },
  recordHistoryCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: spacing.sm
  },
  recordHistoryMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  recordHistoryTime: {
    color: colors.forestDark,
    fontSize: 12,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  recordHistoryMood: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  recordHistorySummary: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  recordHistoryRaw: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: font.semibold,
    fontWeight: "600"
  },
  recordHistoryStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  recordHistoryPill: {
    minHeight: 30,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.tealSoft
  },
  recordHistoryPillText: {
    color: colors.forestDark,
    fontSize: 12,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  divider: {
    height: 1,
    backgroundColor: colors.line
  },
  moodRow: {
    padding: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  moodLabel: {
    color: colors.ink,
    fontSize: 16,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  moodDetail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
    fontFamily: font.regular,
    fontWeight: "600"
  },
  moodScore: {
    color: colors.forestDark,
    fontSize: 23,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  bulletRow: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  bullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.forest
  },
  bulletText: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: font.bold,
    fontWeight: "700"
  },
  numberRow: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  numberBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.forest
  },
  numberText: {
    color: colors.surface,
    fontSize: 13,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  emptyLine: {
    color: colors.muted,
    padding: spacing.md,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: font.semibold,
    fontWeight: "600"
  },
  emptyState: {
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontFamily: font.extraBold,
    fontWeight: "900",
    marginTop: spacing.md
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: font.semibold,
    fontWeight: "600",
    textAlign: "center",
    marginTop: spacing.xs
  },
  profileRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  profileInput: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    fontFamily: font.bold,
    fontWeight: "700"
  },
  logoutButton: {
    minHeight: 48,
    margin: spacing.md,
    marginTop: 0,
    borderRadius: 8,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs
  },
  logoutButtonText: {
    color: colors.forestDark,
    fontSize: 14,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  planRow: {
    minHeight: 82,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  planRowSelected: {
    backgroundColor: colors.tealSoft
  },
  planIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.forest
  },
  planCopy: {
    flex: 1
  },
  planTitle: {
    color: colors.ink,
    fontSize: 15,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  planDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
    fontFamily: font.semibold,
    fontWeight: "600"
  },
  planPrice: {
    color: colors.forestDark,
    fontSize: 13,
    fontFamily: font.extraBold,
    fontWeight: "900",
    textAlign: "right"
  },
  checkoutHero: {
    padding: spacing.lg,
    gap: spacing.xs,
    alignItems: "flex-start",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line
  },
  checkoutIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.forest
  },
  checkoutTitle: {
    color: colors.ink,
    fontSize: 21,
    fontFamily: font.extraBold,
    fontWeight: "900",
    marginTop: spacing.sm
  },
  checkoutPrice: {
    color: colors.forestDark,
    fontSize: 18,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  checkoutCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: font.semibold,
    fontWeight: "700",
    marginTop: spacing.xs
  },
  checkoutForm: {
    padding: spacing.lg,
    gap: spacing.sm
  },
  checkoutLabel: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  checkoutInput: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.elevated,
    color: colors.ink,
    fontSize: 15,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  checkoutActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs
  },
  switchRow: {
    minHeight: 72,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  switchTitle: {
    color: colors.ink,
    fontSize: 15,
    fontFamily: font.extraBold,
    fontWeight: "900"
  },
  switchDetail: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
    fontFamily: font.semibold,
    fontWeight: "600"
  },
  tabBar: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    minHeight: 70,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    elevation: 5
  },
  tabItem: {
    minWidth: 56,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: 8
  },
  tabItemActive: {
    backgroundColor: colors.forest
  },
  tabText: {
    color: colors.subtle,
    fontSize: 11,
    fontFamily: font.bold,
    fontWeight: "800"
  },
  tabTextActive: {
    color: colors.surface
  }
});
