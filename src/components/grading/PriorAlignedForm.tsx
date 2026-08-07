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
  discrepancySolvePaths: Set<string>;
  onToggleDiscrepancySolve: (path: string) => void;
  showDiscrepancySolve?: boolean;
};

/** Read-only prior grader form, field-aligned with the active grader's form. */
export function PriorAlignedForm({
  title,
  parsed,
  gradingData,
  highlightPaths,
  discrepancySolvePaths,
  onToggleDiscrepancySolve,
  showDiscrepancySolve = true,
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
      formTitle={title}
      highlightPaths={highlightPaths}
      discrepancySolvePaths={discrepancySolvePaths}
      showDiscrepancySolve={showDiscrepancySolve}
      onToggleDiscrepancySolve={onToggleDiscrepancySolve}
    />
  );
}
