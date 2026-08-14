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
  submittedChoice: string | null;
};

type DiscDetail = {
  id: string;
  status: string;
  fieldPath: string;
  fieldLabel: string;
  resolvedValue?: string | null;
  videoOutputId: string;
  parsedData: AiParsedData;
  mySlot: number;
  myExpertId: string;
  graders: GraderCol[];
  progress: {
    submittedCount: number;
    total: number;
    allSubmitted: boolean;
    allSame: boolean;
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

/** Own column: hydrate once per mount; never reset while typing. */
function OwnDiscrepancyColumn({
  parsed,
  initialGradingData,
  fieldPath,
  title,
  highlightPaths,
  domPrefix,
  submitting,
  onSubmit,
}: {
  parsed: AiParsedData;
  initialGradingData: unknown;
  fieldPath: string;
  title: string;
  highlightPaths: Set<string>;
  domPrefix: string;
  submitting: boolean;
  onSubmit: (payload: {
    gradingData: unknown;
    fieldValue: unknown;
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
    } catch (err) {
      // Fall back to patching only the discrepancy field onto existing data
      gradingData =
        saved && typeof saved === "object"
          ? structuredClone(saved)
          : {};
    }

    const fieldValue =
      getCategoricalRaw(gradingData, fieldPath) ??
      readFormPath(values, fieldPath) ??
      (saved ? getCategoricalRaw(saved, fieldPath) : null);

    if (fieldValue != null && fieldValue !== "") {
      setCategoricalRaw(gradingData, fieldPath, fieldValue);
    }

    for (const path of relatedDiscrepancyPaths(fieldPath)) {
      if (path === fieldPath) continue;
      const v =
        getCategoricalRaw(gradingData, path) ?? readFormPath(values, path);
      if (v != null && v !== "") setCategoricalRaw(gradingData, path, v);
    }

    await onSubmit({ gradingData, fieldValue });
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
        {submitting ? "提交中…" : "提交 discrepancy 答案"}
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
  const [ownFormEpoch, setOwnFormEpoch] = useState(0);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const expertId = localStorage.getItem("expertId");
      if (!expertId) {
        router.push("/login");
        return;
      }
      if (!discId) return;
      if (!opts?.quiet) setLoading(true);
      try {
        const res = await fetch(
          `/api/discrepancies/${discId}?expertId=${encodeURIComponent(expertId)}`,
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error || `加载失败（${res.status}）`);
          setDetail(null);
          return;
        }
        setDetail(data);
        setError(null);
      } finally {
        if (!opts?.quiet) setLoading(false);
      }
    },
    [discId, router],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const parsed = detail?.parsedData ?? EMPTY_PARSED;
  const highlightPaths = useMemo(() => {
    if (!detail) return new Set<string>();
    return new Set(relatedDiscrepancyPaths(detail.fieldPath));
  }, [detail]);

  useConsensusRowAlign(Boolean(detail && detail.status === "OPEN"), "[data-consensus-align-root]", [
    detail?.fieldPath,
    detail?.progress.submittedCount,
  ]);

  async function onSubmit(payload: {
    gradingData: unknown;
    fieldValue: unknown;
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
          fieldValue: payload.fieldValue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `提交失败（${res.status}）`);
        return;
      }
      if (data.resolved) {
        setInfo(`三人答案一致，discrepancy 已解决（${data.resolvedValue}）`);
        setTimeout(() => router.push("/dashboard"), 1200);
        return;
      }
      setInfo(
        `已提交你的答案（${data.submittedCount}/${data.total}）。需三人答案完全相同才会关闭。`,
      );
      await load({ quiet: true });
      setOwnFormEpoch((n) => n + 1);
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
          {error || "正在加载 discrepancy…"}
        </div>
      </main>
    );
  }

  const g1 = detail.graders.find((g) => g.graderSlot === 1);
  const g2 = detail.graders.find((g) => g.graderSlot === 2);
  const g3 = detail.graders.find((g) => g.graderSlot === 3);
  const cols = [g1, g2, g3];

  const resolved = detail.status !== "OPEN";
  const myExpertId = detail.myExpertId;

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
              题目：<strong>{detail.fieldLabel}</strong>
              。三表并排对照（与第 3 评分者相同）。你只能修改自己的一列。
              三人提交完全相同答案后，该项才会从 Dashboard 消失。
              进度：{detail.progress.submittedCount}/{detail.progress.total}
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

        {resolved ? (
          <div className="notice notice-ok">
            已解决：{detail.resolvedValue ?? "—"}
          </div>
        ) : null}
        {error ? <div className="notice notice-danger">{error}</div> : null}
        {info ? <div className="notice notice-info">{info}</div> : null}

        <div
          className="notice"
          style={{
            marginBottom: 12,
            background: "#fce7f3",
            border: "1px solid #f9a8d4",
            color: "#9d174d",
          }}
        >
          粉标为 discrepancy 字段。请在自己的表单中给出答案后点「提交 discrepancy 答案」。
        </div>

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
                  Grader {g?.graderSlot ?? "?"} 尚未分派
                </div>
              );
            }
            const isMine = g.expertId === myExpertId;
            const title = `Grader ${g.graderSlot} · ${g.expertId} (${g.name})${
              g.submittedForDiscrepancy ? " · 已提交" : ""
            }${isMine ? " · 你" : ""}`;

            if (!isMine || resolved) {
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
                key={`${detail.id}-${myExpertId}-${ownFormEpoch}`}
                parsed={parsed}
                initialGradingData={g.gradingData}
                fieldPath={detail.fieldPath}
                title={title}
                highlightPaths={highlightPaths}
                domPrefix={`g${g.graderSlot}`}
                submitting={submitting}
                onSubmit={onSubmit}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}
