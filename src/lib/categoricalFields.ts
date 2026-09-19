/**
 * Categorical (selective) fields used for 3-grader consensus.
 * Free-text corrections and Level 4 OSATS scores are excluded; the Level 4
 * hallucination yes/no does take part.
 *
 * Absolute agreement: every categorical button path must match across all
 * three experts. Any pairwise disagreement auto-opens a discrepancy — there
 * is no silent 2:1 majority for these fields.
 */
import { LEVEL4_DIMENSIONS } from "@/lib/level4Dimensions";
import {
  LEVEL5_DIMENSIONS,
  isLevel5JudgementPath,
  level5JudgementLabel,
  level5JudgementOf,
  level5LabelForKey,
} from "@/lib/level5Dimensions";

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

/** Yes/No fields whose "true" does not mean "correct". */
export function isYesNoPath(path: string): boolean {
  return (
    path.includes("surgeryCompleted") ||
    path.includes("aiJustificationHallucination")
  );
}

/**
 * Level 4 hallucination is the only Level 4 answer that joins consensus —
 * OSATS scores are explicitly out of scope for discrepancies.
 */
export function isHallucinationPath(path: string): boolean {
  return path.endsWith(".aiJustificationHallucination");
}

/** Missed-instrument *count* joins consensus; the free-text list is related. */
export function isMissedInstrumentCountPath(path: string): boolean {
  return path === "level1.missedInstrumentsCount";
}

export function isSafetyCheckPath(path: string): boolean {
  return path.includes("safetyCheckPass");
}

/**
 * Every categorical button path auto-opens on disagreement (absolute
 * agreement among the three experts). Level 4 expertScore is never in the
 * categorical extract list, so it stays excluded.
 *
 * @deprecated Kept for callers; always true for categorical paths now.
 */
export function isAutoDiscrepancyPath(_path: string): boolean {
  return true;
}

/** Non-empty missed-instrument names from a grading payload. */
export function missedInstrumentNames(grading: any): string[] {
  const list = grading?.level1?.missedInstruments;
  if (!Array.isArray(list)) return [];
  return list
    .map((x: unknown) => String(x ?? "").trim())
    .filter(Boolean);
}

export function missedInstrumentCountOf(grading: any): number {
  const fromList = missedInstrumentNames(grading).length;
  if (fromList > 0 || Array.isArray(grading?.level1?.missedInstruments)) {
    return fromList;
  }
  const n = Number(grading?.level1?.missedInstrumentsCount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * When all graders report the same missed count, union their free-text names
 * (case-insensitive dedupe, first spelling wins).
 */
export function mergeMissedInstrumentNames(gradings: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of gradings) {
    for (const name of missedInstrumentNames(g)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

function displayValue(path: string, raw: unknown): string {
  if (raw === true) {
    if (isYesNoPath(path)) return "Yes";
    if (path.includes("safetyCheckPass")) return "Pass";
    return "Correct";
  }
  if (raw === false) {
    if (isYesNoPath(path)) return "No";
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
  if (raw === "hallucinate") return "Not Mentioned but Hallucinate";
  if (raw === "missed") return "Mentioned but Missed";
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

  push(
    "level1.missedInstrumentsCount",
    "L1 Missed instrument count",
    missedInstrumentCountOf(grading),
  );

  // Level 4: always emit every OSATS dimension so a missing key in one payload
  // cannot hide a hallucination disagreement.
  for (const def of LEVEL4_DIMENSIONS) {
    const fromStored = level4Dimensions(grading).find((d) => d.key === def.key);
    push(
      `level4.dimensions.${def.key}.aiJustificationHallucination`,
      `L4 ${def.label} hallucination`,
      fromStored?.raw ??
        getCategoricalRaw(
          grading,
          `level4.dimensions.${def.key}.aiJustificationHallucination`,
        ),
    );
  }

  for (const def of LEVEL5_DIMENSIONS) {
    const dims = grading?.level5?.dimensions;
    let raw: unknown = null;
    if (Array.isArray(dims)) {
      raw = dims.find((d) => d?.key === def.key)?.judgement;
    } else if (dims && typeof dims === "object") {
      raw = (dims as Record<string, { judgement?: unknown }>)[def.key]?.judgement;
    }
    push(
      `level5.dimensions.${def.key}.judgement`,
      `L5 ${def.section} ${def.label}`,
      raw,
    );
  }

  return out;
}

/** Level 4 dimensions, tolerating both the stored array and the form record. */
function level4Dimensions(
  grading: any,
): Array<{ key: string; label: string; raw: unknown }> {
  const dims = grading?.level4?.dimensions;
  const labelOf = (key: string, fallback?: unknown) =>
    LEVEL4_DIMENSIONS.find((d) => d.key === key)?.label ??
    (typeof fallback === "string" && fallback ? fallback : key);

  if (Array.isArray(dims)) {
    return dims
      .filter((d) => d && typeof d === "object" && typeof d.key === "string")
      .map((d) => ({
        key: d.key,
        label: labelOf(d.key, d.label),
        raw: d.aiJustificationHallucination,
      }));
  }
  if (dims && typeof dims === "object") {
    return Object.entries(dims as Record<string, any>).map(([key, d]) => ({
      key,
      label: labelOf(key, d?.label),
      raw: d?.aiJustificationHallucination,
    }));
  }
  return [];
}

/**
 * Human label for a categorical path when no grading data is around to read a
 * richer one from. The tiebreaker can flag any question, including ones the
 * first two graders agreed on, so raw paths must never reach the dashboard.
 */
export function describeCategoricalPath(path: string): string {
  const l4 = /^level4\.dimensions\.([^.]+)\.aiJustificationHallucination$/.exec(
    path,
  );
  if (l4) {
    const label =
      LEVEL4_DIMENSIONS.find((d) => d.key === l4[1])?.label ?? l4[1];
    return `L4 ${label} hallucination`;
  }

  const l5 = /^level5\.dimensions\.([^.]+)\.judgement$/.exec(path);
  if (l5) return `L5 ${level5LabelForKey(l5[1])}`;

  const list = /^level1\.(structures|instruments)\.(\d+)\.(.+)$/.exec(path);
  if (list) {
    const kind = list[1] === "structures" ? "Structure" : "Instrument";
    const n = Number(list[2]) + 1;
    const leaf =
      list[3] === "correct" ? "" : ` ${list[3] === "incorrectReason" ? "error type" : list[3]}`;
    return `L1 ${kind} ${n}${leaf}`;
  }

  const phase = /^level2\.phases\.(\d+)\.(.+)$/.exec(path);
  if (phase) {
    const n = Number(phase[1]) + 1;
    const leaf: Record<string, string> = {
      segmentationCorrect: "timing",
      contentCorrect: "content",
      phaseErrorType: "error type",
      trueStartTime: "True Start",
      trueEndTime: "True End",
    };
    return `L2 Phase ${n} ${leaf[phase[2]] ?? phase[2]}`;
  }

  const simple: Record<string, string> = {
    "level1.procedureTypeCorrect": "L1 Procedure Type",
    "level1.spatialPositioningCorrect": "L1 Spatial Positioning",
    "level1.missedInstrumentsCount": "L1 Missed instrument count",
    "level2.missedStepsDetectedCorrect": "L2 Missed-steps content",
    "level3.surgeryCompleted": "L3 Surgery completed",
    "level3.nextActionAccurate": "L3 Next action accurate",
    "level3.nomenclatureStandardized": "L3 Nomenclature",
    "level3.safetyCheckPass": "L3 Safety check",
  };
  return simple[path] ?? path;
}

function normToken(raw: unknown): string | null {
  // Boolean true/false are used both for correct/incorrect and for yes/no
  // fields in stored payloads; callers that need yes/no semantics use
  // compareTokenForPath.
  if (raw === true || raw === "correct") return "true";
  if (raw === false || raw === "incorrect") return "false";
  if (raw === "yes" || raw === "Yes") return "yes";
  if (raw === "no" || raw === "No") return "no";
  if (raw === "pass") return "pass";
  if (raw === "fail") return "fail";
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return String(raw);
}

/** Compare token that unifies yes/no with boolean for hallucination & surgery. */
export function compareTokenForPath(path: string, raw: unknown): string | null {
  if (isLevel5JudgementPath(path)) {
    return level5JudgementOf(raw);
  }
  if (isYesNoPath(path)) {
    if (raw === true || raw === "yes" || raw === "Yes") return "yes";
    if (raw === false || raw === "no" || raw === "No") return "no";
    return null;
  }
  if (isSafetyCheckPath(path)) {
    if (raw === true || raw === "pass" || raw === "Pass") return "pass";
    if (raw === false || raw === "fail" || raw === "Fail") return "fail";
    return null;
  }
  if (isMissedInstrumentCountPath(path)) {
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : null;
  }
  return normToken(raw);
}

/** Public compare token for discrepancy consensus. */
export function categoricalCompareToken(raw: unknown): string | null {
  return normToken(raw);
}

/** When saving a discrepancy answer, also copy these related paths from the form. */
export function relatedDiscrepancyPaths(fieldPath: string): string[] {
  const paths = [fieldPath];
  if (fieldPath.endsWith(".correct")) {
    paths.push(
      fieldPath.replace(/\.correct$/, ".incorrectReason"),
      fieldPath.replace(/\.correct$/, ".expertCorrection"),
    );
  }
  if (fieldPath.endsWith(".contentCorrect")) {
    paths.push(
      fieldPath.replace(/\.contentCorrect$/, ".phaseErrorType"),
      fieldPath.replace(/\.contentCorrect$/, ".expertCorrectDescription"),
    );
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
  if (fieldPath === "level1.missedInstrumentsCount") {
    paths.push("level1.missedInstruments");
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

/**
 * Walk one path segment. Level 4 dimensions are stored as an array of
 * `{ key, ... }` in the payload but keyed by dimension name in the form, so a
 * non-numeric segment on an array is matched against `key`.
 */
function stepInto(cur: any, segment: string): any {
  if (cur == null) return null;
  if (Array.isArray(cur) && !/^\d+$/.test(segment)) {
    return (
      cur.find((el) => el && typeof el === "object" && el.key === segment) ??
      null
    );
  }
  return cur[segment];
}

/** Get comparable token for a path from grading payload. */
export function getCategoricalRaw(grading: any, path: string): unknown {
  const parts = path.split(".");
  let cur: any = grading;
  for (const p of parts) {
    if (cur == null) return null;
    cur = stepInto(cur, p);
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
    const na = compareTokenForPath(path, a);
    const nb = compareTokenForPath(path, b);
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
  if (isLevel5JudgementPath(fieldPath)) {
    return [
      { value: "correct", label: level5JudgementLabel("correct") },
      { value: "hallucinate", label: level5JudgementLabel("hallucinate") },
      { value: "missed", label: level5JudgementLabel("missed") },
    ];
  }
  if (isYesNoPath(fieldPath)) {
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

    if (Array.isArray(cur) && !/^\d+$/.test(p)) {
      let el = cur.find((x) => x && typeof x === "object" && x.key === p);
      if (!el) {
        el = { key: p };
        cur.push(el);
      }
      cur = el;
      continue;
    }

    const wantArray = /^\d+$/.test(next);
    if (cur[p] == null || typeof cur[p] !== "object") {
      cur[p] = wantArray ? [] : {};
    }
    cur = cur[p];
  }

  const last = parts[parts.length - 1];
  if (Array.isArray(cur) && !/^\d+$/.test(last)) return;
  cur[last] = value;
}
