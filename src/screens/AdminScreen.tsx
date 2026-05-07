import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { ShieldCheck, RefreshCw, Users, TrendingUp, LogIn, UserCheck } from "lucide-react-native";
import { fetchAdminStats, fetchAdminUsers, type AdminStats, type AdminUser } from "../services/adminApi";

type Screen = "login" | "dashboard";

export function AdminScreen() {
  const [screen, setScreen] = useState<Screen>("login");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  async function login() {
    if (!secret.trim()) { setError("비밀번호를 입력해 주세요."); return; }
    setLoading(true);
    setError("");
    try {
      const [s, u] = await Promise.all([
        fetchAdminStats(secret.trim()),
        fetchAdminUsers(secret.trim())
      ]);
      setStats(s);
      setUsers(u.users);
      setScreen("dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로그인 실패");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [s, u] = await Promise.all([
        fetchAdminStats(secret),
        fetchAdminUsers(secret)
      ]);
      setStats(s);
      setUsers(u.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "새로고침 실패");
    } finally {
      setLoading(false);
    }
  }

  if (screen === "login") {
    return (
      <View style={s.center}>
        <View style={s.loginCard}>
          <View style={s.brandIcon}>
            <ShieldCheck size={28} color="#FFFFFF" />
          </View>
          <Text style={s.loginTitle}>관리자 패널</Text>
          <Text style={s.loginSub}>ADMIN_SECRET을 입력해 주세요</Text>
          <TextInput
            value={secret}
            onChangeText={(v) => { setSecret(v); setError(""); }}
            placeholder="관리자 비밀번호"
            placeholderTextColor="#98A2AD"
            secureTextEntry
            style={s.input}
            onSubmitEditing={login}
          />
          {error ? <Text style={s.errorText}>{error}</Text> : null}
          <Pressable
            onPress={login}
            disabled={loading}
            style={({ pressed }) => [s.loginBtn, pressed && s.pressed, loading && s.disabled]}
          >
            {loading
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={s.loginBtnText}>로그인</Text>
            }
          </Pressable>
        </View>
      </View>
    );
  }

  const maxSignups = Math.max(...(stats?.chart.map((r) => r.signups) ?? [1]), 1);
  const maxLogins = Math.max(...(stats?.chart.map((r) => r.logins) ?? [1]), 1);

  return (
    <ScrollView style={s.page} contentContainerStyle={s.pageContent}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <ShieldCheck size={20} color="#0EA5A4" />
          <Text style={s.headerTitle}>관리자 패널</Text>
        </View>
        <Pressable onPress={refresh} disabled={loading} style={({ pressed }) => [s.refreshBtn, pressed && s.pressed]}>
          {loading
            ? <ActivityIndicator size="small" color="#0EA5A4" />
            : <RefreshCw size={18} color="#0EA5A4" />
          }
          <Text style={s.refreshText}>새로고침</Text>
        </Pressable>
      </View>

      {error ? <Text style={s.errorBanner}>{error}</Text> : null}

      {/* 요약 카드 */}
      <View style={s.statsRow}>
        <StatCard icon={<Users size={20} color="#0EA5A4" />} label="전체 회원" value={stats?.totalUsers ?? 0} />
        <StatCard icon={<TrendingUp size={20} color="#F5B84B" />} label="오늘 가입" value={stats?.todaySignups ?? 0} />
        <StatCard icon={<UserCheck size={20} color="#4F8BFF" />} label="주간 가입" value={stats?.weekSignups ?? 0} />
        <StatCard icon={<LogIn size={20} color="#7C6FE8" />} label="주간 로그인" value={stats?.weekLogins ?? 0} />
      </View>

      {/* 7일 가입 추이 */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>최근 7일 가입 / 로그인</Text>
        <View style={s.chart}>
          {stats?.chart.map((row) => {
            const signupH = Math.max(4, Math.round((row.signups / maxSignups) * 80));
            const loginH = Math.max(4, Math.round((row.logins / maxLogins) * 80));
            const dateLabel = row.date.slice(5);
            return (
              <View key={row.date} style={s.chartCol}>
                <Text style={s.chartVal}>{row.signups}</Text>
                <View style={s.bars}>
                  <View style={[s.bar, s.barSignup, { height: signupH }]} />
                  <View style={[s.bar, s.barLogin, { height: loginH }]} />
                </View>
                <Text style={s.chartLabel}>{dateLabel}</Text>
              </View>
            );
          })}
        </View>
        <View style={s.legend}>
          <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: "#0EA5A4" }]} /><Text style={s.legendText}>가입</Text></View>
          <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: "#7C6FE8" }]} /><Text style={s.legendText}>로그인</Text></View>
        </View>
      </View>

      {/* 최근 가입자 */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>최근 가입자 (최대 30명)</Text>
        <View style={s.tableHead}>
          <Text style={[s.tableCell, s.cellEmail]}>이메일</Text>
          <Text style={[s.tableCell, s.cellName]}>이름</Text>
          <Text style={[s.tableCell, s.cellStatus]}>인증</Text>
          <Text style={[s.tableCell, s.cellTier]}>플랜</Text>
        </View>
        {users.length === 0
          ? <Text style={s.emptyText}>가입자가 없습니다.</Text>
          : users.map((u, i) => (
            <View key={i} style={[s.tableRow, i % 2 === 0 && s.tableRowEven]}>
              <Text style={[s.tableCell, s.cellEmail]} numberOfLines={1}>{u.email}</Text>
              <Text style={[s.tableCell, s.cellName]} numberOfLines={1}>{u.name || "—"}</Text>
              <View style={[s.tableCell, s.cellStatus]}>
                <View style={[s.badge, u.emailVerified ? s.badgeGreen : s.badgeGray]}>
                  <Text style={[s.badgeText, u.emailVerified ? s.badgeTextGreen : s.badgeTextGray]}>
                    {u.emailVerified ? "완료" : "미인증"}
                  </Text>
                </View>
              </View>
              <View style={[s.tableCell, s.cellTier]}>
                <View style={[s.badge, u.tier === "pro" ? s.badgeBlue : s.badgeGray]}>
                  <Text style={[s.badgeText, u.tier === "pro" ? s.badgeTextBlue : s.badgeTextGray]}>
                    {u.tier === "pro" ? "PRO" : "무료"}
                  </Text>
                </View>
              </View>
            </View>
          ))
        }
      </View>
    </ScrollView>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <View style={s.statCard}>
      {icon}
      <Text style={s.statValue}>{value.toLocaleString()}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F5F8FA" },
  loginCard: { width: "100%", maxWidth: 360, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 28, alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  brandIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: "#0EA5A4", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  loginTitle: { fontSize: 20, fontWeight: "700", color: "#111827", marginBottom: 4 },
  loginSub: { fontSize: 13, color: "#64707D", marginBottom: 20, textAlign: "center" },
  input: { width: "100%", height: 44, borderWidth: 1, borderColor: "#E4EAF0", borderRadius: 10, paddingHorizontal: 14, fontSize: 15, color: "#111827", backgroundColor: "#F5F8FA", marginBottom: 8 },
  errorText: { fontSize: 13, color: "#EF4444", marginBottom: 8 },
  loginBtn: { width: "100%", height: 44, backgroundColor: "#0EA5A4", borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 4 },
  loginBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
  page: { flex: 1, backgroundColor: "#F5F8FA" },
  pageContent: { padding: 20, paddingBottom: 40, maxWidth: 900, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#111827" },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#E6FAF7", borderRadius: 8 },
  refreshText: { fontSize: 13, color: "#0EA5A4", fontWeight: "600" },
  errorBanner: { backgroundColor: "#FEF2F2", color: "#EF4444", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 },
  statCard: { flex: 1, minWidth: 130, backgroundColor: "#FFFFFF", borderRadius: 12, padding: 16, alignItems: "center", gap: 6, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  statValue: { fontSize: 28, fontWeight: "800", color: "#111827" },
  statLabel: { fontSize: 12, color: "#64707D", textAlign: "center" },
  section: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 16, marginBottom: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: "#111827", marginBottom: 16 },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 110, marginBottom: 8 },
  chartCol: { flex: 1, alignItems: "center", gap: 4 },
  chartVal: { fontSize: 11, color: "#64707D" },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  bar: { width: 10, borderRadius: 3 },
  barSignup: { backgroundColor: "#0EA5A4" },
  barLogin: { backgroundColor: "#7C6FE8" },
  chartLabel: { fontSize: 10, color: "#98A2AD" },
  legend: { flexDirection: "row", gap: 16, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: "#64707D" },
  tableHead: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E4EAF0", marginBottom: 4 },
  tableRow: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  tableRowEven: { backgroundColor: "#F9FAFB" },
  tableCell: { fontSize: 13, color: "#374151", justifyContent: "center" },
  cellEmail: { flex: 3, fontFamily: "monospace" },
  cellName: { flex: 2 },
  cellStatus: { flex: 1.2, alignItems: "flex-start" },
  cellTier: { flex: 1, alignItems: "flex-start" },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeGreen: { backgroundColor: "#DCFCE7" },
  badgeGray: { backgroundColor: "#F3F4F6" },
  badgeBlue: { backgroundColor: "#EEF2FF" },
  badgeText: { fontSize: 11, fontWeight: "600" },
  badgeTextGreen: { color: "#16A34A" },
  badgeTextGray: { color: "#6B7280" },
  badgeTextBlue: { color: "#4F46E5" },
  emptyText: { fontSize: 14, color: "#98A2AD", textAlign: "center", paddingVertical: 20 }
});
