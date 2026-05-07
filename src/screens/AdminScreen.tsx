import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { ShieldCheck, RefreshCw, Users, TrendingUp, LogIn, UserCheck, CreditCard, Search, X, Trash2, Lock, Unlock, Check, AlertTriangle } from "lucide-react-native";
import {
  fetchAdminStats, fetchAdminUsers, fetchAdminUpdateUser, fetchAdminDeleteUser,
  fetchAdminPayments, fetchAdminApprovePayment, fetchAdminRejectPayment,
  type AdminStats, type AdminUser, type PendingPayment
} from "../services/adminApi";

type Tab = "dashboard" | "users" | "payments";

// ─── Root ─────────────────────────────────────────────────────────────────────

export function AdminScreen() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [payments, setPayments] = useState<PendingPayment[]>([]);

  async function loadAll(s = secret) {
    setLoading(true);
    setError("");
    try {
      const [st, us, pm] = await Promise.all([
        fetchAdminStats(s),
        fetchAdminUsers(s),
        fetchAdminPayments(s)
      ]);
      setStats(st);
      setUsers(us.users);
      setPayments(pm.payments);
      setAuthed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류 발생");
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  }

  if (!authed) {
    return (
      <View style={s.center}>
        <View style={s.loginCard}>
          <View style={s.brandIcon}><ShieldCheck size={28} color="#fff" /></View>
          <Text style={s.loginTitle}>관리자 패널</Text>
          <Text style={s.loginSub}>ADMIN_SECRET을 입력해 주세요</Text>
          <TextInput
            value={secret} onChangeText={(v) => { setSecret(v); setError(""); }}
            placeholder="관리자 비밀번호" placeholderTextColor="#98A2AD"
            secureTextEntry style={s.loginInput} onSubmitEditing={() => loadAll()}
          />
          {error ? <Text style={s.errText}>{error}</Text> : null}
          <Pressable onPress={() => loadAll()} disabled={loading}
            style={({ pressed }) => [s.loginBtn, pressed && s.pressed, loading && s.dimmed]}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.loginBtnTxt}>로그인</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  const pendingCount = payments.length;

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F8FA" }}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <ShieldCheck size={18} color="#0EA5A4" />
          <Text style={s.headerTitle}>관리자 패널</Text>
        </View>
        <Pressable onPress={() => loadAll()} disabled={loading}
          style={({ pressed }) => [s.refreshBtn, pressed && s.pressed]}>
          {loading ? <ActivityIndicator size="small" color="#0EA5A4" /> : <RefreshCw size={16} color="#0EA5A4" />}
          <Text style={s.refreshTxt}>새로고침</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {([["dashboard", "대시보드"], ["users", "회원 관리"], ["payments", `결제 승인${pendingCount > 0 ? ` (${pendingCount})` : ""}`]] as [Tab, string][]).map(([key, label]) => (
          <Pressable key={key} onPress={() => setTab(key)}
            style={[s.tabBtn, tab === key && s.tabBtnActive]}>
            <Text style={[s.tabTxt, tab === key && s.tabTxtActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      {tab === "dashboard" && <DashboardTab stats={stats} />}
      {tab === "users" && (
        <UsersTab users={users} secret={secret}
          onRefresh={() => loadAll()}
          onUpdate={(updated) => setUsers((prev) => prev.map((u) => u.email === updated.email ? { ...u, ...updated } : u))}
          onDelete={(email) => setUsers((prev) => prev.filter((u) => u.email !== email))}
        />
      )}
      {tab === "payments" && (
        <PaymentsTab payments={payments} secret={secret}
          onApprove={(email) => {
            setPayments((p) => p.filter((x) => x.email !== email));
            setUsers((prev) => prev.map((u) => u.email === email ? { ...u, tier: "pro", paymentStatus: "approved", pendingTier: null } : u));
          }}
          onReject={(email) => {
            setPayments((p) => p.filter((x) => x.email !== email));
            setUsers((prev) => prev.map((u) => u.email === email ? { ...u, paymentStatus: "none", pendingTier: null } : u));
          }}
        />
      )}
    </View>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab({ stats }: { stats: AdminStats | null }) {
  const maxSig = Math.max(...(stats?.chart.map((r) => r.signups) ?? [0]), 1);
  const maxLog = Math.max(...(stats?.chart.map((r) => r.logins) ?? [0]), 1);

  return (
    <ScrollView contentContainerStyle={s.tabContent}>
      <View style={s.cardRow}>
        <StatCard label="전체 회원" value={stats?.totalUsers ?? 0} color="#E6FAF7" icon={<Users size={18} color="#0EA5A4" />} />
        <StatCard label="인증 완료" value={stats?.verifiedUsers ?? 0} color="#DCFCE7" icon={<UserCheck size={18} color="#16A34A" />} />
        <StatCard label="결제 대기" value={stats?.pendingPayments ?? 0} color="#FFF4D7" icon={<CreditCard size={18} color="#D97706" />} />
        <StatCard label="오늘 가입" value={stats?.todaySignups ?? 0} color="#E8F0FF" icon={<TrendingUp size={18} color="#4F8BFF" />} />
        <StatCard label="주간 가입" value={stats?.weekSignups ?? 0} color="#EEECFF" icon={<TrendingUp size={18} color="#7C6FE8" />} />
        <StatCard label="주간 로그인" value={stats?.weekLogins ?? 0} color="#FEF2F2" icon={<LogIn size={18} color="#EF4444" />} />
      </View>

      <View style={s.section}>
        <Text style={s.secTitle}>최근 7일 가입 / 로그인</Text>
        <View style={s.chart}>
          {stats?.chart.map((row) => (
            <View key={row.date} style={s.chartCol}>
              <Text style={s.chartVal}>{row.signups}</Text>
              <View style={s.bars}>
                <View style={[s.bar, s.barG, { height: Math.max(3, Math.round((row.signups / maxSig) * 80)) }]} />
                <View style={[s.bar, s.barP, { height: Math.max(3, Math.round((row.logins / maxLog) * 80)) }]} />
              </View>
              <Text style={s.chartLbl}>{row.date.slice(5)}</Text>
            </View>
          ))}
        </View>
        <View style={s.legend}>
          <View style={s.legendItem}><View style={[s.dot, { backgroundColor: "#0EA5A4" }]} /><Text style={s.legendTxt}>가입</Text></View>
          <View style={s.legendItem}><View style={[s.dot, { backgroundColor: "#7C6FE8" }]} /><Text style={s.legendTxt}>로그인</Text></View>
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab({ users, secret, onRefresh, onUpdate, onDelete }: {
  users: AdminUser[]; secret: string;
  onRefresh: () => void;
  onUpdate: (u: AdminUser) => void;
  onDelete: (email: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);

  const filtered = query.trim()
    ? users.filter((u) => u.email.includes(query.toLowerCase()) || u.name.includes(query))
    : users;

  return (
    <>
      <View style={s.searchRow}>
        <Search size={16} color="#98A2AD" />
        <TextInput value={query} onChangeText={setQuery} placeholder="이메일 또는 이름 검색"
          placeholderTextColor="#98A2AD" style={s.searchInput} />
        {query ? <Pressable onPress={() => setQuery("")}><X size={16} color="#98A2AD" /></Pressable> : null}
      </View>

      <ScrollView contentContainerStyle={s.tabContent}>
        <View style={s.section}>
          <View style={s.thead}>
            <Text style={[s.th, s.cEmail]}>이메일</Text>
            <Text style={[s.th, s.cName]}>이름</Text>
            <Text style={[s.th, s.cBadge]}>인증</Text>
            <Text style={[s.th, s.cBadge]}>플랜</Text>
            <Text style={[s.th, s.cDate]}>가입일</Text>
            <Text style={[s.th, s.cAct]}>관리</Text>
          </View>
          {filtered.length === 0
            ? <Text style={s.empty}>회원이 없습니다.</Text>
            : filtered.map((u, i) => (
              <View key={u.email} style={[s.trow, i % 2 === 1 && s.trowAlt]}>
                <View style={s.cEmail}>
                  <Text style={s.tdEmail} numberOfLines={1}>{u.emailMasked}</Text>
                  {u.isLocked && <View style={s.lockBadge}><Lock size={10} color="#EF4444" /><Text style={s.lockTxt}>잠김</Text></View>}
                </View>
                <Text style={[s.td, s.cName]} numberOfLines={1}>{u.name || "—"}</Text>
                <View style={s.cBadge}><Badge label={u.emailVerified ? "완료" : "미인증"} v={u.emailVerified ? "green" : "gray"} /></View>
                <View style={s.cBadge}><Badge label={u.tier === "pro" ? "PRO" : "무료"} v={u.tier === "pro" ? "blue" : "gray"} /></View>
                <Text style={[s.td, s.cDate]}>{u.createdAt?.slice(0, 10) ?? "—"}</Text>
                <View style={[s.cAct, { flexDirection: "row", gap: 4 }]}>
                  <Pressable onPress={() => setSelected(u)} style={({ pressed }) => [s.actBtn, pressed && s.pressed]}>
                    <Text style={s.actBtnTxt}>수정</Text>
                  </Pressable>
                </View>
              </View>
            ))
          }
        </View>
        <Text style={s.footNote}>전체 {users.length}명 · 검색 결과 {filtered.length}명</Text>
      </ScrollView>

      {selected && (
        <UserEditModal
          user={selected} secret={secret}
          onClose={() => setSelected(null)}
          onSaved={(updated) => { onUpdate(updated); setSelected(updated); }}
          onDeleted={(email) => { onDelete(email); setSelected(null); onRefresh(); }}
        />
      )}
    </>
  );
}

// ─── User Edit Modal ──────────────────────────────────────────────────────────

function UserEditModal({ user, secret, onClose, onSaved, onDeleted }: {
  user: AdminUser; secret: string;
  onClose: () => void;
  onSaved: (u: AdminUser) => void;
  onDeleted: (email: string) => void;
}) {
  const [name, setName] = useState(user.name);
  const [tier, setTier] = useState<"free" | "pro">(user.tier === "pro" ? "pro" : "free");
  const [emailVerified, setEmailVerified] = useState(user.emailVerified);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  async function save() {
    setSaving(true); setErrMsg("");
    try {
      const res = await fetchAdminUpdateUser(secret, user.email, { name, tier, emailVerified });
      onSaved(res.user);
    } catch (e) { setErrMsg(e instanceof Error ? e.message : "저장 실패"); }
    finally { setSaving(false); }
  }

  async function unlock() {
    setUnlocking(true); setErrMsg("");
    try {
      const res = await fetchAdminUpdateUser(secret, user.email, { unlockAccount: true });
      onSaved(res.user);
    } catch (e) { setErrMsg(e instanceof Error ? e.message : "잠금 해제 실패"); }
    finally { setUnlocking(false); }
  }

  async function doDelete() {
    setDeleting(true); setErrMsg("");
    try {
      await fetchAdminDeleteUser(secret, user.email);
      onDeleted(user.email);
    } catch (e) { setErrMsg(e instanceof Error ? e.message : "삭제 실패"); setDeleting(false); }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>회원 상세 / 수정</Text>
            <Pressable onPress={onClose}><X size={20} color="#64707D" /></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 480 }}>
            {/* Info */}
            <View style={s.infoBox}>
              <InfoRow label="이메일" value={user.email} mono />
              <InfoRow label="회원 ID" value={user.id} mono />
              <InfoRow label="가입일" value={user.createdAt?.slice(0, 10) ?? "—"} />
              <InfoRow label="로그인 실패" value={`${user.loginFailureCount}회`} />
            </View>

            {errMsg ? <Text style={s.errText}>{errMsg}</Text> : null}

            {/* Name */}
            <Text style={s.fieldLabel}>이름</Text>
            <TextInput value={name} onChangeText={setName} style={s.fieldInput} placeholder="이름" />

            {/* Tier */}
            <Text style={s.fieldLabel}>플랜</Text>
            <View style={s.segRow}>
              {(["free", "pro"] as const).map((t) => (
                <Pressable key={t} onPress={() => setTier(t)}
                  style={[s.seg, tier === t && s.segActive]}>
                  <Text style={[s.segTxt, tier === t && s.segTxtActive]}>{t === "pro" ? "PRO" : "무료"}</Text>
                </Pressable>
              ))}
            </View>

            {/* Email verified */}
            <View style={s.switchRow}>
              <Text style={s.fieldLabel}>이메일 인증 완료</Text>
              <Switch value={emailVerified} onValueChange={setEmailVerified}
                trackColor={{ true: "#0EA5A4" }} thumbColor="#fff" />
            </View>

            {/* Lock status */}
            {user.isLocked && (
              <View style={s.lockBox}>
                <AlertTriangle size={16} color="#D97706" />
                <Text style={s.lockBoxTxt}>계정 잠김 상태입니다.</Text>
                <Pressable onPress={unlock} disabled={unlocking}
                  style={({ pressed }) => [s.unlockBtn, pressed && s.pressed]}>
                  {unlocking ? <ActivityIndicator size="small" color="#fff" /> : <Unlock size={14} color="#fff" />}
                  <Text style={s.unlockBtnTxt}>잠금 해제</Text>
                </Pressable>
              </View>
            )}

            {/* Save */}
            <Pressable onPress={save} disabled={saving}
              style={({ pressed }) => [s.saveBtn, pressed && s.pressed, saving && s.dimmed]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Check size={16} color="#fff" />}
              <Text style={s.saveBtnTxt}>{saving ? "저장 중…" : "변경사항 저장"}</Text>
            </Pressable>

            {/* Danger zone */}
            <View style={s.danger}>
              <Text style={s.dangerTitle}>위험 구역</Text>
              {!confirmDelete ? (
                <Pressable onPress={() => setConfirmDelete(true)}
                  style={({ pressed }) => [s.deleteBtn, pressed && s.pressed]}>
                  <Trash2 size={15} color="#EF4444" />
                  <Text style={s.deleteBtnTxt}>이 회원 삭제</Text>
                </Pressable>
              ) : (
                <View style={s.confirmBox}>
                  <Text style={s.confirmTxt}>정말 삭제하시겠어요? 복구할 수 없습니다.</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <Pressable onPress={() => setConfirmDelete(false)} style={s.cancelBtn}>
                      <Text style={s.cancelBtnTxt}>취소</Text>
                    </Pressable>
                    <Pressable onPress={doDelete} disabled={deleting}
                      style={({ pressed }) => [s.confirmDeleteBtn, pressed && s.pressed]}>
                      {deleting ? <ActivityIndicator size="small" color="#fff" /> : null}
                      <Text style={s.confirmDeleteTxt}>삭제 확인</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────

function PaymentsTab({ payments, secret, onApprove, onReject }: {
  payments: PendingPayment[]; secret: string;
  onApprove: (email: string) => void;
  onReject: (email: string) => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");

  async function approve(email: string) {
    setLoading(email); setErrMsg("");
    try {
      await fetchAdminApprovePayment(secret, email);
      onApprove(email);
    } catch (e) { setErrMsg(e instanceof Error ? e.message : "승인 실패"); }
    finally { setLoading(null); }
  }

  async function reject(email: string) {
    setLoading(`r_${email}`); setErrMsg("");
    try {
      await fetchAdminRejectPayment(secret, email);
      onReject(email);
    } catch (e) { setErrMsg(e instanceof Error ? e.message : "거절 실패"); }
    finally { setLoading(null); }
  }

  return (
    <ScrollView contentContainerStyle={s.tabContent}>
      {errMsg ? <Text style={[s.errText, { marginBottom: 8 }]}>{errMsg}</Text> : null}
      <View style={s.section}>
        <Text style={s.secTitle}>입금 대기 중인 결제 신청</Text>
        {payments.length === 0 ? (
          <View style={s.emptyBox}>
            <CreditCard size={32} color="#D1D5DB" />
            <Text style={s.empty}>승인 대기 중인 결제 신청이 없습니다.</Text>
          </View>
        ) : (
          <>
            <View style={s.thead}>
              <Text style={[s.th, s.pEmail]}>이메일</Text>
              <Text style={[s.th, s.pName]}>이름</Text>
              <Text style={[s.th, s.pTier]}>플랜</Text>
              <Text style={[s.th, s.pDep]}>입금자명</Text>
              <Text style={[s.th, s.pDate]}>신청일</Text>
              <Text style={[s.th, s.pAct]}>처리</Text>
            </View>
            {payments.map((p, i) => (
              <View key={p.email} style={[s.trow, i % 2 === 1 && s.trowAlt]}>
                <Text style={[s.td, s.pEmail]} numberOfLines={1}>{p.emailMasked}</Text>
                <Text style={[s.td, s.pName]} numberOfLines={1}>{p.name || "—"}</Text>
                <View style={s.pTier}><Badge label={p.pendingTier.toUpperCase()} v="blue" /></View>
                <Text style={[s.td, s.pDep]} numberOfLines={1}>{p.depositorName || "—"}</Text>
                <Text style={[s.td, s.pDate]}>{p.paymentRequestedAt?.slice(0, 10) ?? "—"}</Text>
                <View style={[s.pAct, { flexDirection: "row", gap: 4 }]}>
                  <Pressable onPress={() => approve(p.email)} disabled={loading !== null}
                    style={({ pressed }) => [s.approveBtn, pressed && s.pressed, loading === p.email && s.dimmed]}>
                    {loading === p.email ? <ActivityIndicator size="small" color="#fff" /> : <Check size={13} color="#fff" />}
                    <Text style={s.approveTxt}>승인</Text>
                  </Pressable>
                  <Pressable onPress={() => reject(p.email)} disabled={loading !== null}
                    style={({ pressed }) => [s.rejectBtn, pressed && s.pressed, loading === `r_${p.email}` && s.dimmed]}>
                    <X size={13} color="#EF4444" />
                    <Text style={s.rejectTxt}>거절</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <View style={[s.statCard, { backgroundColor: color }]}>
      {icon}
      <Text style={s.statVal}>{value.toLocaleString()}</Text>
      <Text style={s.statLbl}>{label}</Text>
    </View>
  );
}

function Badge({ label, v }: { label: string; v: "green" | "blue" | "gray" }) {
  const bg = v === "green" ? "#DCFCE7" : v === "blue" ? "#EEF2FF" : "#F3F4F6";
  const fg = v === "green" ? "#16A34A" : v === "blue" ? "#4F46E5" : "#6B7280";
  return <View style={[s.badge, { backgroundColor: bg }]}><Text style={[s.badgeTxt, { color: fg }]}>{label}</Text></View>;
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, mono && { fontFamily: "monospace" }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F5F8FA" },
  loginCard: { width: "100%", maxWidth: 360, backgroundColor: "#fff", borderRadius: 16, padding: 28, alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  brandIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: "#0EA5A4", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  loginTitle: { fontSize: 20, fontWeight: "700", color: "#111827", marginBottom: 4 },
  loginSub: { fontSize: 13, color: "#64707D", marginBottom: 18, textAlign: "center" },
  loginInput: { width: "100%", height: 44, borderWidth: 1, borderColor: "#E4EAF0", borderRadius: 10, paddingHorizontal: 14, fontSize: 15, color: "#111827", backgroundColor: "#F5F8FA", marginBottom: 8 },
  loginBtn: { width: "100%", height: 44, backgroundColor: "#0EA5A4", borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 4 },
  loginBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
  pressed: { opacity: 0.72 },
  dimmed: { opacity: 0.5 },
  errText: { fontSize: 13, color: "#EF4444", marginBottom: 6 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E4EAF0" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#111827" },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#E6FAF7", borderRadius: 8 },
  refreshTxt: { fontSize: 13, color: "#0EA5A4", fontWeight: "600" },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E4EAF0" },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: "#0EA5A4" },
  tabTxt: { fontSize: 13, color: "#64707D", fontWeight: "500" },
  tabTxtActive: { color: "#0EA5A4", fontWeight: "700" },
  tabContent: { padding: 16, paddingBottom: 48, maxWidth: 960, width: "100%", alignSelf: "center" },
  cardRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  statCard: { flex: 1, minWidth: 110, borderRadius: 12, padding: 14, alignItems: "center", gap: 4 },
  statVal: { fontSize: 26, fontWeight: "800", color: "#111827" },
  statLbl: { fontSize: 11, color: "#64707D", textAlign: "center" },
  section: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  secTitle: { fontSize: 14, fontWeight: "700", color: "#111827", marginBottom: 14 },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 110, marginBottom: 6 },
  chartCol: { flex: 1, alignItems: "center", gap: 2 },
  chartVal: { fontSize: 10, color: "#64707D" },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  bar: { width: 9, borderRadius: 3 },
  barG: { backgroundColor: "#0EA5A4" },
  barP: { backgroundColor: "#7C6FE8" },
  chartLbl: { fontSize: 9, color: "#98A2AD" },
  legend: { flexDirection: "row", gap: 14, marginTop: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { fontSize: 11, color: "#64707D" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E4EAF0" },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },
  thead: { flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1.5, borderBottomColor: "#E4EAF0", marginBottom: 2 },
  th: { fontSize: 11, fontWeight: "700", color: "#64707D", textTransform: "uppercase" },
  trow: { flexDirection: "row", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", alignItems: "center" },
  trowAlt: { backgroundColor: "#F9FAFB" },
  td: { fontSize: 13, color: "#374151" },
  tdEmail: { fontSize: 12, color: "#374151", fontFamily: "monospace" },
  cEmail: { flex: 3 },
  cName: { flex: 2 },
  cBadge: { flex: 1.3 },
  cDate: { flex: 1.5, fontSize: 12, color: "#6B7280" },
  cAct: { flex: 1 },
  lockBadge: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  lockTxt: { fontSize: 10, color: "#EF4444" },
  actBtn: { backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  actBtnTxt: { fontSize: 12, color: "#374151", fontWeight: "600" },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  badgeTxt: { fontSize: 11, fontWeight: "600" },
  empty: { fontSize: 13, color: "#98A2AD", textAlign: "center", paddingVertical: 20 },
  emptyBox: { alignItems: "center", paddingVertical: 28, gap: 10 },
  footNote: { fontSize: 12, color: "#98A2AD", textAlign: "center", marginTop: 4 },
  // Payment tab columns
  pEmail: { flex: 3 },
  pName: { flex: 2 },
  pTier: { flex: 1.2 },
  pDep: { flex: 2 },
  pDate: { flex: 1.5, fontSize: 12, color: "#6B7280" },
  pAct: { flex: 2 },
  approveBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#0EA5A4", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  approveTxt: { fontSize: 12, color: "#fff", fontWeight: "700" },
  rejectBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEF2F2", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  rejectTxt: { fontSize: 12, color: "#EF4444", fontWeight: "700" },
  // Modal
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 20 },
  modal: { width: "100%", maxWidth: 480, backgroundColor: "#fff", borderRadius: 16, padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 10 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: "700", color: "#111827" },
  infoBox: { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, marginBottom: 16 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  infoLabel: { fontSize: 12, color: "#6B7280", flex: 1 },
  infoValue: { fontSize: 12, color: "#111827", flex: 2, textAlign: "right" },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 12 },
  fieldInput: { height: 40, borderWidth: 1, borderColor: "#E4EAF0", borderRadius: 8, paddingHorizontal: 12, fontSize: 14, color: "#111827", backgroundColor: "#F9FAFB" },
  segRow: { flexDirection: "row", gap: 8 },
  seg: { flex: 1, height: 36, borderRadius: 8, borderWidth: 1, borderColor: "#E4EAF0", alignItems: "center", justifyContent: "center" },
  segActive: { backgroundColor: "#0EA5A4", borderColor: "#0EA5A4" },
  segTxt: { fontSize: 13, color: "#64707D", fontWeight: "600" },
  segTxtActive: { color: "#fff" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  lockBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFBEB", borderRadius: 10, padding: 12, marginTop: 14 },
  lockBoxTxt: { flex: 1, fontSize: 13, color: "#92400E" },
  unlockBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#D97706", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  unlockBtnTxt: { fontSize: 12, color: "#fff", fontWeight: "700" },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, backgroundColor: "#0EA5A4", borderRadius: 10, marginTop: 18 },
  saveBtnTxt: { fontSize: 15, color: "#fff", fontWeight: "700" },
  danger: { marginTop: 20, borderTopWidth: 1, borderTopColor: "#FEE2E2", paddingTop: 14 },
  dangerTitle: { fontSize: 12, fontWeight: "700", color: "#EF4444", marginBottom: 10, textTransform: "uppercase" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#FCA5A5", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  deleteBtnTxt: { fontSize: 13, color: "#EF4444", fontWeight: "600" },
  confirmBox: { backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12 },
  confirmTxt: { fontSize: 13, color: "#7F1D1D" },
  cancelBtn: { flex: 1, height: 36, borderRadius: 8, borderWidth: 1, borderColor: "#E4EAF0", alignItems: "center", justifyContent: "center" },
  cancelBtnTxt: { fontSize: 13, color: "#64707D" },
  confirmDeleteBtn: { flex: 1, height: 36, borderRadius: 8, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 },
  confirmDeleteTxt: { fontSize: 13, color: "#fff", fontWeight: "700" }
});
