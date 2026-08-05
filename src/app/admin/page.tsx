"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { GlobalGradingMetrics } from "@/lib/globalGradingMetrics";
import {
  formatMetricNumber,
  formatMetricRate,
} from "@/lib/globalGradingMetrics";
import { AdminGradingFormView } from "@/components/admin/AdminGradingFormView";
import { normalizeVideoOutputId } from "@/lib/videoId";

type NumericRange = { start: number; end: number };

type ConfigForm = {
  ex1Start: number;
  ex1End: number;
  ex2Start: number;
  ex2End: number;
  sh1Start: number;
  sh1End: number;
  sh2Start: number;
  sh2End: number;
};

type UploadForm = {
  videoOutputId: string;
  aiOutputText: string;
};

type GradingListItem = {
  taskAssignmentId: string;
  expertId: string;
  expertName: string;
  videoOutputId: string;
  kind: string;
  submittedAt: string;
  gradingData?: unknown;
};

type MetricCard = {
  label: string;
  value: string;
  hint: string;
};

type UploadConflict = {
  videoOutputId: string;
  existingVideoOutputId?: string;
  existingUpdatedAt?: string;
  pendingText: string;
};

function MetricSection({
  title,
  lead,
  loading,
  empty,
  summary,
  cards,
  onRefresh,
}: {
  title: string;
  lead: string;
  loading: boolean;
  empty: boolean;
  summary?: string;
  cards: MetricCard[];
  onRefresh: () => void;
}) {
  return (
    <section className="section-block">
      <div className="page-header-row">
        <h2 className="section-title" style={{ margin: 0 }}>
          {title}
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="btn btn-ghost"
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>
      <p className="page-lead" style={{ marginTop: 10 }}>
        {lead}
      </p>
      {loading && empty ? (
        <div className="muted">加载中...</div>
      ) : empty ? (
        <div className="muted">暂无评分数据，提交后将在此显示全局指标。</div>
      ) : (
        <>
          {summary ? (
            <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
              {summary}
            </div>
          ) : null}
          <div className="admin-metric-grid">
            {cards.map((m) => (
              <div key={m.label} className="admin-metric-card">
                <div className="admin-metric-label">{m.label}</div>
                <div className="admin-metric-value">{m.value}</div>
                <div className="admin-metric-hint">{m.hint}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function AdminPage() {
  const [loading, setLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [configInfo, setConfigInfo] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [gradings, setGradings] = useState<GradingListItem[]>([]);
  const [gradingsLoading, setGradingsLoading] = useState(false);
  const [regradeInfo, setRegradeInfo] = useState<string | null>(null);
  const [regradingId, setRegradingId] = useState<string | null>(null);
  const [globalMetrics, setGlobalMetrics] =
    useState<GlobalGradingMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [uploadConflict, setUploadConflict] = useState<UploadConflict | null>(
    null,
  );
  const [expandedGradingId, setExpandedGradingId] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [unlockSecret, setUnlockSecret] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [experts, setExperts] = useState<
    {
      expertId: string;
      name: string;
      createdAt: string;
      assignmentCount?: number;
      gradingCount?: number;
    }[]
  >([]);
  const [expertName, setExpertName] = useState("");
  const [expertPassword, setExpertPassword] = useState("");
  const [expertInfo, setExpertInfo] = useState<string | null>(null);
  const [expertLoading, setExpertLoading] = useState(false);
  const [removingExpertId, setRemovingExpertId] = useState<string | null>(null);

  const { register, handleSubmit, formState, reset, setValue, setFocus } =
    useForm<UploadForm>({
      defaultValues: { videoOutputId: "", aiOutputText: "" },
      mode: "onChange",
    });

  const {
    register: registerConfig,
    handleSubmit: handleConfigSubmit,
    reset: resetConfig,
  } = useForm<ConfigForm>({
    defaultValues: {
      ex1Start: 1,
      ex1End: 75,
      ex2Start: 100,
      ex2End: 175,
      sh1Start: 76,
      sh1End: 99,
      sh2Start: 176,
      sh2End: 200,
    },
  });

  const loadExperts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/experts", { credentials: "include" });
      if (res.status === 401) {
        setUnlocked(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setExperts(data.items ?? []);
    } catch {
      setExperts([]);
    }
  }, []);

  const loadGradings = useCallback(async () => {
    setGradingsLoading(true);
    try {
      const res = await fetch("/api/admin/gradings", { credentials: "include" });
      if (res.status === 401) {
        setUnlocked(false);
        setGradings([]);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setGradings(data.items ?? []);
    } finally {
      setGradingsLoading(false);
    }
  }, []);

  const loadGlobalMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const res = await fetch("/api/admin/global-metrics", {
        credentials: "include",
      });
      if (res.status === 401) {
        setUnlocked(false);
        setGlobalMetrics(null);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setGlobalMetrics(data.metrics ?? null);
    } catch {
      setGlobalMetrics(null);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuthChecking(true);
      try {
        const res = await fetch("/api/admin/unlock", { credentials: "include" });
        if (!cancelled) setUnlocked(res.ok);
      } catch {
        if (!cancelled) setUnlocked(false);
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    fetch("/api/admin/assignment-config", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const ex = (data.exclusiveRanges ?? []) as NumericRange[];
        const sh = (data.sharedRanges ?? []) as NumericRange[];
        resetConfig({
          ex1Start: ex[0]?.start ?? 1,
          ex1End: ex[0]?.end ?? 75,
          ex2Start: ex[1]?.start ?? 100,
          ex2End: ex[1]?.end ?? 175,
          sh1Start: sh[0]?.start ?? 76,
          sh1End: sh[0]?.end ?? 99,
          sh2Start: sh[1]?.start ?? 176,
          sh2End: sh[1]?.end ?? 200,
        });
      })
      .catch(() => {});
    loadGradings();
    loadGlobalMetrics();
    loadExperts();
  }, [unlocked, resetConfig, loadGradings, loadGlobalMetrics, loadExperts]);

  async function onCreateExpert(e: React.FormEvent) {
    e.preventDefault();
    setExpertLoading(true);
    setExpertInfo(null);
    try {
      const res = await fetch("/api/admin/experts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: expertName, password: expertPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExpertInfo(`创建失败：${data?.error || res.status}`);
        return;
      }
      setExpertInfo(`已创建 ${data.expertId}（${data.name}）。请把账号与密码发给专家。`);
      setExpertName("");
      setExpertPassword("");
      await loadExperts();
    } catch (err) {
      setExpertInfo(`创建失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExpertLoading(false);
    }
  }

  async function onRemoveExpert(ex: {
    expertId: string;
    name: string;
    assignmentCount?: number;
    gradingCount?: number;
  }) {
    const a = ex.assignmentCount ?? 0;
    const g = ex.gradingCount ?? 0;
    const detail =
      a > 0 || g > 0
        ? `\n将同时删除其 ${a} 个任务与 ${g} 份评分（AI 输出本身保留）。`
        : "";
    const ok = window.confirm(
      `确定删除专家 ${ex.expertId}（${ex.name}）？${detail}\n此操作不可撤销。`,
    );
    if (!ok) return;

    setRemovingExpertId(ex.expertId);
    setExpertInfo(null);
    try {
      const res = await fetch("/api/admin/experts", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expertId: ex.expertId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExpertInfo(`删除失败：${data?.error || res.status}`);
        return;
      }
      setExpertInfo(
        `已删除 ${data.expertId}（${data.name}）` +
          (data.deletedGradings || data.deletedAssignments
            ? `：任务 ${data.deletedAssignments ?? 0}、评分 ${data.deletedGradings ?? 0}`
            : ""),
      );
      await Promise.all([loadExperts(), loadGradings(), loadGlobalMetrics()]);
    } catch (err) {
      setExpertInfo(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRemovingExpertId(null);
    }
  }

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlockLoading(true);
    setUnlockError(null);
    try {
      const res = await fetch("/api/admin/unlock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: unlockSecret }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUnlockError(data?.error || "密钥错误");
        setUnlocked(false);
        return;
      }
      setUnlockSecret("");
      setUnlocked(true);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnlockLoading(false);
    }
  }

  async function onLogoutAdmin() {
    await fetch("/api/admin/unlock", {
      method: "DELETE",
      credentials: "include",
    });
    setUnlocked(false);
    setGradings([]);
    setGlobalMetrics(null);
  }
  async function onRequestRegrade(item: GradingListItem) {
    const note = window.prompt(
      `退回 ${item.videoOutputId}（${item.expertId}）要求重评。可填写原因（可选）：`,
      "评分质量不足，请重新认真填写后提交。",
    );
    if (note === null) return;

    setRegradingId(item.taskAssignmentId);
    setRegradeInfo(null);
    try {
      const res = await fetch("/api/admin/regrade", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskAssignmentId: item.taskAssignmentId,
          note: note.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRegradeInfo(`退回失败：${data?.error || res.status}`);
        return;
      }
      setRegradeInfo(data.message || "已退回要求重评");
      await Promise.all([loadGradings(), loadGlobalMetrics()]);
    } catch (err) {
      setRegradeInfo(`退回失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegradingId(null);
    }
  }

  async function submitAiOutput(
    values: UploadForm,
    options?: { override?: boolean },
  ) {
    const normalized = normalizeVideoOutputId(values.videoOutputId);
    if (!normalized) {
      setUploadInfo(
        "上传失败：Video ID 无效。请使用独占格式 V01、V02…（V + 正整数）。",
      );
      return;
    }

    setUploadLoading(true);
    setUploadInfo(null);
    try {
      const res = await fetch("/api/admin/aioutput/upload", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoOutputId: normalized,
          aiOutputText: values.aiOutputText,
          override: options?.override === true,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data?.conflict) {
        setUploadConflict({
          videoOutputId: data.videoOutputId || normalized,
          existingVideoOutputId: data.existingVideoOutputId,
          existingUpdatedAt: data.existingUpdatedAt,
          pendingText: values.aiOutputText,
        });
        setValue("videoOutputId", data.videoOutputId || normalized);
        setUploadInfo(
          `Video ID ${data.videoOutputId || normalized} 已存在。请选择覆盖或更换 Video ID。`,
        );
        return;
      }

      if (!res.ok) {
        setUploadInfo(`上传失败：${data?.error || res.status}`);
        return;
      }

      setUploadConflict(null);
      setUploadInfo(
        data.overridden
          ? `已覆盖 ${data.videoOutputId}，识别到 Level 2 phases：${data.phasesCount}。`
          : `已保存 ${data.videoOutputId}，识别到 Level 2 phases：${data.phasesCount}。`,
      );
      reset({ videoOutputId: "", aiOutputText: "" });
    } catch (err) {
      setUploadInfo(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploadLoading(false);
    }
  }

  async function onUpload(values: UploadForm) {
    await submitAiOutput(values, { override: false });
  }

  async function onConfirmOverride() {
    if (!uploadConflict) return;
    await submitAiOutput(
      {
        videoOutputId: uploadConflict.videoOutputId,
        aiOutputText: uploadConflict.pendingText,
      },
      { override: true },
    );
  }

  function onChangeVideoIdInstead() {
    setUploadConflict(null);
    setUploadInfo("请修改 Video ID 后重新提交（每个 Video ID 只能对应一份 AI 输出）。");
    setFocus("videoOutputId");
  }

  async function onSaveConfig(values: ConfigForm) {
    setConfigLoading(true);
    setConfigInfo(null);
    try {
      const exclusiveRanges: NumericRange[] = [
        { start: Number(values.ex1Start), end: Number(values.ex1End) },
        { start: Number(values.ex2Start), end: Number(values.ex2End) },
      ];
      const sharedRanges: NumericRange[] = [
        { start: Number(values.sh1Start), end: Number(values.sh1End) },
        { start: Number(values.sh2Start), end: Number(values.sh2End) },
      ];
      const res = await fetch("/api/admin/assignment-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exclusiveRanges, sharedRanges }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "保存失败");
      setConfigInfo("区间配置已保存。专家刷新任务面板后生效。");
    } finally {
      setConfigLoading(false);
    }
  }

  async function onExport() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/export", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`导出失败：${res.status}`);
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "grading_metrics.csv";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }

  const numInput = { width: 100 };

  if (authChecking) {
    return (
      <main className="app-shell">
        <div className="app-shell-inner" style={{ maxWidth: 440 }}>
          <div className="brand-mark">Admin</div>
          <p className="muted">正在验证管理员会话…</p>
        </div>
      </main>
    );
  }

  if (!unlocked) {
    return (
      <main className="app-shell">
        <div className="app-shell-inner" style={{ maxWidth: 440 }}>
          <div className="brand-mark">Admin</div>
          <h1 className="page-title">管理员解锁</h1>
          <p className="page-lead">
            输入服务器配置的 <code>ADMIN_SECRET</code> 以访问管理后台。密钥仅保存在
            httpOnly Cookie 中，不会暴露给前端打包代码。
          </p>
          <form onSubmit={onUnlock} className="section-block" style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontWeight: 700, fontSize: 13 }}>
              ADMIN_SECRET
              <input
                type="password"
                value={unlockSecret}
                onChange={(e) => setUnlockSecret(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
            </label>
            {unlockError ? <div className="notice notice-danger">{unlockError}</div> : null}
            <button type="submit" className="btn btn-primary btn-block" disabled={unlockLoading}>
              {unlockLoading ? "验证中…" : "解锁"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="app-shell-inner" style={{ maxWidth: 860 }}>
        <div className="page-header-row">
          <div>
            <div className="brand-mark">Admin</div>
            <h1 className="page-title">管理后台</h1>
            <p className="page-lead">配置任务区间、上传 AI 输出、导出指标，并在需要时退回重评。</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void onLogoutAdmin()}>
            退出管理
          </button>
        </div>

      <div style={{ display: "grid", gap: 16 }}>
        <section className="section-block">
          <h2 className="section-title">专家账号</h2>
          <p className="page-lead" style={{ marginBottom: 14 }}>
            生产环境默认关闭专家自助注册。请在此创建账号，再把姓名与初始密码发给专家。
          </p>
          <form onSubmit={onCreateExpert} style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: 6, fontWeight: 700, fontSize: 13, flex: "1 1 160px" }}>
                姓名
                <input
                  value={expertName}
                  onChange={(e) => setExpertName(e.target.value)}
                  required
                  placeholder="专家姓名"
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 700, fontSize: 13, flex: "1 1 160px" }}>
                初始密码（≥8 位）
                <input
                  type="password"
                  value={expertPassword}
                  onChange={(e) => setExpertPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
            </div>
            {expertInfo ? (
              <div
                className={`notice ${
                  expertInfo.startsWith("创建失败") || expertInfo.startsWith("删除失败")
                    ? "notice-danger"
                    : "notice-ok"
                }`}
              >
                {expertInfo}
              </div>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={expertLoading}>
              {expertLoading ? "创建中…" : "创建专家账号"}
            </button>
          </form>
          {experts.length > 0 ? (
            <ul
              style={{
                marginTop: 14,
                paddingLeft: 0,
                listStyle: "none",
                fontSize: 13,
                lineHeight: 1.7,
                display: "grid",
                gap: 8,
              }}
            >
              {experts.map((ex) => (
                <li
                  key={ex.expertId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    <code>{ex.expertId}</code> — {ex.name}
                    <span className="muted" style={{ marginLeft: 8 }}>
                      任务 {ex.assignmentCount ?? 0} · 评分 {ex.gradingCount ?? 0}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={removingExpertId === ex.expertId}
                    onClick={() => void onRemoveExpert(ex)}
                  >
                    {removingExpertId === ex.expertId ? "删除中…" : "删除"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              暂无专家账号。
            </p>
          )}
        </section>

        <section className="section-block">
          <h2 className="section-title">任务区间配置</h2>
          <p className="page-lead" style={{ marginBottom: 14 }}>
            独占区间：专家自助认领，每个视频仅一人。共享区间：每位专家登录后自动分派，全员必评。
            视频编号从 <code>videoOutputId</code> 解析（如 V01 → 1）。
          </p>

          <form onSubmit={handleConfigSubmit(onSaveConfig)} style={{ display: "grid", gap: 12 }}>
            <fieldset className="grading-sub" style={{ margin: 0 }}>
              <legend>独占认领区间</legend>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span>段1</span>
                <input type="number" {...registerConfig("ex1Start", { valueAsNumber: true })} style={numInput} />
                <span>—</span>
                <input type="number" {...registerConfig("ex1End", { valueAsNumber: true })} style={numInput} />
                <span style={{ marginLeft: 12 }}>段2</span>
                <input type="number" {...registerConfig("ex2Start", { valueAsNumber: true })} style={numInput} />
                <span>—</span>
                <input type="number" {...registerConfig("ex2End", { valueAsNumber: true })} style={numInput} />
              </div>
            </fieldset>

            <fieldset className="grading-sub" style={{ margin: 0 }}>
              <legend>全员分派区间</legend>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span>段1</span>
                <input type="number" {...registerConfig("sh1Start", { valueAsNumber: true })} style={numInput} />
                <span>—</span>
                <input type="number" {...registerConfig("sh1End", { valueAsNumber: true })} style={numInput} />
                <span style={{ marginLeft: 12 }}>段2</span>
                <input type="number" {...registerConfig("sh2Start", { valueAsNumber: true })} style={numInput} />
                <span>—</span>
                <input type="number" {...registerConfig("sh2End", { valueAsNumber: true })} style={numInput} />
              </div>
            </fieldset>

            {configInfo ? <div className="notice notice-ok">{configInfo}</div> : null}

            <button type="submit" disabled={configLoading} className="btn btn-primary btn-block">
              {configLoading ? "保存中..." : "保存区间配置"}
            </button>
          </form>
        </section>

        <section className="section-block">
          <h2 className="section-title">上传 AI 输出</h2>
          <p className="page-lead" style={{ marginBottom: 14 }}>
            以独占 Video ID（如 <code>V01</code>）命名并保存。同一 Video ID
            只能有一份 AI 输出；若已存在，系统会询问是否覆盖或更换 ID。
          </p>
          <form onSubmit={handleSubmit(onUpload)} style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontWeight: 700, color: "var(--ink-soft)", fontSize: 13 }}>
              Video ID（独占，例如 V01）
              <input
                {...register("videoOutputId", {
                  required: true,
                  validate: (v) =>
                    normalizeVideoOutputId(v) != null ||
                    "格式须为 V + 正整数，如 V01",
                })}
                placeholder="V01"
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 700, color: "var(--ink-soft)", fontSize: 13 }}>
              AI 输出纯文本
              <textarea {...register("aiOutputText", { required: true })} rows={10} />
            </label>
            {uploadInfo ? (
              <div
                className={`notice ${
                  uploadInfo.startsWith("上传失败") || uploadConflict
                    ? "notice-danger"
                    : "notice-ok"
                }`}
              >
                {uploadInfo}
              </div>
            ) : null}
            {uploadConflict ? (
              <div className="admin-conflict-box">
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                  <strong>{uploadConflict.videoOutputId}</strong> 已存在
                  {uploadConflict.existingUpdatedAt
                    ? `（上次更新：${new Date(uploadConflict.existingUpdatedAt).toLocaleString()}）`
                    : ""}
                  。请选择：
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={uploadLoading}
                    onClick={() => void onConfirmOverride()}
                  >
                    {uploadLoading ? "覆盖中..." : "覆盖现有内容"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={uploadLoading}
                    onClick={onChangeVideoIdInstead}
                  >
                    更换 Video ID
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={uploadLoading}
                    onClick={() => {
                      setUploadConflict(null);
                      setUploadInfo(null);
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="submit"
              disabled={uploadLoading || !formState.isValid || Boolean(uploadConflict)}
              className="btn btn-primary btn-block"
            >
              {uploadLoading ? "上传中..." : "保存并解析"}
            </button>
          </form>
        </section>

        <MetricSection
          title="Level 1 全局指标"
          lead="汇总全部已提交评分表上的术式类型与空间定位 Correct/Incorrect 判定。"
          loading={metricsLoading}
          empty={!globalMetrics || globalMetrics.formCount === 0}
          summary={
            globalMetrics
              ? `评分表 ${globalMetrics.formCount} · 术式已标注 ${globalMetrics.level1.procedureTypeLabeledCount} · 空间定位已标注 ${globalMetrics.level1.spatialPositioningLabeledCount}`
              : undefined
          }
          onRefresh={() => void loadGlobalMetrics()}
          cards={
            globalMetrics
              ? [
                  {
                    label: "Procedure Type Accuracy",
                    value: formatMetricRate(
                      globalMetrics.level1.procedureTypeAccuracy,
                    ),
                    hint: `正确 / 已标注 · ${globalMetrics.level1.procedureTypeCorrectCount}/${globalMetrics.level1.procedureTypeLabeledCount}`,
                  },
                  {
                    label: "Spatial Positioning Accuracy",
                    value: formatMetricRate(
                      globalMetrics.level1.spatialPositioningAccuracy,
                    ),
                    hint: `正确 / 已标注 · ${globalMetrics.level1.spatialPositioningCorrectCount}/${globalMetrics.level1.spatialPositioningLabeledCount}`,
                  },
                ]
              : []
          }
        />

        <MetricSection
          title="Level 2 全局指标 · Missed Phases"
          lead="对比 AI 与专家的遗漏阶段数量相关（Pearson r），并统计遗漏内容是否正确。"
          loading={metricsLoading}
          empty={!globalMetrics || globalMetrics.formCount === 0}
          summary={
            globalMetrics
              ? `评分表 ${globalMetrics.formCount} · 数量成对样本 ${globalMetrics.level2.countPairCount} · 内容已标注 ${globalMetrics.level2.contentLabeledCount}`
              : undefined
          }
          onRefresh={() => void loadGlobalMetrics()}
          cards={
            globalMetrics
              ? [
                  {
                    label: "Count Correlation (r)",
                    value: formatMetricNumber(
                      globalMetrics.level2.missedPhasesCountCorrelation,
                      3,
                    ),
                    hint: `Pearson r · AI vs 专家遗漏阶段数 · n=${globalMetrics.level2.countPairCount}`,
                  },
                  {
                    label: "Content Accuracy",
                    value: formatMetricRate(
                      globalMetrics.level2.missedPhasesContentAccuracy,
                    ),
                    hint: `遗漏内容正确 / 已标注 · ${globalMetrics.level2.contentCorrectCount}/${globalMetrics.level2.contentLabeledCount}`,
                  },
                ]
              : []
          }
        />

        <MetricSection
          title="Level 3 全局指标"
          lead="Exit：AI 与专家对「手术是否已完成」的判定。Global / Nomenclature / Safety 只在「专家认为手术尚未结束、仍有下一步」的评分表上计算。False Exit：AI 说已完成但专家认为未完成。"
          loading={metricsLoading}
          empty={!globalMetrics || globalMetrics.formCount === 0}
          summary={
            globalMetrics
              ? `评分表 ${globalMetrics.formCount} · Exit 可用 ${globalMetrics.level3.exitEligibleCount} · 专家认为尚未结束 ${globalMetrics.level3.incompleteExpertCount}`
              : undefined
          }
          onRefresh={() => void loadGlobalMetrics()}
          cards={
            globalMetrics
              ? [
                  {
                    label: "Exit Precision",
                    value: formatMetricRate(globalMetrics.level3.exitPrecision),
                    hint: `TP/(AI 判完成) · ${globalMetrics.level3.exitTruePositive}/${globalMetrics.level3.exitTruePositive + globalMetrics.level3.exitFalsePositive}`,
                  },
                  {
                    label: "Exit Recall",
                    value: formatMetricRate(globalMetrics.level3.exitRecall),
                    hint: `TP/(专家判完成) · ${globalMetrics.level3.exitTruePositive}/${globalMetrics.level3.exitTruePositive + globalMetrics.level3.exitFalseNegative}`,
                  },
                  {
                    label: "Global Precision",
                    value: formatMetricRate(globalMetrics.level3.globalPrecision),
                    hint: "下一步正确数 / 专家认为尚未结束的表数",
                  },
                  {
                    label: "Nomenclature Accuracy",
                    value: formatMetricRate(
                      globalMetrics.level3.nomenclatureAccuracy,
                    ),
                    hint: "术语规范数 / 专家认为尚未结束的表数",
                  },
                  {
                    label: "Safety Fail Rate",
                    value: formatMetricRate(globalMetrics.level3.safetyFailRate),
                    hint: "Safety Fail 数 / 专家认为尚未结束的表数",
                  },
                  {
                    label: "False Exit Rate",
                    value: formatMetricRate(globalMetrics.level3.falseExitRate),
                    hint: `AI 判完成但专家认为未结束 / 全部表 · ${globalMetrics.level3.exitFalsePositive}/${globalMetrics.formCount}`,
                  },
                ]
              : []
          }
        />

        <MetricSection
          title="Level 4 · AI vs Expert"
          lead="全部评分表 × 全部 OSATS 维度上，AI 分数与专家分数的对齐指标。"
          loading={metricsLoading}
          empty={!globalMetrics || globalMetrics.formCount === 0}
          summary={
            globalMetrics
              ? `评分表 ${globalMetrics.formCount} · 分数成对样本 ${globalMetrics.level4.pairCount}`
              : undefined
          }
          onRefresh={() => void loadGlobalMetrics()}
          cards={
            globalMetrics
              ? [
                  {
                    label: "MAE",
                    value: formatMetricNumber(globalMetrics.level4.mae, 3),
                    hint: "平均 |AI − 专家| · 1–5 分制",
                  },
                  {
                    label: "LCC",
                    value: formatMetricNumber(globalMetrics.level4.lcc, 3),
                    hint: "Pearson 线性相关",
                  },
                  {
                    label: "SROCC",
                    value: formatMetricNumber(globalMetrics.level4.srocc, 3),
                    hint: "Spearman 秩相关",
                  },
                  {
                    label: "Hallucination Rate",
                    value: formatMetricRate(
                      globalMetrics.level4.meanHallucinationRate,
                    ),
                    hint: `各表 (Yes/维度数) 的平均 · Yes合计 ${globalMetrics.level4.hallucinationYesCount}/${globalMetrics.level4.hallucinationTotalCount} · 表数 ${globalMetrics.level4.hallucinationFormCount}`,
                  },
                ]
              : []
          }
        />

        <MetricSection
          title="专家间一致性 · iccAbsoluteAgreement"
          lead="SHARED 且 ≥2 位专家已提交的视频：对每对专家用 iccAbsoluteAgreement 算 ICC(2,1)，再汇总为一个总体值。"
          loading={metricsLoading}
          empty={!globalMetrics || globalMetrics.formCount === 0}
          summary={
            globalMetrics
              ? `共享视频 ${globalMetrics.interExpert.sharedVideoCount} · 专家 ${globalMetrics.interExpert.sharedExpertCount} · 专家对 ${globalMetrics.interExpert.expertPairCount}`
              : undefined
          }
          onRefresh={() => void loadGlobalMetrics()}
          cards={
            globalMetrics
              ? [
                  {
                    label: "iccAbsoluteAgreement",
                    value: formatMetricNumber(globalMetrics.interExpert.icc, 3),
                    hint: "ICC(2,1) 绝对一致性（两两计算后汇总）",
                  },
                ]
              : []
          }
        />

        <section className="section-block">
          <h2 className="section-title">导出统计 CSV</h2>
          <p className="page-lead" style={{ marginBottom: 14 }}>
            CSV 开头为 Level 1–4 与专家间 ICC 全局摘要，随后为每条评分明细。
          </p>
          <button
            type="button"
            onClick={onExport}
            disabled={loading}
            className="btn btn-primary btn-block"
          >
            {loading ? "导出中..." : "Export Data"}
          </button>
        </section>

        <section className="section-block">
          <div className="page-header-row">
            <h2 className="section-title" style={{ margin: 0 }}>
              已提交评分 · 退回重评
            </h2>
            <button
              type="button"
              onClick={() => {
                void loadGradings();
                void loadGlobalMetrics();
              }}
              disabled={gradingsLoading || metricsLoading}
              className="btn btn-ghost"
            >
              {gradingsLoading || metricsLoading ? "刷新中..." : "刷新"}
            </button>
          </div>
          <p className="page-lead" style={{ marginTop: 10 }}>
            可展开查看完整评分表内容。若质量不佳，可退回重评：任务变回 Pending，旧提交删除，专家需重新填写。
          </p>
          {regradeInfo ? (
            <div
              className={`notice ${regradeInfo.startsWith("退回失败") ? "notice-danger" : "notice-ok"}`}
            >
              {regradeInfo}
            </div>
          ) : null}
          {gradingsLoading && gradings.length === 0 ? (
            <div className="muted">加载中...</div>
          ) : gradings.length === 0 ? (
            <div className="muted">暂无已完成评分</div>
          ) : (
            <ul className="task-list">
              {gradings.map((g) => {
                const expanded = expandedGradingId === g.taskAssignmentId;
                return (
                  <li key={g.taskAssignmentId}>
                    <div className="admin-grading-item">
                      <div className="task-btn" style={{ cursor: "default" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="task-btn-title">
                            {g.videoOutputId} · {g.expertId}
                          </div>
                          <div className="task-btn-meta" style={{ marginTop: 4 }}>
                            {g.expertName} · {g.kind} ·{" "}
                            {new Date(g.submittedAt).toLocaleString()}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() =>
                              setExpandedGradingId(
                                expanded ? null : g.taskAssignmentId,
                              )
                            }
                          >
                            {expanded ? "收起" : "查看评分"}
                          </button>
                          <button
                            type="button"
                            disabled={regradingId === g.taskAssignmentId}
                            onClick={() => onRequestRegrade(g)}
                            className="btn btn-ghost"
                            style={{
                              borderColor: "var(--warn-line)",
                              background: "var(--warn-bg)",
                              color: "var(--warn)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {regradingId === g.taskAssignmentId
                              ? "退回中..."
                              : "退回重评"}
                          </button>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="admin-grading-detail">
                          <AdminGradingFormView gradingData={g.gradingData} />
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      </div>
    </main>
  );
}
