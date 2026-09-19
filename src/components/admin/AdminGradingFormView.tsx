"use client";

import type { ReactNode } from "react";

function yn(v: unknown): string {
  if (v === true || v === "correct" || v === "yes" || v === "Yes") return "Correct / Yes";
  if (v === false || v === "incorrect" || v === "no" || v === "No") return "Incorrect / No";
  if (v === "pass" || v === "Pass") return "Pass";
  if (v === "fail" || v === "Fail") return "Fail";
  if (v === "hallucinate") return "Not Mentioned but Hallucinate";
  if (v === "missed") return "Mentioned but Missed";
  if (v == null || v === "") return "—";
  return String(v);
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="admin-form-row">
      <span className="admin-form-row-label">{label}</span>
      <span className="admin-form-row-value">{value}</span>
    </div>
  );
}

export function AdminGradingFormView({ gradingData }: { gradingData: any }) {
  if (!gradingData || typeof gradingData !== "object") {
    return <div className="muted">无评分内容</div>;
  }

  const l1 = gradingData.level1 ?? {};
  const l2 = gradingData.level2 ?? {};
  const l3 = gradingData.level3 ?? {};
  const l4 = gradingData.level4 ?? {};
  const l5 = gradingData.level5 ?? {};
  const structures: any[] = Array.isArray(l1.structures) ? l1.structures : [];
  const instruments: any[] = Array.isArray(l1.instruments) ? l1.instruments : [];
  const phases: any[] = Array.isArray(l2.phases) ? l2.phases : [];
  const dimensions: any[] = Array.isArray(l4.dimensions) ? l4.dimensions : [];
  const l5Dims: any[] = Array.isArray(l5.dimensions) ? l5.dimensions : [];

  return (
    <div className="admin-form-view">
      <section>
        <h4>Level 1 — Perception</h4>
        <Row label="Procedure Type" value={yn(l1.procedureTypeCorrect)} />
        <Row label="Spatial Positioning" value={yn(l1.spatialPositioningCorrect)} />
        <Row
          label="Structures"
          value={`${l1.structureCorrectCount ?? "—"}/${l1.structureTotalCount ?? structures.length} correct · wrong ${l1.wrongStructuresCount ?? "—"}`}
        />
        {structures.length > 0 ? (
          <ul className="admin-form-list">
            {structures.map((s, i) => (
              <li key={i}>
                {s.name || `Structure ${i + 1}`}: {yn(s.correct)}
                {s.incorrectReason ? ` (${s.incorrectReason})` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        <Row
          label="Instruments"
          value={`${l1.instrumentCorrectCount ?? "—"}/${l1.instrumentTotalCount ?? instruments.length} correct · missed ${l1.missedInstrumentsCount ?? "—"}`}
        />
        {instruments.length > 0 ? (
          <ul className="admin-form-list">
            {instruments.map((s, i) => (
              <li key={i}>
                {s.name || `Instrument ${i + 1}`}: {yn(s.correct)}
                {s.incorrectReason ? ` (${s.incorrectReason})` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h4>Level 2 — Workflow</h4>
        <Row
          label="AI Missed Phases Count"
          value={String(l2.aiMissedPhasesCount ?? "—")}
        />
        <Row
          label="Expert Missed Phases Count"
          value={String(l2.missedPhasesCount ?? "—")}
        />
        <Row
          label="Missed Phase Content"
          value={yn(l2.missedStepsDetectedCorrect)}
        />
        {l2.metrics ? (
          <Row
            label="Metrics"
            value={`mIoU ${l2.metrics.meanTemporalIoU ?? "—"} · contentAcc ${l2.metrics.contentAccuracy ?? "—"}`}
          />
        ) : null}
        {phases.length > 0 ? (
          <ul className="admin-form-list">
            {phases.map((p, i) => (
              <li key={i}>
                <strong>Phase {i + 1}:</strong> {p.description || "—"}
                <br />
                AI {p.aiStartTime || "?"}–{p.aiEndTime || "?"} · True{" "}
                {p.trueStartTime || "?"}–{p.trueEndTime || "?"}
                <br />
                Seg {yn(p.segmentationCorrect)} · Content {yn(p.contentCorrect)}
                {p.phaseErrorType ? ` · ${p.phaseErrorType}` : ""}
                {p.temporalIoU != null ? ` · tIoU ${p.temporalIoU}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h4>Level 3 — Clinical Reasoning</h4>
        <Row label="Surgery Completed (expert)" value={yn(l3.surgeryCompleted)} />
        <Row label="Next Action Accurate" value={yn(l3.nextActionAccurate)} />
        <Row label="Nomenclature" value={yn(l3.nomenclatureStandardized)} />
        <Row label="Safety Check" value={yn(l3.safetyCheckPass)} />
        <Row label="Hallucination Notes" value={l3.hallucinationNotes || "—"} />
      </section>

      <section>
        <h4>Level 4 — OSATS</h4>
        <Row
          label="Hallucination Rate"
          value={
            l4.hallucinationRate != null
              ? `${(Number(l4.hallucinationRate) * 100).toFixed(1)}% (${l4.hallucinationYesCount ?? "—"}/${l4.hallucinationTotalCount ?? "—"})`
              : "—"
          }
        />
        {dimensions.length === 0 ? (
          <div className="muted">无维度数据</div>
        ) : (
          <ul className="admin-form-list">
            {dimensions.map((d) => (
              <li key={d.key || d.label}>
                {d.label || d.key}: AI {d.aiScore ?? "—"} · expert{" "}
                {d.expertScore ?? "—"} · hallucination{" "}
                {yn(d.aiJustificationHallucination)}
                {d.aiJustification ? (
                  <div className="muted" style={{ marginTop: 4 }}>
                    {d.aiJustification}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>Level 5 — 手术报告</h4>
        <Row
          label="Report score (Correct count)"
          value={
            l5.reportScore != null
              ? `${l5.reportScore} / ${l5.dimensionTotal ?? l5Dims.length}`
              : "—"
          }
        />
        {l5.report ? (
          <div className="muted" style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>
            {String(l5.report).slice(0, 800)}
            {String(l5.report).length > 800 ? "…" : ""}
          </div>
        ) : null}
        {l5Dims.length === 0 ? (
          <div className="muted">无 Level 5 判定</div>
        ) : (
          <ul className="admin-form-list">
            {l5Dims.map((d) => (
              <li key={d.key || d.label}>
                {d.label || d.key}: {yn(d.judgement)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
