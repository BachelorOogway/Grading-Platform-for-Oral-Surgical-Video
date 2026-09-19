/**
 * Level 5 surgical-report dimensions. The set is identical for every video:
 * 5.2 procedure groups are display filters only, never a different score set.
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
    label: "切口类型",
    hint: "如角形瓣",
  },
  {
    key: "flapExtent",
    section: "5.1",
    group: "approach",
    label: "翻瓣范围",
  },
  {
    key: "boneRemoval",
    section: "5.1",
    group: "approach",
    label: "去骨量",
  },
  {
    key: "rootIntegrity",
    section: "5.2",
    group: "extraction",
    label: "牙根完整性",
    hint: "断根 / 残留",
  },
  {
    key: "socketManagement",
    section: "5.2",
    group: "extraction",
    label: "牙槽窝处置",
  },
  {
    key: "socketBleedingBoneWall",
    section: "5.2",
    group: "extraction",
    label: "拔牙创出血与骨壁完整性",
  },
  {
    key: "implantSite",
    section: "5.2",
    group: "implant",
    label: "植入部位",
  },
  {
    key: "implantSpec",
    section: "5.2",
    group: "implant",
    label: "种植体品牌 / 规格",
    hint: "直径 × 长度",
  },
  {
    key: "insertionTorque",
    section: "5.2",
    group: "implant",
    label: "植入扭矩",
    hint: "N·cm",
  },
  {
    key: "isq",
    section: "5.2",
    group: "implant",
    label: "ISQ 稳定性",
  },
  {
    key: "boneQuality",
    section: "5.2",
    group: "implant",
    label: "骨质分类",
    hint: "Type I–IV",
  },
  {
    key: "gbrSinusLift",
    section: "5.2",
    group: "implant",
    label: "GBR / 上颌窦提升",
  },
  {
    key: "resectionExtent",
    section: "5.2",
    group: "omfs",
    label: "病变切除范围",
  },
  {
    key: "marginStatus",
    section: "5.2",
    group: "omfs",
    label: "边缘状态",
  },
  {
    key: "pathologySpecimen",
    section: "5.2",
    group: "omfs",
    label: "病理标本送检",
  },
  {
    key: "hemostasisPacking",
    section: "5.2",
    group: "omfs",
    label: "止血及填塞物",
    hint: "明胶海绵 / 碘仿纱条等",
  },
  {
    key: "abnormalAnatomy",
    section: "5.3",
    group: "events",
    label: "异常解剖 / 病理",
    hint: "神经暴露、上颌窦黏膜穿破、解剖变异",
  },
  {
    key: "unexpectedEvents",
    section: "5.3",
    group: "events",
    label: "意外事件",
    hint: "断根移位、邻牙损伤、异常大出血、骨板骨折、器械折断",
  },
  {
    key: "responseMeasures",
    section: "5.3",
    group: "events",
    label: "应对措施",
  },
  {
    key: "sutureClosure",
    section: "5.4",
    group: "closure",
    label: "缝合与闭合状态",
    hint: "缝线类型、缝合方式、创口对合程度",
  },
];

export const LEVEL5_DIMENSION_KEYS = LEVEL5_DIMENSIONS.map((d) => d.key);

export const LEVEL5_DIMENSION_COUNT = LEVEL5_DIMENSIONS.length;

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

/** Report score = number of dimensions judged Correct. Total is always the fixed set. */
export function level5ScoreFromGrading(grading: unknown): Level5ScoreSummary {
  const stored = new Map<string, unknown>();
  for (const d of dimsFromGrading(grading)) {
    if (d?.key) stored.set(String(d.key), d.judgement);
  }
  const byKey: Record<string, Level5Judgement | ""> = {};
  let correctCount = 0;
  let hallucinateCount = 0;
  let missedCount = 0;
  for (const def of LEVEL5_DIMENSIONS) {
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
    total: LEVEL5_DIMENSION_COUNT,
    byKey,
  };
}
