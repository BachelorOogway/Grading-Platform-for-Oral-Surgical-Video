"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { AiParsedData } from "@/lib/aiOutputParser";
import {
  buildGradingPayload,
  hydrateGradingForm,
  type GradingForm,
} from "@/lib/gradingForm";
import {
  getCategoricalRaw,
  relatedDiscrepancyPaths,
  setCategoricalRaw,
} from "@/lib/categoricalFields";
import { parseJsonSafe } from "@/lib/json";
import { GradingFormPanel } from "@/components/grading/GradingFormPanel";
import { PriorAlignedForm } from "@/components/grading/PriorAlignedForm";
import { useConsensusRowAlign } from "@/components/grading/useConsensusRowAlign";

type SubmittedAnswer = {
  fieldPath: string;
  fieldLabel: string;
  choice: string;
  value: unknown;
  submittedAt: string;
};

type GraderCol = {
  taskAssignmentId: string;
  graderSlot: number;
  expertId: string;
  name: string;
  gradingData: unknown;
  submittedForDiscrepancy: boolean;
  submittedPaths?: string[];
  submittedAnswers?: SubmittedAnswer[];
  solvingResultsLabel?: string | null;
};

type OpenItemProgress = {
  id: string;
  fieldPath: string;
  fieldLabel: string;
  submittedCount: number;
  total: number;
  allSame: boolean;
  contested?: boolean;
  isTiming?: boolean;
  mySubmitted: boolean;
};

type DiscDetail = {
  id: string;
  status: string;
  videoOutputId: string;
  parsedData: AiParsedData;
  mySlot: number;
  myExpertId: string;
  items: Array<{
    id: string;
    fieldPath: string;
    fieldLabel: string;
    status: string;
  }>;
  openItems: OpenItemProgress[];
  highlightPaths: string[];
  graders: GraderCol[];
  timingThresholdSec?: number;
  progress: {
    openFieldCount: number;
    expertsSubmittedCount: number;
    totalExperts: number;
    contestedCount?: number;
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

function readFormPath(values: GradingForm, path: string): unknown {
  const parts = path.split(".");
  let cur: any = values;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  if (cur === "correct" || cur === "yes" || cur === "pass") return true;
  if (cur === "incorrect" || cur === "no" || cur === "fail") return false;
  return cur ?? null;
}

function asGradingObject(raw: unknown): unknown {
  if (typeof raw === "string") return parseJsonSafe(raw, null);
  return raw;
}

/** Whether a grader column already reflects that grader's solve answers. */
function hasSolved(g: GraderCol | null | undefined): boolean {
  return Boolean(g?.expertId) && (g?.submittedAnswers?.length ?? 0) > 0;
}

function OwnDiscrepancyColumn({
  parsed,
  initialGradingData,
  fieldPaths,
  title,
  highlightPaths,
  domPrefix,
  submitting,
  onSubmit,
}: {
  parsed: AiParsedData;
  initialGradingData: unknown;
  fieldPaths: string[];
  title: string;
  highlightPaths: Set<string>;
  domPrefix: string;
  submitting: boolean;
  onSubmit: (payload: {
    gradingData: unknown;
    fieldValues: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const saved = asGradingObject(initialGradingData);
  const { register, handleSubmit, watch, setValue, getValues } =
    useForm<GradingForm>({
      defaultValues: hydrateGradingForm(parsed, saved),
      mode: "onChange",
      shouldUnregister: false,
    });

  async function submitNow() {
    const values = getValues();
    let gradingData: any;
    try {
      gradingData = buildGradingPayload(values, parsed);
    } catch {
      gradingData =
        saved && typeof saved === "object" ? structuredClone(saved) : {};
    }

    const fieldValues: Record<string, unknown> = {};
    for (const fieldPath of fieldPaths) {
      const fieldValue =
        getCategoricalRaw(gradingData, fieldPath) ??
        readFormPath(values, fieldPath) ??
        (saved ? getCategoricalRaw(saved, fieldPath) : null);
      if (fieldValue != null && fieldValue !== "") {
        setCategoricalRaw(gradingData, fieldPath, fieldValue);
        fieldValues[fieldPath] = fieldValue;
      }
      for (const path of relatedDiscrepancyPaths(fieldPath)) {
        if (path === fieldPath) continue;
        const v =
          getCategoricalRaw(gradingData, path) ?? readFormPath(values, path);
        if (v != null && v !== "") setCategoricalRaw(gradingData, path, v);
      }
    }

    await onSubmit({ gradingData, fieldValues });
  }

  return (
    <div>
      <GradingFormPanel
        parsed={parsed}
        register={register}
        watch={watch}
        setValue={setValue}
        handleSubmit={handleSubmit}
        onSubmit={() => void submitNow()}
        errors={{}}
        isValid
        incompleteMessages={[]}
        completed={false}
        canSubmit={false}
        submitting={submitting}
        formTitle={title}
        domPrefix={domPrefix}
        hideLiveMetrics
        hideSubmit
        highlightPaths={highlightPaths}
        showDiscrepancySolve={false}
      />
      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 8 }}
        disabled={submitting}
        onClick={() => void submitNow()}
      >
        {submitting ? "Submitting…" : "Submit discrepancy answers"}
      </button>
    </div>
  );
}

export default function DiscrepancyResolvePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const discId = params.id;

  const [detail, setDetail] = useState<DiscDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    const expertId = localStorage.getItem("expertId");
    if (!expertId) {
      router.push("/login");
      return;
    }
    if (!discId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/discrepancies/${discId}?expertId=${encodeURIComponent(expertId)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Load failed (${res.status})`);
        setDetail(null);
        return;
      }
      setDetail(data);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [discId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsed = detail?.parsedData ?? EMPTY_PARSED;
  const fieldPaths = useMemo(
    () => (detail?.openItems ?? []).map((d) => d.fieldPath),
    [detail],
  );
  const highlightPaths = useMemo(() => {
    if (!detail) return new Set<string>();
    if (Array.isArray(detail.highlightPaths) && detail.highlightPaths.length) {
      return new Set(detail.highlightPaths);
    }
    return new Set(fieldPaths.flatMap((p) => relatedDiscrepancyPaths(p)));
  }, [detail, fieldPaths]);

  useConsensusRowAlign(Boolean(detail && fieldPaths.length > 0), "[data-consensus-align-root]", [
    fieldPaths.join("|"),
    detail?.progress.expertsSubmittedCount,
  ]);

  async function onSubmit(payload: {
    gradingData: unknown;
    fieldValues: Record<string, unknown>;
  }) {
    if (!detail) return;
    const expertId = localStorage.getItem("expertId");
    if (!expertId) return;
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/discrepancies/${detail.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expertId,
          gradingData: payload.gradingData,
          fieldValues: payload.fieldValues,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Submit failed (${res.status})`);
        return;
      }
      const contested: Array<{ fieldLabel: string }> = Array.isArray(
        data?.contestedFields,
      )
        ? data.contestedFields
        : [];
      const resolvedCount = Number(data?.resolvedFieldCount ?? 0);
      if (contested.length > 0) {
        // Staying put: another round is needed, so sending them to the
        // Dashboard would hide the fields they have to renegotiate.
        setInfo("Submission successful");
        setError(
          `仍有 ${contested.length} 项三人未达成一致（${contested
            .map((c) => c.fieldLabel)
            .join("、")}），请协商后重新提交。`,
        );
        await load();
        return;
      }
      setInfo(
        resolvedCount > 0
          ? `Submission successful — ${resolvedCount} field(s) resolved (answers already agreed).`
          : "Submission successful",
      );
      setTimeout(() => {
        router.push("/dashboard?discSubmitted=1");
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !detail) {
    return (
      <main className="app-shell">
        <div className="app-shell-inner muted">
          {error || "Loading discrepancy…"}
        </div>
      </main>
    );
  }

  const g1 = detail.graders.find((g) => g.graderSlot === 1);
  const g2 = detail.graders.find((g) => g.graderSlot === 2);
  const g3 = detail.graders.find((g) => g.graderSlot === 3);
  const cols = [g1, g2, g3];
  const myExpertId = detail.myExpertId;
  const noOpen = fieldPaths.length === 0;
  const othersSolvedCount = detail.graders.filter(
    (g) => g.expertId !== myExpertId && hasSolved(g),
  ).length;

  return (
    <main className="app-shell">
      <div className="app-shell-inner" style={{ maxWidth: 1680 }}>
        <div className="brand-mark">Oral Surgical Grading</div>
        <div className="page-header-row">
          <div>
            <h1 className="page-title">
              Discrepancy solve · {detail.videoOutputId}
            </h1>
            <p className="page-lead" style={{ marginBottom: 12 }}>
              All open discrepancy fields for this video are shown in one form
              (pink). Edit only your column, then submit once. As soon as the
              three experts&apos; answers already agree (exact match for
              choices; start/end times within 3s), that field is marked solved —
              later experts do not need to submit it. After you submit, you
              return to the Dashboard when nothing contested remains.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => router.push("/dashboard")}
          >
            Back
          </button>
        </div>

        {error ? <div className="notice notice-danger">{error}</div> : null}
        {info ? <div className="notice notice-ok">{info}</div> : null}

        {(detail.progress.contestedCount ?? 0) > 0 ? (
          <div className="notice notice-danger">
            <strong>
              有 {detail.progress.contestedCount} 项三位专家均已提交但仍未达成一致。
            </strong>{" "}
              选择题必须三人答案完全相同；时间窗口需任意两人相差不超过{" "}
            {detail.timingThresholdSec ?? 3}{" "}
            秒。一旦三位专家当前答案已一致，该字段会立即标记为已解决，不必等第三人再提交。这些项会继续以粉色标出，请协商后重新提交。
          </div>
        ) : null}

        <div
          className="notice"
          style={{
            marginBottom: 12,
            background: "#fce7f3",
            border: "1px solid #f9a8d4",
            color: "#9d174d",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Open fields on this form ({detail.openItems.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {detail.openItems.map((d) => (
              <li key={d.id} style={{ marginBottom: 4 }}>
                {d.fieldLabel}
                <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                  submitted {d.submittedCount}/{d.total}
                  {d.mySubmitted ? " · you submitted" : ""}
                </span>
                {d.contested ? (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--danger-line, #b91c1c)",
                    }}
                  >
                    · 三人均已提交但仍未一致，需再次协商提交
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Experts finished this round:{" "}
            {detail.progress.expertsSubmittedCount}/
            {detail.progress.totalExperts}
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            {othersSolvedCount > 0
              ? `其他专家中已有 ${othersSolvedCount} 位提交了 discrepancy solve — 他们那一列显示的是 solve 之后的结果。`
              : "其他专家尚未提交 discrepancy solve — 他们那两列显示的是 solve 之前的原始评分。"}
          </div>
        </div>

        {noOpen ? (
          <div className="notice notice-ok">
            No open discrepancies left on this video.
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginLeft: 12 }}
              onClick={() => router.push("/dashboard")}
            >
              Back to Dashboard
            </button>
          </div>
        ) : (
          <div
            data-consensus-align-root
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(280px, 1fr) minmax(280px, 1fr) minmax(320px, 1.15fr)",
              gap: 12,
              alignItems: "start",
              overflowX: "auto",
            }}
          >
            {cols.map((g) => {
              if (!g || !g.expertId) {
                return (
                  <div
                    key={`empty-${g?.graderSlot ?? "x"}`}
                    className="section-block muted"
                  >
                    Grader {g?.graderSlot ?? "?"} not assigned
                  </div>
                );
              }
              const isMine = g.expertId === myExpertId;
              const stage = hasSolved(g)
                ? "after discrepancy solve"
                : "before discrepancy solve";
              const title = `Grader ${g.graderSlot} · ${g.expertId} (${g.name})${
                isMine ? " · you" : ""
              } · ${stage}`;

              if (!isMine) {
                return (
                  <PriorAlignedForm
                    key={g.graderSlot}
                    title={title}
                    parsed={parsed}
                    gradingData={g.gradingData}
                    highlightPaths={highlightPaths}
                    domPrefix={`g${g.graderSlot}`}
                  />
                );
              }

              return (
                <OwnDiscrepancyColumn
                  key={g.graderSlot}
                  parsed={parsed}
                  initialGradingData={g.gradingData}
                  fieldPaths={fieldPaths}
                  title={title}
                  highlightPaths={highlightPaths}
                  domPrefix={`g${g.graderSlot}`}
                  submitting={submitting}
                  onSubmit={onSubmit}
                />
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
