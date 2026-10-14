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

  const discByVideo = new Map<
    string,
    { id: string; videoOutputId: string; mySubmitted: boolean }
  >();
  for (const d of discrepancies) {
    const prev = discByVideo.get(d.videoOutputId);
    if (!prev) {
      discByVideo.set(d.videoOutputId, {
        id: d.id,
        videoOutputId: d.videoOutputId,
        mySubmitted: Boolean(d.mySubmitted),
      });
    } else if (!d.mySubmitted) {
      prev.mySubmitted = false;
    }
  }
  const discVideoRows = [...discByVideo.values()].sort((a, b) =>
    a.videoOutputId.localeCompare(b.videoOutputId, undefined, { numeric: true }),
  );

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

        {discVideoRows.length > 0 ? (
          <section className="section-block" style={{ borderColor: "#f9a8d4" }}>
            <h2 className="section-title">Discrepancy solve · 需进一步处理</h2>
            <p className="page-lead" style={{ fontSize: 13, marginBottom: 12 }}>
              仅按视频编号列出。同一视频的全部 discrepancy 会在同一个对照表单中一起处理。
            </p>
            <ul className="task-list">
              {discVideoRows.map((v) => (
                <li key={v.videoOutputId}>
                  <button
                    type="button"
                    className="task-btn"
                    onClick={() => router.push(`/discrepancies/${v.id}`)}
                  >
                    <span className="task-btn-title">{v.videoOutputId}</span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span
                        className={`badge ${v.mySubmitted ? "badge-ok" : "badge-warn"}`}
                      >
                        {v.mySubmitted ? "已提交" : "待提交"}
                      </span>
                      <span className="task-btn-meta">打开对照重评</span>
                    </span>
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
