"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TaskListItem = {
  taskAssignmentId: string;
  aiOutputId: string;
  videoOutputId: string;
  status: "PENDING" | "COMPLETED";
  kind: "EXCLUSIVE" | "SHARED";
  graderSlot?: number;
  graderRoundSlot?: number;
  updatedAt: string;
  regradeNote?: string | null;
  regradeRequestedAt?: string | null;
};

type ClaimableItem = {
  videoOutputId: string;
  videoNumber: number | null;
  slotsTaken?: number;
  slotsTotal?: number;
};

type DiscItem = {
  id: string;
  videoOutputId: string;
  fieldPath: string;
  fieldLabel: string;
  taskAssignmentId: string | null;
  submittedCount?: number;
  total?: number;
  mySubmitted?: boolean;
  myChoice?: string | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [sharedPending, setSharedPending] = useState<TaskListItem[]>([]);
  const [exclusivePending, setExclusivePending] = useState<TaskListItem[]>([]);
  const [completed, setCompleted] = useState<TaskListItem[]>([]);
  const [claimable, setClaimable] = useState<ClaimableItem[]>([]);
  const [discrepancies, setDiscrepancies] = useState<DiscItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [expertId, setExpertId] = useState<string | null>(null);
  const [discSubmitNotice, setDiscSubmitNotice] = useState(false);

  const loadTasks = useCallback(async () => {
    const id = localStorage.getItem("expertId");
    if (!id) {
      router.push("/login");
      return;
    }
    setExpertId(id);

    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?expertId=${encodeURIComponent(id)}`);
      const data = await res.json();
      setSharedPending(data.sharedPending ?? []);
      setExclusivePending(data.exclusivePending ?? []);
      setCompleted(data.completed ?? []);
      setClaimable(data.claimable ?? []);
      setDiscrepancies(data.discrepancies ?? []);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("discSubmitted") === "1") {
      setDiscSubmitNotice(true);
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  async function onClaim(videoOutputId: string) {
    const id = localStorage.getItem("expertId");
    if (!id) return;

    setClaimingId(videoOutputId);
    try {
      const res = await fetch("/api/tasks/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expertId: id, videoOutputId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "认领失败");
        await loadTasks();
        return;
      }
      if (data.taskAssignmentId) {
        router.push(`/tasks/${data.taskAssignmentId}`);
        return;
      }
      await loadTasks();
    } finally {
      setClaimingId(null);
    }
  }

  function renderTaskList(items: TaskListItem[], empty: string) {
    if (items.length === 0) {
      return <div className="muted">{empty}</div>;
    }
    return (
      <ul className="task-list">
        {items.map((t) => (
          <li key={t.taskAssignmentId}>
            <button
              type="button"
              className="task-btn"
              onClick={() => router.push(`/tasks/${t.taskAssignmentId}`)}
            >
              <span className="task-btn-title">{t.videoOutputId}</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {t.regradeRequestedAt ? (
                  <span className="badge badge-warn">需重评</span>
                ) : null}
                <span className="badge">
                  G{t.graderRoundSlot ?? t.graderSlot ?? "?"}/3
                </span>
                <span className="task-btn-meta">
                  {t.kind === "SHARED" ? "历史共享" : "认领"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (loading) {
    return (
      <main className="app-shell">
        <div className="app-shell-inner muted">正在准备您的任务…</div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="app-shell-inner">
        <div className="brand-mark">Oral Surgical Grading</div>
        <div className="page-header-row">
          <div>
            <h1 className="page-title">任务面板</h1>
            <p className="page-lead">
              {expertId ? `您好，${expertId}。` : ""}
              每个视频 3 位评分者。选择题分歧默认按多数（2:1）裁定；仅被发起
              discrepancy solve 的项会出现在下方供进一步处理（无投票）。
            </p>
          </div>
        </div>

        {discSubmitNotice ? (
          <div className="notice notice-ok" style={{ marginBottom: 12 }}>
            Submission successful
          </div>
        ) : null}

        {discrepancies.length > 0 ? (
          <section className="section-block" style={{ borderColor: "#f9a8d4" }}>
            <h2 className="section-title">Discrepancy solve · 需进一步处理</h2>
            <p className="page-lead" style={{ fontSize: 13, marginBottom: 12 }}>
              每条 discrepancy 单独列出；同一视频的多项会在同一个对照表单中一起处理。
              提交后返回此页。已提交 solve 的专家，其列会直接显示 solve 之后的结果。
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
              {discrepancies.map((d) => (
                <li
                  key={d.id}
                  style={{
                    background: "#fce7f3",
                    border: "1px solid #f9a8d4",
                    borderRadius: 8,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
                      Video: {d.videoOutputId}
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      {d.fieldLabel}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      已提交 {d.submittedCount ?? 0}/{d.total ?? 3}
                      {d.mySubmitted ? " · 你已提交" : " · 待你提交"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: 12 }}
                    onClick={() => router.push(`/discrepancies/${d.id}`)}
                  >
                    打开对照重评
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="section-block">
          <h2 className="section-title">可认领（未满 3 人）</h2>
          {claimable.length === 0 ? (
            <div className="muted">暂无可认领视频</div>
          ) : (
            <ul className="task-list">
              {claimable.map((c) => (
                <li key={c.videoOutputId}>
                  <button
                    type="button"
                    className="task-btn"
                    disabled={claimingId === c.videoOutputId}
                    onClick={() => onClaim(c.videoOutputId)}
                  >
                    <span className="task-btn-title">{c.videoOutputId}</span>
                    <span className="badge">
                      {claimingId === c.videoOutputId
                        ? "认领中…"
                        : `认领 (${c.slotsTaken ?? 0}/${c.slotsTotal ?? 3})`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section-block">
          <h2 className="section-title">分派任务 · 待完成</h2>
          {renderTaskList(sharedPending, "暂无分派待办")}
        </section>

        <section className="section-block">
          <h2 className="section-title">已认领 · 待完成</h2>
          {renderTaskList(exclusivePending, "暂无已认领待办")}
        </section>

        <section className="section-block">
          <h2 className="section-title">已完成</h2>
          {renderTaskList(completed, "暂无已完成任务")}
        </section>
      </div>
    </main>
  );
}
