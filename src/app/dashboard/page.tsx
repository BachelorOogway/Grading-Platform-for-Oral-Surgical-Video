"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TaskListItem = {
  taskAssignmentId: string;
  aiOutputId: string;
  videoOutputId: string;
  status: "PENDING" | "COMPLETED";
  kind: "EXCLUSIVE" | "SHARED";
  updatedAt: string;
  regradeNote?: string | null;
  regradeRequestedAt?: string | null;
};

type ClaimableItem = {
  videoOutputId: string;
  videoNumber: number | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [sharedPending, setSharedPending] = useState<TaskListItem[]>([]);
  const [exclusivePending, setExclusivePending] = useState<TaskListItem[]>([]);
  const [completed, setCompleted] = useState<TaskListItem[]>([]);
  const [claimable, setClaimable] = useState<ClaimableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [expertId, setExpertId] = useState<string | null>(null);

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
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

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
                {t.regradeRequestedAt ? <span className="badge badge-warn">需重评</span> : null}
                <span className="task-btn-meta">
                  {t.kind === "SHARED" ? "全员必评" : "已认领"}
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
              共享区间视频会自动出现在「分派任务」；独占区间需自行认领，每个视频仅一位专家。
            </p>
          </div>
        </div>

        <section className="section-block">
          <h2 className="section-title">可认领 · 独占</h2>
          {claimable.length === 0 ? (
            <div className="muted">暂无可认领视频（可能尚未上传或已被认领）</div>
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
                      {claimingId === c.videoOutputId ? "认领中…" : "认领"}
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
