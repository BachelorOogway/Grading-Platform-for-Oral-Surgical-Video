/**
 * Level 5 surgical-report dimensions.
 * 5.1, 5.3, and 5.4 are shared. 5.2 uses one procedure group per video,
 * chosen from the AI Procedure Type (Level 1).
 */

export type Level5Group =
  | "approach"
  | "extraction"
  | "implant"
  | "omfs"
  | "events"
  | "closure";

export type Level5Judgement = "correct" | "hallucinate" | "missed";

export type Level5DimensionDef = {
  key: string;
  /** 5.1 | 5.2 | 5.3 | 5.4 */
  section: "5.1" | "5.2" | "5.3" | "5.4";
  group: Level5Group;
  label: string;
  hint?: string;
};

export const LEVEL5_DIMENSIONS: Level5DimensionDef[] = [
  {
    key: "incisionType",
    section: "5.1",
    group: "approach",
    label: "Incision type",
    hint: "e.g. angular flap",
  },
  {
    key: "flapExtent",
    section: "5.1",
    group: "approach",
    label: "Flap extent",
  },
  {
    key: "boneRemoval",
    section: "5.1",
    group: "approach",
    label: "Amount of bone removal",
  },
  {
    key: "rootIntegrity",
    section: "5.2",
    group: "extraction",
    label: "Root integrity",
    hint: "root fracture / residual root",
  },
  {
    key: "socketManagement",
    section: "5.2",
    group: "extraction",
    label: "Socket management",
  },
  {
    key: "socketBleedingBoneWall",
    section: "5.2",
    group: "extraction",
    label: "Socket bleeding and bony-wall integrity",
  },
  {
    key: "implantSite",
    section: "5.2",
    group: "implant",
    label: "Implant site",
  },
  {
    key: "implantSpec",
    section: "5.2",
    group: "implant",
    label: "Implant brand / specification",
    hint: "diameter × length",
  },
  {
    key: "insertionTorque",
    section: "5.2",
    group: "implant",
    label: "Insertion torque",
    hint: "N·cm",
  },
  {
    key: "isq",
    section: "5.2",
    group: "implant",
    label: "ISQ stability",
  },
  {
    key: "boneQuality",
    section: "5.2",
    group: "implant",
    label: "Bone quality",
    hint: "Type I–IV",
  },
  {
    key: "gbrSinusLift",
    section: "5.2",
    group: "implant",
    label: "GBR / sinus lift",
  },
  {
    key: "resectionExtent",
    section: "5.2",
    group: "omfs",
    label: "Extent of resection",
  },
  {
    key: "marginStatus",
    section: "5.2",
    group: "omfs",
    label: "Margin status",
  },
  {
    key: "pathologySpecimen",
    section: "5.2",
    group: "omfs",
    label: "Pathology specimen",
  },
  {
    key: "hemostasisPacking",
    section: "5.2",
    group: "omfs",
    label: "Hemostasis and packing",
    hint: "gelatin sponge, iodoform gauze, etc.",
  },
  {
    key: "abnormalAnatomy",
    section: "5.3",
    group: "events",
    label: "Abnormal anatomy / pathology",
    hint: "nerve exposure, sinus-membrane perforation, anatomic variation",
  },
  {
    key: "unexpectedEvents",
    section: "5.3",
    group: "events",
    label: "Unexpected events",
    hint: "root displacement, adjacent-tooth injury, unusual bleeding, cortical fracture, instrument breakage",
  },
  {
    key: "responseMeasures",
    section: "5.3",
    group: "events",
    label: "Management",
  },
  {
    key: "sutureClosure",
    section: "5.4",
    group: "closure",
    label: "Suture and closure",
    hint: "suture material, technique, wound approximation",
  },
];

export const LEVEL5_DIMENSION_KEYS = LEVEL5_DIMENSIONS.map((d) => d.key);

export const LEVEL5_DIMENSION_COUNT = LEVEL5_DIMENSIONS.length;

export type Level5ProcedureKind = "extraction" | "implant" | "omfs";

const KIND_PATTERNS: Record<Level5ProcedureKind, RegExp> = {
  extraction: /extract|impaction|impacted|exodont|supernumerary|tooth removal/i,
  implant: /implant|\bgbr\b|guided bone|sinus\s*lift|sinus\s*elevat|osseointegrat/i,
  omfs: /resect|lesion|biopsy|\bcyst\b|tumou?r|patholog|enucleat/i,
};

export function level5KindLabel(kind: Level5ProcedureKind): string {
  if (kind === "extraction") return "Extraction";
  if (kind === "implant") return "Implant";
  return "Oral & maxillofacial / pathology";
}

/** One video, one 5.2 block. Highest keyword score wins; ties use the first clause. */
export function detectLevel5ProcedureKind(procedureType: string): Level5ProcedureKind {
  const text = procedureType ?? "";
  const score = (kind: Level5ProcedureKind) =>
    (text.match(new RegExp(KIND_PATTERNS[kind].source, "gi")) ?? []).length;
  const ranked = (["extraction", "implant", "omfs"] as Level5ProcedureKind[]).sort(
    (a, b) => score(b) - score(a),
  );
  if (score(ranked[0]) === 0) return "extraction";
  if (score(ranked[0]) !== score(ranked[1])) return ranked[0];
  const first = text.split("|")[0] ?? text;
  for (const kind of ["extraction", "implant", "omfs"] as const) {
    if (KIND_PATTERNS[kind].test(first)) return kind;
  }
  return ranked[0];
}

export function level5ActiveDimensions(kind: Level5ProcedureKind) {
  return LEVEL5_DIMENSIONS.filter(
    (d) => d.section !== "5.2" || d.group === kind,
  );
}

/** Headings used by the operative-report template. Order is display order. */
export const LEVEL5_REPORT_HEADINGS: Array<{ key: string; label: string; re: RegExp }> = [
  { key: "preop", label: "Pre-operative Diagnosis", re: /Pre-?\s*operative\s+Diagnosis\s*:/i },
  { key: "postopDx", label: "Post-operative Diagnosis", re: /Post-?\s*operative\s+Diagnosis\s*:/i },
  { key: "anesthesia", label: "Anesthesia / Hemostasis", re: /Anesthesia\s*\/\s*Hemostasis\s*:/i },
  { key: "findings", label: "Surgical Findings", re: /Surgical\s+Findings\s*:/i },
  { key: "narrative", label: "Step-by-Step Narrative", re: /Step-by-Step\s+Narrative\s*:/i },
  {
    key: "complications",
    label: "Complications / Estimated Blood Loss",
    re: /Complications\s*\/\s*Estimated\s+Blood\s+Loss\s*:/i,
  },
  {
    key: "disposition",
    label: "Post-operative Disposition",
    re: /Post-?\s*operative\s+Disposition\s*:/i,
  },
];

/** Drop the expert-evaluation stub that follows the AI report. */
export function cleanLevel5Report(raw: string): string {
  return (raw ?? "").split(/\[Human\s+Expert\s+Evaluation/i)[0].trim();
}

export type Level5ReportSection = { key: string; label: string; body: string };

/** Split a free-form report into the operative-report headings when present. */
export function splitLevel5Report(raw: string): Level5ReportSection[] {
  const text = cleanLevel5Report(raw);
  if (!text) return [];

  const hits: Array<{ key: string; label: string; index: number; end: number }> = [];
  for (const h of LEVEL5_REPORT_HEADINGS) {
    const m = h.re.exec(text);
    if (!m || m.index == null) continue;
    hits.push({
      key: h.key,
      label: h.label,
      index: m.index,
      end: m.index + m[0].length,
    });
  }
  hits.sort((a, b) => a.index - b.index);
  if (hits.length === 0) return [{ key: "report", label: "Operative Report", body: text }];

  return hits.map((h, i) => {
    const next = hits[i + 1]?.index ?? text.length;
    return {
      key: h.key,
      label: h.label,
      body: text.slice(h.end, next).trim(),
    };
  });
}

export function level5LabelForKey(key: string): string {
  return LEVEL5_DIMENSIONS.find((d) => d.key === key)?.label ?? key;
}

export function isLevel5JudgementPath(path: string): boolean {
  return /^level5\.dimensions\.[^.]+\.judgement$/.test(path);
}

export function level5JudgementOf(raw: unknown): Level5Judgement | null {
  if (raw === "correct" || raw === true) return "correct";
  if (
    raw === "hallucinate" ||
    raw === "not_mentioned_hallucinate" ||
    raw === "Not Mentioned but Hallucinate"
  ) {
    return "hallucinate";
  }
  if (
    raw === "missed" ||
    raw === "mentioned_missed" ||
    raw === "Mentioned but Missed"
  ) {
    return "missed";
  }
  return null;
}

export function level5JudgementLabel(j: Level5Judgement | null): string {
  if (j === "correct") return "Correct (including true negative)";
  if (j === "hallucinate") return "Not Mentioned but Hallucinate";
  if (j === "missed") return "Mentioned but Missed";
  return "—";
}

type DimLike = { key?: unknown; judgement?: unknown };

function dimsFromGrading(grading: unknown): DimLike[] {
  const l5 = (grading as { level5?: { dimensions?: unknown } } | null)?.level5;
  const dims = l5?.dimensions;
  if (Array.isArray(dims)) return dims as DimLike[];
  if (dims && typeof dims === "object") {
    return Object.entries(dims as Record<string, { judgement?: unknown }>).map(
      ([key, d]) => ({ key, judgement: d?.judgement }),
    );
  }
  return [];
}

export type Level5ScoreSummary = {
  reportScore: number;
  correctCount: number;
  hallucinateCount: number;
  missedCount: number;
  labeledCount: number;
  total: number;
  byKey: Record<string, Level5Judgement | "">;
};

/** Report score = Correct items among the dimensions active for this procedure kind. */
export function level5ScoreFromGrading(grading: unknown): Level5ScoreSummary {
  const stored = new Map<string, unknown>();
  for (const d of dimsFromGrading(grading)) {
    if (d?.key) stored.set(String(d.key), d.judgement);
  }
  const rawKind = (grading as { level5?: { procedureKind?: unknown } } | null)
    ?.level5?.procedureKind;
  const kind =
    rawKind === "extraction" || rawKind === "implant" || rawKind === "omfs"
      ? rawKind
      : null;
  const defs = kind ? level5ActiveDimensions(kind) : LEVEL5_DIMENSIONS;
  const byKey: Record<string, Level5Judgement | ""> = {};
  let correctCount = 0;
  let hallucinateCount = 0;
  let missedCount = 0;
  for (const def of defs) {
    const j = level5JudgementOf(stored.get(def.key));
    byKey[def.key] = j ?? "";
    if (j === "correct") correctCount += 1;
    else if (j === "hallucinate") hallucinateCount += 1;
    else if (j === "missed") missedCount += 1;
  }
  const labeledCount = correctCount + hallucinateCount + missedCount;
  return {
    reportScore: correctCount,
    correctCount,
    hallucinateCount,
    missedCount,
    labeledCount,
    total: defs.length,
    byKey,
  };
}
