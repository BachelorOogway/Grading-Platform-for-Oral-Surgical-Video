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

type GraderCol = {
  taskAssignmentId: string;
  graderSlot: number;
  expertId: string;
  name: string;
  gradingData: unknown;
  submittedForDiscrepancy: boolean;
  submittedPaths?: string[];
  solvingResultsLabel?: string | null;
};

type OpenItemProgress = {
  id: string;
  fieldPath: string;
  fieldLabel: string;
  submittedCount: number;
  total: number;
  allSame: boolean;
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
  progress: {
    openFieldCount: number;
    expertsSubmittedCount: number;
    totalExperts: number;
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
      setInfo("Submission successful");
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
              (pink). Edit only your column, then submit once. After you submit,
              you return to the Dashboard; other experts will see your answers as
              solving results.
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
              </li>
            ))}
          </ul>
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Experts finished this round:{" "}
            {detail.progress.expertsSubmittedCount}/
            {detail.progress.totalExperts}
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
              const title = `Grader ${g.graderSlot} · ${g.expertId} (${g.name})${
                isMine ? " · you" : ""
              }`;

              if (!isMine) {
                return (
                  <PriorAlignedForm
                    key={g.graderSlot}
                    title={title}
                    parsed={parsed}
                    gradingData={g.gradingData}
                    highlightPaths={highlightPaths}
                    domPrefix={`g${g.graderSlot}`}
                    solvingResultsLabel={g.solvingResultsLabel}
                  />
                );
              }

              return (
                <div key={g.graderSlot}>
                  {g.solvingResultsLabel ? (
                    <div
                      style={{
                        background: "#fce7f3",
                        border: "1px solid #f9a8d4",
                        color: "#9d174d",
                        borderRadius: 8,
                        padding: "8px 10px",
                        marginBottom: 8,
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {g.solvingResultsLabel} (you can update and resubmit)
                    </div>
                  ) : null}
                  <OwnDiscrepancyColumn
                    parsed={parsed}
                    initialGradingData={g.gradingData}
                    fieldPaths={fieldPaths}
                    title={title}
                    highlightPaths={highlightPaths}
                    domPrefix={`g${g.graderSlot}`}
                    submitting={submitting}
                    onSubmit={onSubmit}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
