"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
  UseFormRegister,
  FieldErrors,
  UseFormHandleSubmit,
  UseFormWatch,
  UseFormSetValue,
} from "react-hook-form";
import type { AiParsedData } from "@/lib/aiOutputParser";
import {
  computeLevel2ContentMetrics,
  computeLevel2TemporalMetrics,
  formatIoU,
  temporalIoU,
} from "@/lib/temporalMetrics";
import {
  buildLevel1LiveMetrics,
  countIncorrectItems,
  filledStringList,
  formatMetric,
  getGradingIncompleteFields,
  gradingFieldDomId,
  scrollToGradingField,
  type GradingForm,
} from "@/lib/gradingForm";
import { computeLevel4HallucinationRate } from "@/lib/level4Metrics";
import { LEVEL4_DIMENSIONS } from "@/lib/level4Dimensions";
import { MissedItemsField } from "@/components/grading/MissedItemsField";

const FormDomPrefixContext = createContext("");

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

function FieldAnchor({
  id,
  error,
  highlight = false,
  children,
  style,
  className = "",
  alignKey,
}: {
  id: string;
  error: boolean;
  highlight?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  alignKey?: string;
}) {
  const domPrefix = useContext(FormDomPrefixContext);
  const keyedId = domPrefix ? `${domPrefix}-${id}` : id;
  const rowKey = alignKey ?? id;
  return (
    <div
      id={gradingFieldDomId(keyedId)}
      data-align-key={rowKey}
      className={`${className}${error ? " grading-error" : ""}${
        highlight ? " grading-consensus-hot" : ""
      }`.trim()}
      style={{
        ...style,
        ...(highlight
          ? {
              background: "#fef9c3",
              boxShadow: "inset 0 0 0 1px #eab308",
              borderRadius: 8,
            }
          : null),
      }}
    >
      {children}
      {error ? <div className="grading-error-hint">?????????</div> : null}
    </div>
  );
}

function DiscrepancySolveRadio({
  selected,
  onToggle,
}: {
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginTop: 8,
        color: "#dc2626",
        fontWeight: 700,
        fontSize: 13,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <input
        type="radio"
        checked={selected}
        onClick={(e) => {
          e.preventDefault();
          onToggle();
        }}
        onChange={() => {}}
        style={{
          accentColor: "#dc2626",
          width: 15,
          height: 15,
          cursor: "pointer",
        }}
      />
      discrepancy solve
    </label>
  );
}
function CorrectIncorrect({
  legend,
  name,
  register,
  disabled,
  onCorrectChange,
}: {
  legend: string;
  name: string;
  register: UseFormRegister<GradingForm>;
  disabled?: boolean;
  onCorrectChange?: (value: "correct" | "incorrect") => void;
}) {
  const reg = register(name as any, { required: true });
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="choice-legend">{legend}</legend>
      <div className="choice-row">
        <label>
          <input
            type="radio"
            value="correct"
            {...reg}
            disabled={disabled}
            onChange={(e) => {
              reg.onChange(e);
              onCorrectChange?.("correct");
            }}
          />
          Correct
        </label>
        <label>
          <input
            type="radio"
            value="incorrect"
            {...reg}
            disabled={disabled}
            onChange={(e) => {
              reg.onChange(e);
              onCorrectChange?.("incorrect");
            }}
          />
          Incorrect
        </label>
      </div>
    </fieldset>
  );
}

function IncorrectReasonRadios({
  name,
  register,
  disabled,
  required,
}: {
  name: string;
  register: UseFormRegister<GradingForm>;
  disabled?: boolean;
  required: boolean;
}) {
  const reg = register(name as any, {
    validate: (v) => {
      if (!required) return true;
      return (
        v === "hallucination_absent" ||
        v === "misrecognition_present" ||
        "Please select a reason"
      );
    },
  });

  return (
    <div className="grading-reason">
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warn)" }}>
        Why is this Incorrect?
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
        <input
          type="radio"
          value="hallucination_absent"
          {...reg}
          disabled={disabled}
          style={{ marginTop: 2 }}
        />
        <span>hallucinates when the target is absent</span>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
        <input
          type="radio"
          value="misrecognition_present"
          {...reg}
          disabled={disabled}
          style={{ marginTop: 2 }}
        />
        <span>misrecognition when the target is present</span>
      </label>
    </div>
  );
}

type Props = {
  parsed: AiParsedData;
  register: UseFormRegister<GradingForm>;
  watch: UseFormWatch<GradingForm>;
  setValue: UseFormSetValue<GradingForm>;
  handleSubmit: UseFormHandleSubmit<GradingForm>;
  onSubmit: (v: GradingForm) => void;
  onInvalid?: () => void;
  errors: FieldErrors<GradingForm>;
  isValid: boolean;
  incompleteMessages?: string[];
  completed: boolean;
  canSubmit: boolean;
  submitting?: boolean;
  /** Categorical paths where grader1 ? grader2 (yellow highlight) */
  highlightPaths?: Set<string>;
  discrepancySolvePaths?: Set<string>;
  showDiscrepancySolve?: boolean;
  onToggleDiscrepancySolve?: (path: string) => void;
  formTitle?: string;
  hideSubmit?: boolean;
  domPrefix?: string;
  hideLiveMetrics?: boolean;
};

export function GradingFormPanel({
  parsed,
  register,
  watch,
  setValue,
  handleSubmit,
  onSubmit,
  onInvalid,
  isValid,
  incompleteMessages = [],
  completed,
  canSubmit,
  submitting = false,
  highlightPaths,
  discrepancySolvePaths,
  showDiscrepancySolve = false,
  onToggleDiscrepancySolve,
  formTitle,
  hideSubmit = false,
  domPrefix = "",
  hideLiveMetrics = false,
}: Props) {
  const l1 = parsed.level1;
  const l2 = parsed.level2;
  const [showErrors, setShowErrors] = useState(false);
  const [jumpToId, setJumpToId] = useState<string | null>(null);

  const watchedStructures = watch("level1.structures");
  const watchedInstruments = watch("level1.instruments");
  const formSnapshot = watch();

  const incompleteFields = useMemo(
    () => getGradingIncompleteFields(formSnapshot, parsed),
    [formSnapshot, parsed],
  );
  const errorIds = useMemo(() => {
    if (!showErrors) return new Set<string>();
    return new Set(incompleteFields.map((f) => f.id));
  }, [showErrors, incompleteFields]);
  const hasError = (id: string) => errorIds.has(id);
  const isHot = (path: string) => Boolean(highlightPaths?.has(path));
  function DiscSolve({ path }: { path: string }) {
    if (!showDiscrepancySolve || !onToggleDiscrepancySolve || !isHot(path)) {
      return null;
    }
    return (
      <DiscrepancySolveRadio
        selected={Boolean(discrepancySolvePaths?.has(path))}
        onToggle={() => onToggleDiscrepancySolve(path)}
      />
    );
  }

  const structureWrong = countIncorrectItems(watchedStructures);
  const instrumentWrong = countIncorrectItems(watchedInstruments);

  useEffect(() => {
    if (completed) return;
    setValue("level1.wrongStructuresCount", structureWrong, {
      shouldValidate: true,
      shouldDirty: true,
    });
  }, [structureWrong, setValue, completed]);

  useEffect(() => {
    if (completed) return;
    setValue("level1.wrongInstrumentsCount", instrumentWrong, {
      shouldValidate: true,
      shouldDirty: true,
    });
  }, [instrumentWrong, setValue, completed]);

  const watchedMissedInstruments = watch("level1.missedInstruments") ?? [""];
  const watchedMissedPhases = watch("level2.missedPhases") ?? [""];

  useEffect(() => {
    if (completed) return;
    const n = filledStringList(watchedMissedInstruments).length;
    setValue("level1.missedInstrumentsCount", n, {
      shouldValidate: true,
      shouldDirty: true,
    });
  }, [watchedMissedInstruments, setValue, completed]);

  useEffect(() => {
    if (completed) return;
    const n = filledStringList(watchedMissedPhases).length;
    setValue("level2.missedPhasesCount", n, {
      shouldValidate: true,
      shouldDirty: true,
    });
  }, [watchedMissedPhases, setValue, completed]);

  // Jump after red highlights paint
  useEffect(() => {
    if (!jumpToId || !showErrors) return;
    const id = jumpToId;
    const timer = window.setTimeout(() => {
      scrollToGradingField(id);
      setJumpToId(null);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [jumpToId, showErrors, errorIds]);

  const metrics = buildLevel1LiveMetrics(formSnapshot);

  function revealMissingAndJump(values?: GradingForm) {
    const missing = getGradingIncompleteFields(values ?? formSnapshot, parsed);
    if (missing.length > 0) {
      setShowErrors(true);
      setJumpToId(missing[0].id);
      onInvalid?.();
    } else {
      setShowErrors(false);
      setJumpToId(null);
    }
    return missing;
  }

  function handleValidationFail() {
    revealMissingAndJump();
  }

  function handleValidSubmit(values: GradingForm) {
    const missing = revealMissingAndJump(values);
    if (missing.length > 0) return;
    onSubmit(values);
  }

  function onClickSubmit() {
    if (completed || !canSubmit || submitting) return;
    const missing = revealMissingAndJump();
    if (missing.length > 0) return;
    void handleSubmit(handleValidSubmit, handleValidationFail)();
  }

  const incompleteBanner =
    !completed && showErrors && incompleteFields.length > 0 ? (
      <div className="notice notice-danger" style={{ borderWidth: 2, borderColor: "#e11d48" }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: "#be123c" }}>
          ?? {incompleteFields.length} ????????????? ?????
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 180, overflow: "auto" }}>
          {incompleteFields.map((m) => (
            <li key={m.id} style={{ marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => scrollToGradingField(m.id)}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "#be123c",
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                {m.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <FormDomPrefixContext.Provider value={domPrefix}>
    <form
      id={gradingFieldDomId("form-root")}
      onSubmit={(e) => {
        e.preventDefault();
        onClickSubmit();
      }}
      style={{ opacity: completed ? 0.7 : 1 }}
    >
      {formTitle ? (
        <div
          className="section-title"
          data-align-key="form-title"
          style={{
            fontSize: 15,
            marginBottom: 10,
            paddingBottom: 8,
            borderBottom: "1px solid var(--line)",
          }}
        >
          {formTitle}
        </div>
      ) : null}
      {incompleteBanner}
      <div className="grading-card">
        <div className="grading-card-title">Level 1 ? Perception</div>

        <FieldAnchor
          id="l1-procedureType"
          error={hasError("l1-procedureType")}
          highlight={isHot("level1.procedureTypeCorrect")}
          className="grading-sub"
        >
          <DiscSolve path="level1.procedureTypeCorrect" />
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Procedure Type</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: "var(--ink)" }}>
            AI: {l1.procedureType || "?"}
          </div>
          <CorrectIncorrect
            legend="Correct / Incorrect"
            name="level1.procedureTypeCorrect"
            register={register}
            disabled={completed}
            onCorrectChange={(v) => {
              if (v === "correct") {
                setValue("level1.procedureTypeCorrection", "", { shouldValidate: true });
              }
            }}
          />
          {watch("level1.procedureTypeCorrect") === "incorrect" ? (
            <FieldAnchor
              id="l1-procedureType-correction"
              error={hasError("l1-procedureType-correction")}
              style={{ marginTop: 8 }}
            >
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                Correct procedure type
                <input
                  type="text"
                  {...register("level1.procedureTypeCorrection", { required: true })}
                  disabled={completed}
                  placeholder="Enter the correct procedure type"
                  style={{
                    padding: 10,
                    border: hasError("l1-procedureType-correction")
                      ? "1px solid var(--danger-line)"
                      : undefined,
                  }}
                />
              </label>
            </FieldAnchor>
          ) : null}
        </FieldAnchor>

        <div className="grading-section-title">
          Anatomical and Pathological Structures
          {l1.totalStructures != null ? ` (Total: ${l1.totalStructures})` : ""}
        </div>
        {l1.structures.map((s, i) => {
          const isIncorrect = watchedStructures?.[i]?.correct === "incorrect";
          const structErr =
            hasError(`l1-structure-${i}`) || hasError(`l1-structure-${i}-reason`);
          return (
            <FieldAnchor
              key={i}
              id={`l1-structure-${i}`}
              error={structErr}
              highlight={
                isHot(`level1.structures.${i}.correct`) ||
                isHot(`level1.structures.${i}.incorrectReason`)
              }
              className="grading-sub"
            >
              <DiscSolve path={`level1.structures.${i}.correct`} />
              <DiscSolve path={`level1.structures.${i}.incorrectReason`} />
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{s.name}</div>
              <CorrectIncorrect
                legend="Structure Correct / Incorrect"
                name={`level1.structures.${i}.correct`}
                register={register}
                disabled={completed}
                onCorrectChange={(v) => {
                  if (v === "correct") {
                    setValue(`level1.structures.${i}.incorrectReason` as any, "", {
                      shouldValidate: true,
                    });
                    setValue(`level1.structures.${i}.expertCorrection` as any, "", {
                      shouldValidate: true,
                    });
                  }
                }}
              />
              {isIncorrect ? (
                <div id={gradingFieldDomId(`l1-structure-${i}-reason`)}>
                  <IncorrectReasonRadios
                    name={`level1.structures.${i}.incorrectReason`}
                    register={register}
                    disabled={completed}
                    required
                  />
                </div>
              ) : null}
              {isIncorrect &&
              watchedStructures?.[i]?.incorrectReason === "misrecognition_present" ? (
                <FieldAnchor
                  id={`l1-structure-${i}-correction`}
                  error={hasError(`l1-structure-${i}-correction`)}
                  style={{ marginTop: 8 }}
                >
                  <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                    Correct structure name
                    <input
                      type="text"
                      {...register(`level1.structures.${i}.expertCorrection` as any, {
                        required: true,
                      })}
                      disabled={completed}
                      placeholder="Enter the correct structure name"
                      style={{
                        padding: 10,
                        border: hasError(`l1-structure-${i}-correction`)
                          ? "1px solid var(--danger-line)"
                          : undefined,
                      }}
                    />
                  </label>
                </FieldAnchor>
              ) : null}
            </FieldAnchor>
          );
        })}

        <label style={{ display: "grid", gap: 4, marginTop: 10 }}>
          Number of wrong structures
          <input
            type="number"
            value={structureWrong}
            readOnly
            disabled={completed}
            style={{ padding: 10, background: "#f3f4f6" }}
          />
        </label>
        <input
          type="hidden"
          {...register("level1.wrongStructuresCount", {
            required: true,
            valueAsNumber: true,
          })}
        />

        <div className="grading-metrics" hidden={hideLiveMetrics} style={hideLiveMetrics ? { display: "none" } : undefined}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            Anatomical Structures detection
          </div>
          <div>
            Precision: <strong>{formatMetric(metrics.structures.precision)}</strong>
            <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
              (= correct / total)
            </span>
          </div>
          <div>
            Hallucination rate:{" "}
            <strong>{formatMetric(metrics.structures.hallucinationRate)}</strong>
            <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
              (= hallucination_absent / total)
            </span>
          </div>
          <div>
            Misrecognition rate:{" "}
            <strong>{formatMetric(metrics.structures.misrecognitionRate)}</strong>
            <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
              (= misrecognition_present / total)
            </span>
          </div>
        </div>

        <div className="grading-section-title">
          Instrument Inventory
          {l1.totalInstruments != null ? ` (Total: ${l1.totalInstruments})` : ""}
        </div>
        {l1.instruments.map((inst, i) => {
          const isIncorrect = watchedInstruments?.[i]?.correct === "incorrect";
          const instErr =
            hasError(`l1-instrument-${i}`) || hasError(`l1-instrument-${i}-reason`);
          return (
            <FieldAnchor
              key={i}
              id={`l1-instrument-${i}`}
              error={instErr}
              highlight={
                isHot(`level1.instruments.${i}.correct`) ||
                isHot(`level1.instruments.${i}.incorrectReason`)
              }
              className="grading-sub"
            >
              <DiscSolve path={`level1.instruments.${i}.correct`} />
              <DiscSolve path={`level1.instruments.${i}.incorrectReason`} />
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{inst.name}</div>
              <CorrectIncorrect
                legend="Instrument Correct / Incorrect"
                name={`level1.instruments.${i}.correct`}
                register={register}
                disabled={completed}
                onCorrectChange={(v) => {
                  if (v === "correct") {
                    setValue(`level1.instruments.${i}.incorrectReason` as any, "", {
                      shouldValidate: true,
                    });
                    setValue(`level1.instruments.${i}.expertCorrection` as any, "", {
                      shouldValidate: true,
                    });
                  }
                }}
              />
              {isIncorrect ? (
                <div id={gradingFieldDomId(`l1-instrument-${i}-reason`)}>
                  <IncorrectReasonRadios
                    name={`level1.instruments.${i}.incorrectReason`}
                    register={register}
                    disabled={completed}
                    required
                  />
                </div>
              ) : null}
              {isIncorrect &&
              watchedInstruments?.[i]?.incorrectReason === "misrecognition_present" ? (
                <FieldAnchor
                  id={`l1-instrument-${i}-correction`}
                  error={hasError(`l1-instrument-${i}-correction`)}
                  style={{ marginTop: 8 }}
                >
                  <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                    Correct instrument name
                    <input
                      type="text"
                      {...register(`level1.instruments.${i}.expertCorrection` as any, {
                        required: true,
                      })}
                      disabled={completed}
                      placeholder="Enter the correct instrument name"
                      style={{
                        padding: 10,
                        border: hasError(`l1-instrument-${i}-correction`)
                          ? "1px solid var(--danger-line)"
                          : undefined,
                      }}
                    />
                  </label>
                </FieldAnchor>
              ) : null}
            </FieldAnchor>
          );
        })}

        <label style={{ display: "grid", gap: 4, marginTop: 10 }}>
          Number of wrong instruments
          <input
            type="number"
            value={instrumentWrong}
            readOnly
            disabled={completed}
            style={{ padding: 10, background: "#f3f4f6" }}
          />
        </label>
        <input
          type="hidden"
          {...register("level1.wrongInstrumentsCount", {
            required: true,
            valueAsNumber: true,
          })}
        />

        <FieldAnchor
          id="l1-missedInstruments"
          error={hasError("l1-missedInstruments")}
          style={{ marginTop: 8, padding: 8, borderRadius: 8 }}
        >
          <MissedItemsField
            label="Missed instruments (not listed by AI)"
            values={watchedMissedInstruments}
            disabled={completed}
            error={hasError("l1-missedInstruments")}
            countLabel="Missed instrument count"
            onChange={(next) => {
              setValue("level1.missedInstruments", next, {
                shouldValidate: true,
                shouldDirty: true,
              });
            }}
          />
          <input
            type="hidden"
            {...register("level1.missedInstrumentsCount", {
              valueAsNumber: true,
            })}
          />
        </FieldAnchor>

        <div className="grading-metrics" hidden={hideLiveMetrics} style={hideLiveMetrics ? { display: "none" } : undefined}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Instrument Inventory</div>
          <div>
            Precision: <strong>{formatMetric(metrics.instruments.precision)}</strong>
            <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
              (= correct / total)
            </span>
          </div>
          <div>
            Hallucination rate:{" "}
            <strong>{formatMetric(metrics.instruments.hallucinationRate)}</strong>
            <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
              (= hallucination_absent / total)
            </span>
          </div>
          <div>
            Misrecognition rate:{" "}
            <strong>{formatMetric(metrics.instruments.misrecognitionRate)}</strong>
            <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
              (= misrecognition_present / total)
            </span>
          </div>
          <div>
            Recall: <strong>{formatMetric(metrics.instruments.recall)}</strong>
          </div>
          <div>
            F1: <strong>{formatMetric(metrics.instruments.f1)}</strong>
          </div>
        </div>

        <div className="grading-section-title">Spatial Positioning</div>
        <FieldAnchor
          id="l1-spatial"
          error={hasError("l1-spatial")}
          highlight={isHot("level1.spatialPositioningCorrect")}
          className="grading-sub"
        >
          <DiscSolve path="level1.spatialPositioningCorrect" />
          {l1.spatialPositioning ? (
            <div style={{ fontSize: 13, color: "#444", marginBottom: 8 }}>
              AI: {l1.spatialPositioning}
            </div>
          ) : null}
          <CorrectIncorrect
            legend="Spatial Positioning Correct / Incorrect"
            name="level1.spatialPositioningCorrect"
            register={register}
            disabled={completed}
            onCorrectChange={(v) => {
              if (v === "correct") {
                setValue("level1.spatialPositioningCorrection", "", {
                  shouldValidate: true,
                });
              }
            }}
          />
          {watch("level1.spatialPositioningCorrect") === "incorrect" ? (
            <FieldAnchor
              id="l1-spatial-correction"
              error={hasError("l1-spatial-correction")}
              style={{ marginTop: 8 }}
            >
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                Correct spatial positioning
                <textarea
                  rows={2}
                  {...register("level1.spatialPositioningCorrection", { required: true })}
                  disabled={completed}
                  placeholder="Enter the correct spatial positioning"
                  style={{
                    padding: 10,
                    border: hasError("l1-spatial-correction")
                      ? "1px solid var(--danger-line)"
                      : undefined,
                  }}
                />
              </label>
            </FieldAnchor>
          ) : null}
        </FieldAnchor>
      </div>

      <div className="grading-card">
        <div className="grading-card-title">
          Level 2 ? Workflow
          {l2.totalPhases != null ? ` ? ${l2.totalPhases} phases` : ""}
        </div>
        {l2.phases.map((p, i) => {
          const phaseWatch = watch(`level2.phases.${i}`);
          const timingIncorrect = phaseWatch?.segmentationCorrect === "incorrect";
          const contentIncorrect = phaseWatch?.contentCorrect === "incorrect";
          const phaseIoU = formatIoU(
            temporalIoU(
              p.aiStartTime,
              p.aiEndTime,
              phaseWatch?.trueStartTime ?? "",
              phaseWatch?.trueEndTime ?? "",
            ),
          );

          return (
            <div
              key={i}
              data-align-key={`l2-phase-block-${i}`} id={gradingFieldDomId(domPrefix ? `${domPrefix}-l2-phase-${i}` : `l2-phase-${i}`)}
              className={`grading-sub${
                hasError(`l2-phase-${i}-timing`) ||
                hasError(`l2-phase-${i}-content`) ||
                hasError(`l2-phase-${i}-error`) ||
                hasError(`l2-phase-${i}-trueStart`) ||
                hasError(`l2-phase-${i}-trueEnd`)
                  ? " grading-error"
                  : ""
              }`}
              style={
                isHot(`level2.phases.${i}.segmentationCorrect`) ||
                isHot(`level2.phases.${i}.contentCorrect`) ||
                isHot(`level2.phases.${i}.phaseErrorType`)
                  ? {
                      background: "#fef9c3",
                      boxShadow: "inset 0 0 0 1px #eab308",
                    }
                  : undefined
              }
            >
              <DiscSolve path={`level2.phases.${i}.segmentationCorrect`} />
              <DiscSolve path={`level2.phases.${i}.contentCorrect`} />
              <DiscSolve path={`level2.phases.${i}.phaseErrorType`} />
              <div style={{ fontWeight: 700, fontSize: 13, color: "var(--accent-deep)" }}>
                AI: [{p.aiStartTime} ? {p.aiEndTime}]
              </div>
              <div style={{ fontSize: 14, margin: "6px 0 10px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
                {p.description}
              </div>

              <FieldAnchor
                id={`l2-phase-${i}-timing`}
                error={hasError(`l2-phase-${i}-timing`)}
                style={{ padding: 6, borderRadius: 8, marginBottom: 4 }}
              >
                <CorrectIncorrect
                  legend="Is the segmentation (timing) correct?"
                  name={`level2.phases.${i}.segmentationCorrect`}
                  register={register}
                  disabled={completed}
                />
              </FieldAnchor>

              {timingIncorrect ? (
                <div className="notice notice-info" style={{ marginTop: 8, marginBottom: 0 }}>
                  Timing is incorrect ? please adjust the <strong>True Start</strong> and{" "}
                  <strong>True End</strong> below.
                </div>
              ) : null}

              <FieldAnchor
                id={`l2-phase-${i}-content`}
                error={hasError(`l2-phase-${i}-content`)}
                style={{ marginTop: 10, padding: 6, borderRadius: 8 }}
              >
                <CorrectIncorrect
                  legend="Is the segmentation content correct?"
                  name={`level2.phases.${i}.contentCorrect`}
                  register={register}
                  disabled={completed}
                  onCorrectChange={(v) => {
                    if (v === "correct") {
                      setValue(`level2.phases.${i}.phaseErrorType` as any, "", {
                        shouldValidate: true,
                      });
                      setValue(
                        `level2.phases.${i}.expertCorrectDescription` as any,
                        "",
                        { shouldValidate: true },
                      );
                    }
                  }}
                />
              </FieldAnchor>

              {contentIncorrect ? (
                <FieldAnchor
                  id={`l2-phase-${i}-error`}
                  error={hasError(`l2-phase-${i}-error`)}
                  className="grading-reason"
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warn)" }}>
                    Error type
                  </div>
                  {(
                    [
                      [
                        "hallucination_absent",
                        "hallucinates when the target is absent",
                      ],
                      [
                        "misrecognition_present",
                        "misrecognition when the target is present",
                      ],
                    ] as const
                  ).map(([value, label], idx) => {
                    const reg =
                      idx === 0
                        ? register(`level2.phases.${i}.phaseErrorType` as any, {
                            validate: (v, formValues) => {
                              const content =
                                formValues?.level2?.phases?.[i]?.contentCorrect;
                              if (content !== "incorrect") return true;
                              return (
                                v === "hallucination_absent" ||
                                v === "misrecognition_present" ||
                                "Please select an error type"
                              );
                            },
                          })
                        : register(`level2.phases.${i}.phaseErrorType` as any);
                    return (
                      <label
                        key={value}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          fontSize: 13,
                        }}
                      >
                        <input
                          type="radio"
                          value={value}
                          {...reg}
                          disabled={completed}
                          style={{ marginTop: 2 }}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </FieldAnchor>
              ) : (
                <input
                  type="hidden"
                  {...register(`level2.phases.${i}.phaseErrorType` as any, {
                    validate: (v, formValues) => {
                      const content =
                        formValues?.level2?.phases?.[i]?.contentCorrect;
                      if (content !== "incorrect") return true;
                      return (
                        v === "hallucination_absent" ||
                        v === "misrecognition_present" ||
                        "Please select an error type"
                      );
                    },
                  })}
                />
              )}

              {contentIncorrect &&
              phaseWatch?.phaseErrorType === "misrecognition_present" ? (
                <FieldAnchor
                  id={`l2-phase-${i}-correction`}
                  error={hasError(`l2-phase-${i}-correction`)}
                  style={{ marginTop: 8 }}
                >
                  <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                    Correct phase description
                    <textarea
                      rows={2}
                      {...register(
                        `level2.phases.${i}.expertCorrectDescription` as any,
                        { required: true },
                      )}
                      disabled={completed}
                      placeholder="Enter the correct description for this phase"
                      style={{
                        padding: 10,
                        border: hasError(`l2-phase-${i}-correction`)
                          ? "1px solid var(--danger-line)"
                          : undefined,
                      }}
                    />
                  </label>
                </FieldAnchor>
              ) : null}

              <FieldAnchor
                id={`l2-phase-${i}-trueStart`}
                error={hasError(`l2-phase-${i}-trueStart`)}
                style={{ marginTop: 8, padding: 6, borderRadius: 6 }}
              >
                <label style={{ display: "grid", gap: 4 }}>
                  True Start (HH:MM:SS)
                  {timingIncorrect ? " ? please adjust" : " ? defaults to AI time"}
                  <input
                    placeholder="00:00:00"
                    {...register(`level2.phases.${i}.trueStartTime`, {
                      required: true,
                      validate: (v) => TIME_RE.test(v) || "HH:MM:SS",
                    })}
                    disabled={completed}
                    style={{
                      padding: 8,
                      border: hasError(`l2-phase-${i}-trueStart`)
                        ? "1px solid var(--danger-line)"
                        : timingIncorrect
                          ? "1px solid rgba(42, 122, 114, 0.45)"
                          : undefined,
                      background: hasError(`l2-phase-${i}-trueStart`)
                        ? "var(--danger-bg)"
                        : timingIncorrect
                          ? "var(--accent-mist)"
                          : undefined,
                    }}
                  />
                </label>
              </FieldAnchor>
              <FieldAnchor
                id={`l2-phase-${i}-trueEnd`}
                error={hasError(`l2-phase-${i}-trueEnd`)}
                style={{ marginTop: 8, padding: 6, borderRadius: 6 }}
              >
                <label style={{ display: "grid", gap: 4 }}>
                  True End (HH:MM:SS)
                  {timingIncorrect ? " ? please adjust" : " ? defaults to AI time"}
                  <input
                    placeholder="00:00:00"
                    {...register(`level2.phases.${i}.trueEndTime`, {
                      required: true,
                      validate: (v) => TIME_RE.test(v) || "HH:MM:SS",
                    })}
                    disabled={completed}
                    style={{
                      padding: 8,
                      border: hasError(`l2-phase-${i}-trueEnd`)
                        ? "1px solid var(--danger-line)"
                        : timingIncorrect
                          ? "1px solid rgba(42, 122, 114, 0.45)"
                          : undefined,
                      background: hasError(`l2-phase-${i}-trueEnd`)
                        ? "var(--danger-bg)"
                        : timingIncorrect
                          ? "var(--accent-mist)"
                          : undefined,
                    }}
                  />
                </label>
              </FieldAnchor>
              <div style={{ marginTop: 8, fontSize: 13, color: "#334155" }}>
                Phase temporal IoU: <strong>{phaseIoU}</strong>
              </div>
            </div>
          );
        })}

        {(() => {
          const watchedPhases = watch("level2.phases") ?? [];
          const metrics = computeLevel2TemporalMetrics(
            l2.phases.map((p, i) => ({
              aiStartTime: p.aiStartTime,
              aiEndTime: p.aiEndTime,
              trueStartTime: watchedPhases[i]?.trueStartTime ?? "",
              trueEndTime: watchedPhases[i]?.trueEndTime ?? "",
            })),
          );
          const contentMetrics = computeLevel2ContentMetrics(
            watchedPhases.map((phase) => ({
              contentCorrect: phase?.contentCorrect,
              phaseErrorType: phase?.phaseErrorType,
            })),
          );
          return (
            <div className="grading-metrics" hidden={hideLiveMetrics} style={hideLiveMetrics ? { display: "none" } : undefined}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Level 2 temporal metrics
              </div>
              <div style={{ marginBottom: 8 }}>
                Mean temporal IoU:{" "}
                <strong>{formatIoU(metrics.meanTemporalIoU)}</strong>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 12,
                  whiteSpace: "pre-wrap",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {`Formula (per phase):
tIoU = |A ? B| / |A ? B|
A = [t_AI_start, t_AI_end],  B = [t_true_start, t_true_end]
|A ? B| = max(0, min(t_AI_end, t_true_end) ? max(t_AI_start, t_true_start))
|A ? B| = (t_AI_end ? t_AI_start) + (t_true_end ? t_true_start) ? |A ? B|
Mean tIoU = (1/N) ?_i tIoU_i`}
              </div>

              <div style={{ marginBottom: 8 }}>
                mAP@IoU: <strong>{formatIoU(metrics.mapAtIoU)}</strong>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 14,
                  whiteSpace: "pre-wrap",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {`Formula (1:1 phase matching) ? src/lib/temporalMetrics.ts
For each threshold ? ? {0.50, 0.55, ?, 0.95}:
  P(?) = (# phases with tIoU ? ?) / N
mAP@IoU = (1/|T|) ?_? P(?)`}
              </div>

              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Level 2 content metrics
              </div>
              <div>
                Content accuracy:{" "}
                <strong>{formatMetric(contentMetrics.contentAccuracy)}</strong>
                <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
                  (= contentCorrect / N)
                </span>
              </div>
              <div>
                Content hallucination rate:{" "}
                <strong>
                  {formatMetric(contentMetrics.contentHallucinationRate)}
                </strong>
                <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
                  (= hallucination_absent / N)
                </span>
              </div>
              <div>
                Content misrecognition rate:{" "}
                <strong>
                  {formatMetric(contentMetrics.contentMisrecognitionRate)}
                </strong>
                <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
                  (= misrecognition_present / N)
                </span>
              </div>
            </div>
          );
        })()}

        <FieldAnchor
          id="l2-missedPhases"
          error={hasError("l2-missedPhases")}
          style={{ marginTop: 10, padding: 8, borderRadius: 8 }}
        >
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 8 }}>
            AI detected missed phases:{" "}
            <strong style={{ color: "var(--ink)" }}>
              {l2.aiMissedPhasesCount == null ? "?" : l2.aiMissedPhasesCount}
            </strong>
          </div>
          {l2.missedStepsEvaluation ? (
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 8, lineHeight: 1.45 }}>
              AI Missed Steps / Phases content: {l2.missedStepsEvaluation}
            </div>
          ) : null}
          <MissedItemsField
            label="Missed phases (not detected by AI)"
            values={watchedMissedPhases}
            disabled={completed}
            error={hasError("l2-missedPhases")}
            countLabel="Missed phase count"
            onChange={(next) => {
              setValue("level2.missedPhases", next, {
                shouldValidate: true,
                shouldDirty: true,
              });
            }}
          />
          <input
            type="hidden"
            {...register("level2.missedPhasesCount", { valueAsNumber: true })}
          />
        </FieldAnchor>
        <FieldAnchor
          id="l2-missedSteps"
          error={hasError("l2-missedSteps")}
          highlight={isHot("level2.missedStepsDetectedCorrect")}
          style={{ marginTop: 10, padding: 8, borderRadius: 8 }}
        >
          <DiscSolve path="level2.missedStepsDetectedCorrect" />
          <CorrectIncorrect
            legend="Is the missed-phase content correct?"
            name="level2.missedStepsDetectedCorrect"
            register={register}
            disabled={completed}
            onCorrectChange={(v) => {
              if (v === "correct") {
                setValue("level2.missedStepsCorrection", "", {
                  shouldValidate: true,
                });
              }
            }}
          />
          {watch("level2.missedStepsDetectedCorrect") === "incorrect" ? (
            <FieldAnchor
              id="l2-missedSteps-correction"
              error={hasError("l2-missedSteps-correction")}
              style={{ marginTop: 8 }}
            >
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                Correct missed-steps content
                <textarea
                  rows={2}
                  {...register("level2.missedStepsCorrection", { required: true })}
                  disabled={completed}
                  placeholder="Describe the correct missed steps / phases"
                  style={{
                    padding: 10,
                    border: hasError("l2-missedSteps-correction")
                      ? "1px solid var(--danger-line)"
                      : undefined,
                  }}
                />
              </label>
            </FieldAnchor>
          ) : null}
        </FieldAnchor>
      </div>

      <div className="grading-card">
        <div className="grading-card-title">Level 3 ? Clinical Reasoning</div>

        <div className="grading-sub">
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
            AI ? Is the surgery completed?:{" "}
            <strong style={{ color: "var(--ink)" }}>
              {parsed.level3.surgeryCompleted || "?"}
            </strong>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 6, lineHeight: 1.5 }}>
            <strong>Next Action Prediction:</strong>{" "}
            {parsed.level3.nextActionPrediction || "?"}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
            <strong>Clinical Rationale:</strong>{" "}
            {parsed.level3.clinicalRationale || "?"}
          </div>
        </div>

        <FieldAnchor
          id="l3-surgeryCompleted"
          error={hasError("l3-surgeryCompleted")}
          highlight={isHot("level3.surgeryCompleted")}
          style={{ padding: 8, borderRadius: 8, margin: "10px 0" }}
        >
          <DiscSolve path="level3.surgeryCompleted" />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Is the surgery completed? (Yes / No)</legend>
            <label style={{ marginRight: 12 }}>
              <input
                type="radio"
                value="yes"
                {...register("level3.surgeryCompleted", { required: true })}
                disabled={completed}
              />
              Yes
            </label>
            <label>
              <input
                type="radio"
                value="no"
                {...register("level3.surgeryCompleted", { required: true })}
                disabled={completed}
              />
              No
            </label>
          </fieldset>
        </FieldAnchor>

        <FieldAnchor
          id="l3-nextAction"
          error={hasError("l3-nextAction")}
          highlight={isHot("level3.nextActionAccurate")}
          style={{ padding: 8, borderRadius: 8 }}
        >
          <DiscSolve path="level3.nextActionAccurate" />
          <CorrectIncorrect
            legend="Is the Next Action medically accurate?"
            name="level3.nextActionAccurate"
            register={register}
            disabled={completed}
            onCorrectChange={(v) => {
              if (v === "correct") {
                setValue("level3.nextActionCorrection", "", { shouldValidate: true });
              }
            }}
          />
          {watch("level3.nextActionAccurate") === "incorrect" ? (
            <FieldAnchor
              id="l3-nextAction-correction"
              error={hasError("l3-nextAction-correction")}
              style={{ marginTop: 8 }}
            >
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                Correct next action
                <textarea
                  rows={3}
                  {...register("level3.nextActionCorrection", { required: true })}
                  disabled={completed}
                  placeholder="Enter the medically correct next action"
                  style={{
                    padding: 10,
                    border: hasError("l3-nextAction-correction")
                      ? "1px solid var(--danger-line)"
                      : undefined,
                  }}
                />
              </label>
            </FieldAnchor>
          ) : null}
        </FieldAnchor>
        <FieldAnchor
          id="l3-nomenclature"
          error={hasError("l3-nomenclature")}
          highlight={isHot("level3.nomenclatureStandardized")}
          style={{ marginTop: 10, padding: 8, borderRadius: 8 }}
        >
          <DiscSolve path="level3.nomenclatureStandardized" />
          <CorrectIncorrect
            legend="Is the nomenclature standardized?"
            name="level3.nomenclatureStandardized"
            register={register}
            disabled={completed}
            onCorrectChange={(v) => {
              if (v === "correct") {
                setValue("level3.nomenclatureCorrection", "", {
                  shouldValidate: true,
                });
              }
            }}
          />
          {watch("level3.nomenclatureStandardized") === "incorrect" ? (
            <FieldAnchor
              id="l3-nomenclature-correction"
              error={hasError("l3-nomenclature-correction")}
              style={{ marginTop: 8 }}
            >
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                Correct nomenclature
                <textarea
                  rows={2}
                  {...register("level3.nomenclatureCorrection", { required: true })}
                  disabled={completed}
                  placeholder="Enter the standardized nomenclature"
                  style={{
                    padding: 10,
                    border: hasError("l3-nomenclature-correction")
                      ? "1px solid var(--danger-line)"
                      : undefined,
                  }}
                />
              </label>
            </FieldAnchor>
          ) : null}
        </FieldAnchor>
        <FieldAnchor
          id="l3-safety"
          error={hasError("l3-safety")}
          highlight={isHot("level3.safetyCheckPass")}
          style={{ padding: 8, borderRadius: 8, margin: "10px 0" }}
        >
          <DiscSolve path="level3.safetyCheckPass" />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Safety Check (Pass / Fail)</legend>
            <label style={{ marginRight: 12 }}>
              <input
                type="radio"
                value="pass"
                {...register("level3.safetyCheckPass", { required: true })}
                disabled={completed}
              />
              Pass
            </label>
            <label>
              <input
                type="radio"
                value="fail"
                {...register("level3.safetyCheckPass", { required: true })}
                disabled={completed}
              />
              Fail
            </label>
          </fieldset>
        </FieldAnchor>
        <FieldAnchor
          id="l3-notes"
          error={hasError("l3-notes")}
          style={{ padding: 8, borderRadius: 8 }}
        >
          <label style={{ display: "grid", gap: 4 }}>
            Hallucination Notes (If Fail)
            <textarea
              rows={3}
              placeholder="Did the AI recommend anything dangerous/hallucinated? If Pass, you may write N/A"
              {...register("level3.hallucinationNotes", { required: true, minLength: 1 })}
              disabled={completed}
              style={{
                padding: 10,
                border: hasError("l3-notes") ? "1px solid var(--danger-line)" : undefined,
              }}
            />
          </label>
        </FieldAnchor>
      </div>

      <div className="grading-card">
        <div className="grading-card-title">
          Level 4 ? Skills Evaluation & Grounding Test
        </div>
        <p className="page-lead" style={{ marginBottom: 12, fontSize: 13 }}>
          ????????????1?5????????????????? AI
          ???????????????????? Hallucination = Yes?
        </p>
        {LEVEL4_DIMENSIONS.map((d) => {
          const base = `level4.dimensions.${d.key}`;
          const scoreErr = hasError(`l4-${d.key}-score`);
          const hallErr = hasError(`l4-${d.key}-hallucination`);
          return (
            <div
              key={d.key}
              className={`grading-sub${scoreErr || hallErr ? " grading-error" : ""}`}
            >
              <div style={{ fontWeight: 700 }}>{d.label}</div>
              <ul
                style={{
                  margin: "8px 0 10px",
                  paddingLeft: 18,
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: "var(--ink-soft)",
                }}
              >
                {d.rubrics.map((r) => (
                  <li key={r.score}>
                    <strong>{r.score}:</strong> {r.text}
                  </li>
                ))}
              </ul>
              <FieldAnchor
                id={`l4-${d.key}-score`}
                error={scoreErr}
                style={{ marginBottom: 8, padding: 6, borderRadius: 6 }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  Expert Given Score (1?5)
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input
                          type="radio"
                          value={n}
                          {...register(`${base}.expertScore` as any, {
                            required: true,
                            valueAsNumber: true,
                          })}
                          disabled={completed}
                        />
                        {n}
                      </label>
                    ))}
                  </div>
                </label>
              </FieldAnchor>
              <FieldAnchor
                id={`l4-${d.key}-hallucination`}
                error={hallErr}
                style={{ padding: 6, borderRadius: 6 }}
              >
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend>Hallucination (Yes / No)</legend>
                  <label style={{ marginRight: 12 }}>
                    <input
                      type="radio"
                      value="yes"
                      {...register(`${base}.aiJustificationHallucination` as any, {
                        required: true,
                      })}
                      disabled={completed}
                    />
                    Yes
                  </label>
                  <label>
                    <input
                      type="radio"
                      value="no"
                      {...register(`${base}.aiJustificationHallucination` as any, {
                        required: true,
                      })}
                      disabled={completed}
                    />
                    No
                  </label>
                </fieldset>
              </FieldAnchor>
            </div>
          );
        })}

        {(() => {
          const watchedDims = watch("level4.dimensions") ?? {};
          const hall = computeLevel4HallucinationRate(
            watchedDims as Record<
              string,
              { aiJustificationHallucination?: string }
            >,
            LEVEL4_DIMENSIONS.map((d) => d.key),
          );
          return (
            <div className="grading-metrics" hidden={hideLiveMetrics} style={hideLiveMetrics ? { display: "none" } : undefined}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                Level 4 hallucination rate
              </div>
              <div>
                Hallucination rate:{" "}
                <strong>{formatMetric(hall?.rate ?? null)}</strong>
                <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>
                  (= Yes / total ? {hall?.yesCount ?? 0}/{hall?.totalCount ?? 0})
                </span>
              </div>
            </div>
          );
        })()}
      </div>

      {incompleteBanner}

      {!hideSubmit ? (
<button
        type="submit"
        disabled={completed || !canSubmit || submitting}
        className="btn btn-primary btn-block"
        style={{ marginTop: 4 }}
      >
        {completed
          ? "???"
          : submitting
            ? "???..."
            : !isValid
              ? "???????????"
              : "????"}
      </button>
      ) : null}
    </form>
    </FormDomPrefixContext.Provider>
  );
}
