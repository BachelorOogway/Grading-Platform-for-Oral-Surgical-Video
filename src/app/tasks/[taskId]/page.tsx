"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { AiParsedData } from "@/lib/aiOutputParser";
import {
  buildDefaultGradingForm,
  buildGradingPayload,
  clearGradingDraft,
  getGradingIncompleteFields,
  getGradingIncompleteMessages,
  hydrateGradingForm,
  loadGradingDraft,
  saveGradingDraft,
  scrollToGradingField,
  type GradingForm,
} from "@/lib/gradingForm";
import { GradingFormPanel } from "@/components/grading/GradingFormPanel";
import { PriorAlignedForm } from "@/components/grading/PriorAlignedForm";
import { disagreePathSet } from "@/components/grading/PriorCategoricalColumn";
import type { CategoricalDisagreement } from "@/lib/categoricalFields";

type PriorGrader = {
  expertId: string;
  name: string;
  graderSlot: number;
  gradingData: unknown;
};

type TaskDetail = {
  taskAssignmentId: string;
  status: "PENDING" | "COMPLETED";
  graderSlot?: number;
  expert: { expertId: string; name: string };
  regradeNote?: string | null;
  regradeRequestedAt?: string | null;
  aiOutput: {
    videoOutputId: string;
    rawText: string;
    parsedData: AiParsedData;
  };
  gradingResult: any | null;
  consensus?: {
    isTiebreaker: boolean;
    graderSlot: number;
    priorGraders: PriorGrader[];
    disagreements: CategoricalDisagreement[];
  };
};

const EMPTY_PARSED: AiParsedData = {
  level1: {
    procedureType: "",
    structures: [],
    totalStructures: null,
    instruments: [],
    totalInstruments: null,
    spatialPositioning: "",
  },
  level2: {
    phases: [],
    totalPhases: null,
    missedStepsEvaluation: "",
    aiMissedPhasesCount: null,
  },
  level3: { nextActionPrediction: "", clinicalRationale: "", surgeryCompleted: null },
  level4: { dimensions: [] },
};

export default function TaskGradingPage() {
  const router = useRouter();
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId;

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expertId, setExpertId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDisc, setSelectedDisc] = useState<Set<string>>(new Set());

  const parsed = useMemo(
    () => task?.aiOutput?.parsedData ?? EMPTY_PARSED,
    [task],
  );

  const defaultValues = useMemo(
    () => buildDefaultGradingForm(parsed),
    [parsed],
  );

  const { register, handleSubmit, reset, watch, setValue } = useForm<GradingForm>({
    defaultValues,
    mode: "onChange",
    shouldUnregister: false,
  });

  const watchedValues = watch();
  const incomplete = useMemo(
    () => getGradingIncompleteMessages(watchedValues, parsed),
    [watchedValues, parsed],
  );
  const formComplete = incomplete.length === 0;

  const isTiebreaker = Boolean(task?.consensus?.isTiebreaker);
  const disagreements = task?.consensus?.disagreements ?? [];
  const priorGraders = task?.consensus?.priorGraders ?? [];
  const highlightPaths = useMemo(
    () => disagreePathSet(disagreements),
    [disagreements],
  );

  function toggleDiscSolve(path: string) {
    setSelectedDisc((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  useEffect(() => {
    const id = localStorage.getItem("expertId");
    if (!id) {
      router.push("/login");
      return;
    }
    setExpertId(id);
    if (!taskId) return;

    setLoading(true);
    fetch(`/api/tasks/${taskId}?expertId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => setTask(data))
      .finally(() => setLoading(false));
  }, [router, taskId]);

  useEffect(() => {
    if (!task || !expertId || !taskId) return;

    if (task.gradingResult) {
      reset(hydrateGradingForm(parsed, task.gradingResult), {
        keepDefaultValues: false,
      });
      return;
    }

    if (task.regradeRequestedAt) {
      const clearedKey = `gradingDraftCleared:${expertId}:${taskId}:${task.regradeRequestedAt}`;
      if (!localStorage.getItem(clearedKey)) {
        clearGradingDraft(expertId, taskId);
        localStorage.setItem(clearedKey, "1");
        reset(buildDefaultGradingForm(parsed), { keepDefaultValues: false });
        return;
      }
    }

    const draft = loadGradingDraft(expertId, taskId);
    if (draft) {
      reset(hydrateGradingForm(parsed, draft), { keepDefaultValues: false });
    } else {
      reset(buildDefaultGradingForm(parsed), { keepDefaultValues: false });
    }
  }, [task, parsed, reset, expertId, taskId]);

  useEffect(() => {
    if (!task || !expertId || !taskId) return;
    if (task.status === "COMPLETED") return;

    const sub = watch((values) => {
      saveGradingDraft(expertId, taskId, values as GradingForm);
    });
    return () => sub.unsubscribe();
  }, [watch, task, expertId, taskId]);

  const completed = task?.status === "COMPLETED";
  const canSubmit = parsed.level2.phases.length > 0;

  async function onSubmit(values: GradingForm) {
    setSubmitError(null);
    if (!taskId) return;
    const id = localStorage.getItem("expertId");
    if (!id) {
      setSubmitError("未登录，请重新登录");
      return;
    }

    const missing = getGradingIncompleteFields(values, parsed);
    if (missing.length > 0) {
      setSubmitError(`还有 ${missing.length} 项未填完，请补全后再提交`);
      requestAnimationFrame(() => scrollToGradingField(missing[0].id));
      return;
    }

    setSubmitting(true);
    try {
      const gradingData = buildGradingPayload(values, parsed);
      const res = await fetch(`/api/tasks/${taskId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expertId: id,
          gradingData,
          discrepancySolvePaths: isTiebreaker ? Array.from(selectedDisc) : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data?.error || `提交失败（${res.status}）`);
        return;
      }
      clearGradingDraft(id, taskId);
      router.push("/dashboard");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function onInvalid() {
    setSubmitError("还有未填完的必填项，已跳转到第一项并用红色标出");
  }

  if (loading || !task) {
    return (
      <main className="app-shell">
        <div className="app-shell-inner muted">正在加载评分表…</div>
      </main>
    );
  }

  const g1 = priorGraders.find((p) => p.graderSlot === 1);
  const g2 = priorGraders.find((p) => p.graderSlot === 2);

  const formPanel = (
    <GradingFormPanel
      parsed={parsed}
      register={register}
      watch={watch}
      setValue={setValue}
      handleSubmit={handleSubmit}
      onSubmit={onSubmit}
      onInvalid={onInvalid}
      errors={{}}
      isValid={formComplete}
      incompleteMessages={incomplete}
      completed={completed}
      canSubmit={canSubmit}
      submitting={submitting}
      formTitle={
        isTiebreaker
          ? `Grader 3 · ${task.expert.expertId} (you)`
          : undefined
      }
    />
  );

  return (
    <main className="app-shell">
      <div
        className="app-shell-inner"
        style={{ maxWidth: isTiebreaker ? 1680 : undefined }}
      >
        <div className="brand-mark">Oral Surgical Grading</div>
        <div className="page-header-row">
          <div>
            <h1 className="page-title">
              评分 · {task.aiOutput.videoOutputId}
              {task.graderSlot ? (
                <span className="muted" style={{ fontSize: 16, fontWeight: 500 }}>
                  {" "}
                  · Grader {task.graderSlot}/3
                </span>
              ) : null}
            </h1>
            <p className="page-lead" style={{ marginBottom: 12 }}>
              {completed
                ? "本任务已提交，以下内容只读保留。"
                : isTiebreaker
                  ? "三位评分表并排对照。前两位分歧项在其表单中黄标；红按钮标记 discrepancy solve（不多数决）。你的表单不显示前两位答案。"
                  : "填写会自动保存在本机。Level 1–3 可对照 AI 输出评分；Level 4 不展示 AI 分数，请独立判断。"}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => router.push("/dashboard")}
          >
            返回
          </button>
        </div>

        {!completed && task.regradeRequestedAt ? (
          <div className="notice notice-warn">
            <strong>Admin 要求重评。</strong>
            {task.regradeNote ? ` ${task.regradeNote}` : " 请重新认真填写后提交。"}
          </div>
        ) : null}

        {completed ? (
          <div className="notice notice-ok">已提交评分（刷新后仍会保留）</div>
        ) : null}

        {!canSubmit ? (
          <div className="notice notice-info">
            Level 2 phases 未解析出来。请在 Admin 重新上传该视频 AI 文本。
          </div>
        ) : null}

        {isTiebreaker && (!g1 || !g2) ? (
          <div className="notice notice-warn">
            前两位评分者尚未都提交完成。请等待他们完成后再进行对照评分。
          </div>
        ) : null}

        {isTiebreaker && selectedDisc.size > 0 ? (
          <div className="notice notice-info">
            已标记 {selectedDisc.size} 项 discrepancy solve（提交时登记，不做 2:1 多数决）
          </div>
        ) : null}

        {submitError ? <div className="notice notice-danger">{submitError}</div> : null}

        {isTiebreaker && g1 && g2 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr) minmax(320px, 1.15fr)",
              gap: 12,
              alignItems: "start",
              overflowX: "auto",
            }}
          >
            <PriorAlignedForm
              title={`Grader 1 · ${g1.expertId} (${g1.name})`}
              parsed={parsed}
              gradingData={g1.gradingData}
              highlightPaths={highlightPaths}
              discrepancySolvePaths={selectedDisc}
              onToggleDiscrepancySolve={toggleDiscSolve}
              showDiscrepancySolve={!completed}
            />
            <PriorAlignedForm
              title={`Grader 2 · ${g2.expertId} (${g2.name})`}
              parsed={parsed}
              gradingData={g2.gradingData}
              highlightPaths={highlightPaths}
              discrepancySolvePaths={selectedDisc}
              onToggleDiscrepancySolve={toggleDiscSolve}
              showDiscrepancySolve={!completed}
            />
            <div>{formPanel}</div>
          </div>
        ) : (
          formPanel
        )}
      </div>
    </main>
  );
}
