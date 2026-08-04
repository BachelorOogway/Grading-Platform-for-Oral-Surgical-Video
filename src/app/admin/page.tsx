"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";

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

type GradingListItem = {
  taskAssignmentId: string;
  expertId: string;
  expertName: string;
  videoOutputId: string;
  kind: string;
  submittedAt: string;
};

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
  const adminSecret = process.env.NEXT_PUBLIC_ADMIN_SECRET as string | undefined;

  const { register, handleSubmit, formState, reset } = useForm<{
    videoOutputId: string;
    aiOutputText: string;
  }>({
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

  const loadGradings = useCallback(async () => {
    setGradingsLoading(true);
    try {
      const res = await fetch("/api/admin/gradings");
      const data = await res.json().catch(() => ({}));
      setGradings(data.items ?? []);
    } finally {
      setGradingsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/assignment-config")
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
  }, [resetConfig, loadGradings]);

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
      await loadGradings();
    } catch (err) {
      setRegradeInfo(`退回失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegradingId(null);
    }
  }

  async function onUpload(values: { videoOutputId: string; aiOutputText: string }) {
    setUploadLoading(true);
    setUploadInfo(null);
    try {
      const res = await fetch("/api/admin/aioutput/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadInfo(`上传失败：${data?.error || res.status}`);
        return;
      }
      setUploadInfo(
        `已保存 ${data.videoOutputId}，识别到 Level 2 phases：${data.phasesCount}。`,
      );
      reset({ videoOutputId: "", aiOutputText: "" });
    } catch (err) {
      setUploadInfo(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploadLoading(false);
    }
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
        headers: adminSecret ? { "x-admin-secret": adminSecret } : undefined,
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

  return (
    <main className="app-shell">
      <div className="app-shell-inner" style={{ maxWidth: 860 }}>
        <div className="brand-mark">Admin</div>
        <h1 className="page-title">管理后台</h1>
        <p className="page-lead">配置任务区间、上传 AI 输出、导出指标，并在需要时退回重评。</p>

      <div style={{ display: "grid", gap: 16 }}>
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
          <form onSubmit={handleSubmit(onUpload)} style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontWeight: 700, color: "var(--ink-soft)", fontSize: 13 }}>
              videoOutputId（例如 V01）
              <input {...register("videoOutputId", { required: true })} placeholder="V01" />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 700, color: "var(--ink-soft)", fontSize: 13 }}>
              AI 输出纯文本
              <textarea {...register("aiOutputText", { required: true })} rows={10} />
            </label>
            {uploadInfo ? (
              <div
                className={`notice ${uploadInfo.startsWith("上传失败") ? "notice-danger" : "notice-ok"}`}
              >
                {uploadInfo}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={uploadLoading || !formState.isValid}
              className="btn btn-primary btn-block"
            >
              {uploadLoading ? "上传中..." : "保存并解析"}
            </button>
          </form>
        </section>

        <section className="section-block">
          <h2 className="section-title">导出统计 CSV</h2>
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
              onClick={loadGradings}
              disabled={gradingsLoading}
              className="btn btn-ghost"
            >
              {gradingsLoading ? "刷新中..." : "刷新"}
            </button>
          </div>
          <p className="page-lead" style={{ marginTop: 10 }}>
            若评分质量不佳，可退回给专家。任务会重新变为 Pending，旧提交会被删除，专家需重新填写并提交。
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
              {gradings.map((g) => (
                <li key={g.taskAssignmentId}>
                  <div className="task-btn" style={{ cursor: "default" }}>
                    <div>
                      <div className="task-btn-title">
                        {g.videoOutputId} · {g.expertId}
                      </div>
                      <div className="task-btn-meta" style={{ marginTop: 4 }}>
                        {g.expertName} · {g.kind} · {new Date(g.submittedAt).toLocaleString()}
                      </div>
                    </div>
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
                      {regradingId === g.taskAssignmentId ? "退回中..." : "退回重评"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      </div>
    </main>
  );
}
