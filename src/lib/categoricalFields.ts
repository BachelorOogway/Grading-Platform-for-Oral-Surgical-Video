/**
 * Categorical (selective) fields used for 3-grader consensus.
 * Free-text corrections and Level 4 are excluded.
 */

export type CategoricalField = {
  path: string;
  label: string;
  /** Normalized string value for comparison */
  value: string | null;
};

function boolLabel(v: unknown): string | null {
  if (v === true || v === "correct" || v === "yes" || v === "pass") return "yes_or_correct";
  if (v === false || v === "incorrect" || v === "no" || v === "fail") return "no_or_incorrect";
  if (v === "yes") return "yes";
  if (v === "no") return "no";
  return v == null || v === "" ? null : String(v);
}

function displayValue(path: string, raw: unknown): string {
  if (raw === true) {
    if (path.includes("surgeryCompleted")) return "Yes";
    if (path.includes("safetyCheckPass")) return "Pass";
    return "Correct";
  }
  if (raw === false) {
    if (path.includes("surgeryCompleted")) return "No";
    if (path.includes("safetyCheckPass")) return "Fail";
    return "Incorrect";
  }
  if (raw === "hallucination_absent") return "hallucination (absent)";
  if (raw === "misrecognition_present") return "misrecognition (present)";
  if (raw === "yes") return "Yes";
  if (raw === "no") return "No";
  if (raw === "pass") return "Pass";
  if (raw === "fail") return "Fail";
  if (raw === "correct") return "Correct";
  if (raw === "incorrect") return "Incorrect";
  return String(raw ?? "—");
}

/** Extract categorical answers from stored grading payload (or live form-ish). */
export function extractCategoricalFields(grading: any): CategoricalField[] {
  if (!grading || typeof grading !== "object") return [];
  const out: CategoricalField[] = [];
  const l1 = grading.level1 ?? {};
  const l2 = grading.level2 ?? {};
  const l3 = grading.level3 ?? {};

  const push = (path: string, label: string, raw: unknown) => {
    const norm = boolLabel(raw);
    if (norm == null && raw !== false && raw !== true) {
      // still record null for presence of field when parent incorrect needs reason
    }
    out.push({
      path,
      label,
      value:
        raw === true || raw === false || raw != null
          ? displayValue(path, raw)
          : null,
    });
    // store comparable token separately via encoding in value; for compare use normalize
    (out[out.length - 1] as any)._norm =
      raw === true || raw === false
        ? String(raw)
        : raw == null || raw === ""
          ? null
          : String(raw);
  };

  push("level1.procedureTypeCorrect", "L1 Procedure Type", l1.procedureTypeCorrect);

  const structures: any[] = Array.isArray(l1.structures) ? l1.structures : [];
  structures.forEach((s, i) => {
    push(
      `level1.structures.${i}.correct`,
      `L1 Structure ${i + 1}${s?.name ? `: ${s.name}` : ""}`,
      s?.correct,
    );
    if (s?.correct === false || s?.correct === "incorrect") {
      push(
        `level1.structures.${i}.incorrectReason`,
        `L1 Structure ${i + 1} error type`,
        s?.incorrectReason,
      );
    }
  });

  const instruments: any[] = Array.isArray(l1.instruments) ? l1.instruments : [];
  instruments.forEach((s, i) => {
    push(
      `level1.instruments.${i}.correct`,
      `L1 Instrument ${i + 1}${s?.name ? `: ${s.name}` : ""}`,
      s?.correct,
    );
    if (s?.correct === false || s?.correct === "incorrect") {
      push(
        `level1.instruments.${i}.incorrectReason`,
        `L1 Instrument ${i + 1} error type`,
        s?.incorrectReason,
      );
    }
  });

  push(
    "level1.spatialPositioningCorrect",
    "L1 Spatial Positioning",
    l1.spatialPositioningCorrect,
  );

  const phases: any[] = Array.isArray(l2.phases) ? l2.phases : [];
  phases.forEach((p, i) => {
    push(
      `level2.phases.${i}.segmentationCorrect`,
      `L2 Phase ${i + 1} timing`,
      p?.segmentationCorrect,
    );
    push(
      `level2.phases.${i}.contentCorrect`,
      `L2 Phase ${i + 1} content`,
      p?.contentCorrect,
    );
    if (p?.contentCorrect === false || p?.contentCorrect === "incorrect") {
      push(
        `level2.phases.${i}.phaseErrorType`,
        `L2 Phase ${i + 1} error type`,
        p?.phaseErrorType,
      );
    }
  });

  push(
    "level2.missedStepsDetectedCorrect",
    "L2 Missed-steps content",
    l2.missedStepsDetectedCorrect,
  );

  push("level3.surgeryCompleted", "L3 Surgery completed", l3.surgeryCompleted);
  push("level3.nextActionAccurate", "L3 Next action accurate", l3.nextActionAccurate);
  push(
    "level3.nomenclatureStandardized",
    "L3 Nomenclature",
    l3.nomenclatureStandardized,
  );
  push("level3.safetyCheckPass", "L3 Safety check", l3.safetyCheckPass);

  return out;
}

function normToken(raw: unknown): string | null {
  if (raw === true || raw === "correct") return "true";
  if (raw === false || raw === "incorrect") return "false";
  if (raw === "yes" || raw === "Yes") return "yes";
  if (raw === "no" || raw === "No") return "no";
  if (raw === "pass") return "pass";
  if (raw === "fail") return "fail";
  if (raw == null || raw === "") return null;
  return String(raw);
}

/** Public compare token for discrepancy consensus. */
export function categoricalCompareToken(raw: unknown): string | null {
  return normToken(raw);
}

/** When saving a discrepancy answer, also copy these related paths from the form. */
export function relatedDiscrepancyPaths(fieldPath: string): string[] {
  const paths = [fieldPath];
  if (fieldPath.endsWith(".correct")) {
    paths.push(fieldPath.replace(/\.correct$/, ".incorrectReason"));
  }
  if (fieldPath.endsWith(".contentCorrect")) {
    paths.push(fieldPath.replace(/\.contentCorrect$/, ".phaseErrorType"));
  }
  if (fieldPath.endsWith(".nextActionAccurate")) {
    paths.push(fieldPath.replace(/\.nextActionAccurate$/, ".nextActionCorrection"));
  }
  if (fieldPath.endsWith(".nomenclatureStandardized")) {
    paths.push(
      fieldPath.replace(/\.nomenclatureStandardized$/, ".nomenclatureCorrection"),
    );
  }
  if (fieldPath.endsWith(".missedStepsDetectedCorrect")) {
    paths.push(
      fieldPath.replace(/\.missedStepsDetectedCorrect$/, ".missedStepsCorrection"),
    );
  }
  if (fieldPath.endsWith(".segmentationCorrect")) {
    const base = fieldPath.replace(/\.segmentationCorrect$/, "");
    paths.push(`${base}.trueStartTime`, `${base}.trueEndTime`);
  }
  if (fieldPath.endsWith(".trueStartTime")) {
    const base = fieldPath.replace(/\.trueStartTime$/, "");
    paths.push(`${base}.trueEndTime`, `${base}.segmentationCorrect`);
  }
  if (fieldPath.endsWith(".trueEndTime")) {
    const base = fieldPath.replace(/\.trueEndTime$/, "");
    paths.push(`${base}.trueStartTime`, `${base}.segmentationCorrect`);
  }
  return paths;
}

/** Get comparable token for a path from grading payload. */
export function getCategoricalRaw(grading: any, path: string): unknown {
  const parts = path.split(".");
  let cur: any = grading;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}

export type CategoricalDisagreement = {
  path: string;
  label: string;
  grader1Value: string;
  grader2Value: string;
  grader1Raw: unknown;
  grader2Raw: unknown;
};

export function findCategoricalDisagreements(
  grading1: any,
  grading2: any,
): CategoricalDisagreement[] {
  const f1 = extractCategoricalFields(grading1);
  const map2 = new Map(
    extractCategoricalFields(grading2).map((f) => [f.path, f]),
  );
  const out: CategoricalDisagreement[] = [];

  const paths = new Set([...f1.map((f) => f.path), ...map2.keys()]);
  for (const path of paths) {
    const a = getCategoricalRaw(grading1, path);
    const b = getCategoricalRaw(grading2, path);
    const na = normToken(a);
    const nb = normToken(b);
    if (na == null && nb == null) continue;
    if (na === nb) continue;
    const label =
      f1.find((f) => f.path === path)?.label ??
      map2.get(path)?.label ??
      path;
    out.push({
      path,
      label,
      grader1Value: displayValue(path, a),
      grader2Value: displayValue(path, b),
      grader1Raw: a,
      grader2Raw: b,
    });
  }
  return out;
}

/** Majority of three categorical values (2:1). Prefer matching one of the priors. */
export function majorityOfThree(
  a: unknown,
  b: unknown,
  c: unknown,
): unknown {
  const tokens = [normToken(a), normToken(b), normToken(c)];
  const counts = new Map<string, { n: number; raw: unknown }>();
  const raws = [a, b, c];
  for (let i = 0; i < 3; i++) {
    const t = tokens[i];
    if (t == null) continue;
    const prev = counts.get(t);
    if (prev) prev.n += 1;
    else counts.set(t, { n: 1, raw: raws[i] });
  }
  let best: { n: number; raw: unknown } | null = null;
  for (const v of counts.values()) {
    if (!best || v.n > best.n) best = v;
  }
  return best?.raw ?? c;
}

/** Vote choices for discrepancy dashboard, matching form radio values. */
export function getDiscrepancyChoices(
  fieldPath: string,
): Array<{ value: string; label: string }> {
  if (fieldPath.includes("surgeryCompleted")) {
    return [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];
  }
  if (fieldPath.includes("safetyCheckPass")) {
    return [
      { value: "pass", label: "Pass" },
      { value: "fail", label: "Fail" },
    ];
  }
  if (
    fieldPath.includes("incorrectReason") ||
    fieldPath.includes("phaseErrorType")
  ) {
    return [
      { value: "hallucination_absent", label: "Hallucination (absent)" },
      { value: "misrecognition_present", label: "Misrecognition (present)" },
    ];
  }
  return [
    { value: "correct", label: "Correct" },
    { value: "incorrect", label: "Incorrect" },
  ];
}

/** Set a dotted path on a plain object (mutates). */
export function setCategoricalRaw(
  grading: any,
  path: string,
  value: unknown,
): void {
  if (!grading || typeof grading !== "object") return;
  const parts = path.split(".");
  let cur: any = grading;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    const wantArray = /^\d+$/.test(next);
    if (cur[p] == null || typeof cur[p] !== "object") {
      cur[p] = wantArray ? [] : {};
    }
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}
