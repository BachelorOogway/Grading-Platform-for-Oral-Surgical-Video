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

type TaskDetail = {
  taskAssignmentId: string;
  status: "PENDING" | "COMPLETED";
  expert: { expertId: string; name: string };
  regradeNote?: string | null;
  regradeRequestedAt?: string | null;
  aiOutput: {
    videoOutputId: string;
    rawText: string;
    parsedData: AiParsedData;
  };
  gradingResult: any | null;
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
  level2: { phases: [], totalPhases: null, missedStepsEvaluation: "" },
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

    // After admin return-for-regrade, drop the previous local draft once.
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
        body: JSON.stringify({ expertId: id, gradingData }),
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

  return (
    <main className="app-shell">
      <div className="app-shell-inner">
        <div className="brand-mark">Oral Surgical Grading</div>
        <div className="page-header-row">
          <div>
            <h1 className="page-title">评分 · {task.aiOutput.videoOutputId}</h1>
            <p className="page-lead" style={{ marginBottom: 12 }}>
              {completed
                ? "本任务已提交，以下内容只读保留。"
                : "填写会自动保存在本机。AI 输出已嵌在各项旁，方便对照评分。"}
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

        {submitError ? <div className="notice notice-danger">{submitError}</div> : null}

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
        />
      </div>
    </main>
  );
}
