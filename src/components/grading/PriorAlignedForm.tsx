"use client";

import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import type { AiParsedData } from "@/lib/aiOutputParser";
import { hydrateGradingForm, type GradingForm } from "@/lib/gradingForm";
import { GradingFormPanel } from "@/components/grading/GradingFormPanel";
import { parseJsonSafe } from "@/lib/json";

type Props = {
  title: string;
  parsed: AiParsedData;
  gradingData: unknown;
  highlightPaths: Set<string>;
  domPrefix: string;
  /** Banner under title, e.g. Solving results from expert EXP-001 */
  solvingResultsLabel?: string | null;
};

/** Read-only prior grader form, field-aligned with the active grader's form. */
export function PriorAlignedForm({
  title,
  parsed,
  gradingData,
  highlightPaths,
  domPrefix,
  solvingResultsLabel,
}: Props) {
  const saved = useMemo(() => {
    if (typeof gradingData === "string") {
      return parseJsonSafe(gradingData, null);
    }
    return gradingData;
  }, [gradingData]);

  const defaultValues = useMemo(
    () => hydrateGradingForm(parsed, saved),
    [parsed, saved],
  );

  const { register, handleSubmit, reset, watch, setValue } = useForm<GradingForm>({
    defaultValues,
    mode: "onChange",
    shouldUnregister: false,
  });

  useEffect(() => {
    reset(hydrateGradingForm(parsed, saved), { keepDefaultValues: false });
  }, [parsed, saved, reset]);

  return (
    <div>
      {solvingResultsLabel ? (
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
          {solvingResultsLabel}
        </div>
      ) : null}
      <GradingFormPanel
        parsed={parsed}
        register={register}
        watch={watch}
        setValue={setValue}
        handleSubmit={handleSubmit}
        onSubmit={() => {}}
        errors={{}}
        isValid
        incompleteMessages={[]}
        completed
        canSubmit={false}
        hideSubmit
        hideLiveMetrics
        formTitle={title}
        domPrefix={domPrefix}
        highlightPaths={highlightPaths}
        showDiscrepancySolve={false}
      />
    </div>
  );
}
