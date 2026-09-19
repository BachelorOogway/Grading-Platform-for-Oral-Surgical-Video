import {
  LEVEL4_DIMENSIONS,
  matchLevel4DimensionKey,
} from "./level4Dimensions";

export type AiPhase = {
  aiStartTime: string;
  aiEndTime: string;
  description: string;
};

export type AiStructure = { name: string };
export type AiInstrument = { name: string };

export type AiLevel4Dimension = {
  key: string;
  label: string;
  aiScore: number;
  justification: string;
};

export type AiParsedData = {
  level1: {
    procedureType: string;
    structures: AiStructure[];
    totalStructures: number | null;
    instruments: AiInstrument[];
    totalInstruments: number | null;
    spatialPositioning: string;
  };
  level2: {
    phases: AiPhase[];
    totalPhases: number | null;
    missedStepsEvaluation: string;
    /** Count of missed phases/steps inferred from AI Missed Steps Evaluation */
    aiMissedPhasesCount: number | null;
  };
  level3: {
    nextActionPrediction: string;
    clinicalRationale: string;
    surgeryCompleted: string | null;
  };
  level4: {
    dimensions: AiLevel4Dimension[];
  };
  /** Free-form surgical report (markdown). Same expert dimensions for every video. */
  level5: {
    report: string;
  };
};

function safeTrim(s: string) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function extractSection(text: string, startRe: RegExp, endRe: RegExp) {
  const startMatch = startRe.exec(text);
  if (!startMatch) return "";
  const from = startMatch.index;
  const rest = text.slice(from + startMatch[0].length);
  const endMatch = endRe.exec(rest);
  const body = endMatch ? rest.slice(0, endMatch.index) : rest;
  return body;
}

function parseCount(line: string, label: string): number | null {
  const re = new RegExp(`${label}:\\s*(\\d+)`, "i");
  const m = re.exec(line);
  return m ? Number(m[1]) : null;
}

function stripHeaderPrefix(line: string, prefix: string) {
  const re = new RegExp(`^${prefix}\\s*:?\\s*`, "i");
  return safeTrim(line.replace(re, ""));
}

function parseItemsBeforeEval(
  section: string,
  evalMarker: string,
  headerPrefix?: string,
): string[] {
  const items: string[] = [];
  const markerRe = new RegExp(
    `\\[Human Expert Evaluation:\\s*${evalMarker}\\]`,
    "gi",
  );
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const text = section;

  while ((m = markerRe.exec(text))) {
    const chunk = text.slice(lastIndex, m.index);
    const lines = chunk
      .split(/\r?\n/)
      .map((l) => safeTrim(l))
      .filter(Boolean);

    let name = "";
    if (lines.length > 0) {
      name = lines[lines.length - 1];
      if (headerPrefix && items.length === 0) {
        name = stripHeaderPrefix(name, headerPrefix);
      }
    }

    if (name) items.push(name);
    lastIndex = markerRe.lastIndex;
  }

  return items;
}

function parseLevel1(text: string): AiParsedData["level1"] {
  const section = extractSection(
    text,
    /Level\s*1\s*Analysis/i,
    /Level\s*2\s*Analysis/i,
  );

  let procedureType = "";
  const procMatch =
    /Procedure\s+Type\s*:\s*([\s\S]*?)\s*\[Human\s+Expert\s+Evaluation:\s*Procedure\s+Type\]/i.exec(
      section,
    );
  if (procMatch) {
    procedureType = safeTrim(procMatch[1]);
  } else {
    const fallback = /Procedure\s+Type\s*:\s*(.+)$/im.exec(section);
    procedureType = fallback ? safeTrim(fallback[1]) : "";
  }

  const structuresSection = extractSection(
    section,
    /Anatomical\s+and\s+Pathological\s+Structures/i,
    /Total\s+number\s+of\s+detected\s+structures|Instrument\s+Inventory/i,
  );
  const structureNames = parseItemsBeforeEval(
    structuresSection,
    "Structures",
    "Anatomical and Pathological Structures",
  );

  const totalStructuresLine = section.match(
    /Total\s+number\s+of\s+detected\s+structures\s*:\s*(\d+)/i,
  );
  const totalStructures = totalStructuresLine
    ? Number(totalStructuresLine[1])
    : null;

  const instrumentsSection = extractSection(
    section,
    /Instrument\s+Inventory/i,
    /Total\s+number\s+of\s+detected\s+instruments/i,
  );
  const instrumentNames = parseItemsBeforeEval(
    instrumentsSection,
    "Inventory",
    "Instrument Inventory",
  );

  const totalInstrumentsLine = section.match(
    /Total\s+number\s+of\s+detected\s+instruments\s*:\s*(\d+)/i,
  );
  const totalInstruments = totalInstrumentsLine
    ? Number(totalInstrumentsLine[1])
    : null;

  let spatialPositioning = "";
  const spatialMatch =
    /Spatial\s+Positioning\s*:\s*([\s\S]*?)\s*\[Human\s+Expert\s+Evaluation:\s*Spatial\s+Positioning\]/i.exec(
      section,
    );
  if (spatialMatch) {
    spatialPositioning = safeTrim(spatialMatch[1]);
  } else {
    const fallback = /Spatial\s+Positioning\s*:\s*(.+)$/im.exec(section);
    spatialPositioning = fallback ? safeTrim(fallback[1]) : "";
  }

  return {
    procedureType,
    structures: structureNames.map((name) => ({ name })),
    totalStructures,
    instruments: instrumentNames.map((name) => ({ name })),
    totalInstruments,
    spatialPositioning,
  };
}

function parseLevel2(text: string): AiParsedData["level2"] {
  const section = extractSection(
    text,
    /Level\s*2\s*Analysis/i,
    /Level\s*3\s*Analysis/i,
  );

  const phases: AiPhase[] = [];
  // Accept both compact [00:00:00 to 00:00:18] and spaced [ 00 : 00 : 00 to 00 : 00 : 18 ]
  const phaseRegex =
    /\[\s*(\d{1,2})\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})\s+to\s+(\d{1,2})\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})\s*\]\s*-\s*([^\r\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = phaseRegex.exec(section))) {
    const pad = (n: string) => String(Number(n)).padStart(2, "0");
    const description = safeTrim(m[7])
      .split(/\[Human Expert Evaluation/i)[0]
      .trim();
    phases.push({
      aiStartTime: `${pad(m[1])}:${pad(m[2])}:${pad(m[3])}`,
      aiEndTime: `${pad(m[4])}:${pad(m[5])}:${pad(m[6])}`,
      description: safeTrim(description),
    });
  }

  let missedStepsEvaluation = "";
  const missedMatch =
    /Missed\s+Steps\s+Evaluation\s*:\s*([\s\S]*?)(?=\[Human\s+Expert\s+Evaluation\]|$)/i.exec(
      section,
    );
  if (missedMatch) {
    missedStepsEvaluation = safeTrim(missedMatch[1]);
  }

  const totalPhasesLine = section.match(
    /Total\s+number\s+of\s+detected\s+phases\s*:\s*(\d+)/i,
  );
  const totalPhases = totalPhasesLine
    ? Number(totalPhasesLine[1])
    : phases.length;

  const aiMissedPhasesCount = inferAiMissedPhasesCount(missedStepsEvaluation, section);

  return { phases, totalPhases, missedStepsEvaluation, aiMissedPhasesCount };
}

/**
 * Infer how many missed phases/steps the AI claims.
 * Prefers an explicit number; otherwise counts listed items; "None detected" → 0.
 */
export function inferAiMissedPhasesCount(
  missedStepsEvaluation: string,
  fullLevel2Section: string,
): number | null {
  const explicit =
    /(?:Number of\s+)?missed\s+(?:phases|steps)\s*(?:detected|evaluation)?\s*[:=]?\s*(\d+)/i.exec(
      fullLevel2Section,
    ) ||
    /Total number of missed (?:phases|steps):\s*(\d+)/i.exec(fullLevel2Section);
  if (explicit) {
    const n = Number(explicit[1]);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  const text = safeTrim(missedStepsEvaluation);
  if (!text) return null;

  if (
    /^(none(\s+detected)?|n\/?a|no(\s+missed)?(\s+(phases|steps))?|nil|null)(\.|!)?$/i.test(
      text,
    )
  ) {
    return 0;
  }

  if (/^none\b/i.test(text) && text.length < 80) return 0;

  const numbered = text.match(/(?:^|\n)\s*(?:\d+[.)]|[-*•])\s+\S+/g);
  if (numbered && numbered.length > 0) return numbered.length;

  const parts = text
    .split(/\n|;|\|(?=\s)/)
    .map((s) => safeTrim(s))
    .filter((s) => s.length > 0)
    .filter((s) => !/^(missed steps evaluation|none)/i.test(s));

  if (parts.length >= 2) return parts.length;
  if (parts.length === 1) {
    // Single sentence that is not "none" → treat as one claimed miss
    return 1;
  }
  return 0;
}

function parseLevel3(text: string): AiParsedData["level3"] {
  const section = extractSection(
    text,
    /Level\s*3\s*Analysis/i,
    /Level\s*4\s*Analysis/i,
  );

  const surgeryCompletedMatch =
    /Is\s+the\s+surgery\s+completed\?\s*\[?\s*(Yes|No)\s*\]?/i.exec(section) ||
    /Is\s+the\s+surgery\s+completed\?\s*(Yes|No)/i.exec(section);
  const surgeryCompleted = surgeryCompletedMatch
    ? surgeryCompletedMatch[1]
    : null;

  let nextActionPrediction = "";
  let clinicalRationale = "";

  // Allow newlines / odd spacing between the label and the value.
  const nextMatch =
    /Next\s+Action\s+Prediction\s*:\s*([\s\S]*?)(?=Clinical\s+Rationale\s*:|\[Human\s+Expert\s+Evaluation|$)/i.exec(
      section,
    );
  if (nextMatch) {
    nextActionPrediction = safeTrim(nextMatch[1]);
  }

  const rationaleMatch =
    /Clinical\s+Rationale\s*:\s*([\s\S]*?)(?=\[Human\s+Expert\s+Evaluation|$)/i.exec(
      section,
    );
  if (rationaleMatch) {
    clinicalRationale = safeTrim(rationaleMatch[1]);
  }

  return {
    nextActionPrediction,
    clinicalRationale,
    surgeryCompleted,
  };
}

/**
 * Parse Level 4 score blocks. Tolerant of:
 * - case / punctuation / extra spaces in dimension titles
 * - newlines inside justifications
 * - alternate titles (see LEVEL4_DIMENSIONS.aliases)
 *
 * Expected shape per dimension:
 *   <Label>: <score> - <justification...>
 *   [Human Expert Evaluation ...]   (optional)
 */
function parseLevel4(text: string): AiParsedData["level4"] {
  const sectionMatch = text.match(
    /Level\s*4\s*Analysis[\s\S]*?(?=Level\s*5\b|$)/i,
  );
  const section = sectionMatch?.[0] ?? "";

  // Anchor each "Label: score -" on a single line (labels never span newlines).
  const anchorRe =
    /(^|[\r\n])[ \t]*([A-Za-z][A-Za-z0-9/()'&., \t-]{1,100}?)[ \t]*:[ \t]*(\d)[ \t]*[-–—][ \t]*/g;

  type Anchor = {
    label: string;
    score: number;
    bodyStart: number;
    matchStart: number;
  };
  const anchors: Anchor[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(section))) {
    const label = safeTrim(m[2]);
    if (/^level\s*4/i.test(label)) continue;
    if (/human\s+expert/i.test(label)) continue;
    if (/expert\s+given\s+score/i.test(label)) continue;
    const score = Number(m[3]);
    if (!Number.isFinite(score)) continue;
    anchors.push({
      label,
      score,
      bodyStart: m.index + m[0].length,
      matchStart: m.index,
    });
  }

  const found = new Map<string, AiLevel4Dimension>();
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const key = matchLevel4DimensionKey(a.label);
    if (!key || found.has(key)) continue;
    const def = LEVEL4_DIMENSIONS.find((d) => d.key === key);
    if (!def) continue;

    const bodyEnd =
      i + 1 < anchors.length ? anchors[i + 1].matchStart : section.length;
    let justification = section.slice(a.bodyStart, bodyEnd);
    justification = justification.split(/\[Human\s+Expert\s+Evaluation/i)[0];
    justification = safeTrim(justification);
    if (!justification) continue;

    found.set(key, {
      key: def.key,
      label: def.label,
      aiScore: a.score,
      justification,
    });
  }

  const dimensions: AiLevel4Dimension[] = [];
  for (const def of LEVEL4_DIMENSIONS) {
    const row = found.get(def.key);
    if (row) dimensions.push(row);
  }

  return { dimensions };
}

function parseLevel5(text: string): AiParsedData["level5"] {
  const m = /Level\s*5\b[^\n]*\r?\n?([\s\S]*)$/i.exec(text ?? "");
  const body = (m?.[1] ?? "").split(/\[Human\s+Expert\s+Evaluation/i)[0].trim();
  return { report: body };
}

export function parseAiOutputToParsedData(inputText: string): AiParsedData {
  const text = inputText ?? "";
  return {
    level1: parseLevel1(text),
    level2: parseLevel2(text),
    level3: parseLevel3(text),
    level4: parseLevel4(text),
    level5: parseLevel5(text),
  };
}

export type AiParseValidation = {
  ok: boolean;
  missing: string[];
  message: string;
};

function pushMissing(missing: string[], label: string, ok: boolean) {
  if (!ok) missing.push(label);
}

/**
 * Every parsed field must be present for an upload to be accepted.
 * Empty Level 4 AI scores (or any other blank required field) fail validation
 * so the admin is told to fix the text and re-upload.
 */
export function validateAiParsedData(parsed: AiParsedData): AiParseValidation {
  const missing: string[] = [];
  const l1 = parsed.level1;
  const l2 = parsed.level2;
  const l3 = parsed.level3;
  const l4 = parsed.level4;

  pushMissing(missing, "Level 1 Procedure Type", Boolean(l1.procedureType?.trim()));
  pushMissing(
    missing,
    "Level 1 Anatomical/Pathological Structures (at least one)",
    Array.isArray(l1.structures) &&
      l1.structures.length > 0 &&
      l1.structures.every((s) => Boolean(s?.name?.trim())),
  );
  pushMissing(
    missing,
    "Level 1 Total number of detected structures",
    l1.totalStructures != null && Number.isFinite(l1.totalStructures),
  );
  pushMissing(
    missing,
    "Level 1 Instrument Inventory (at least one)",
    Array.isArray(l1.instruments) &&
      l1.instruments.length > 0 &&
      l1.instruments.every((s) => Boolean(s?.name?.trim())),
  );
  pushMissing(
    missing,
    "Level 1 Total number of detected instruments",
    l1.totalInstruments != null && Number.isFinite(l1.totalInstruments),
  );
  pushMissing(
    missing,
    "Level 1 Spatial Positioning",
    Boolean(l1.spatialPositioning?.trim()),
  );

  pushMissing(
    missing,
    "Level 2 phases (at least one timed phase)",
    Array.isArray(l2.phases) &&
      l2.phases.length > 0 &&
      l2.phases.every(
        (p) =>
          Boolean(p.aiStartTime?.trim()) &&
          Boolean(p.aiEndTime?.trim()) &&
          Boolean(p.description?.trim()),
      ),
  );
  pushMissing(
    missing,
    "Level 2 Total number of detected phases",
    l2.totalPhases != null && Number.isFinite(l2.totalPhases),
  );
  pushMissing(
    missing,
    "Level 2 Missed Steps Evaluation",
    Boolean(l2.missedStepsEvaluation?.trim()),
  );

  pushMissing(
    missing,
    "Level 3 Is the surgery completed? (Yes/No)",
    l3.surgeryCompleted === "Yes" ||
      l3.surgeryCompleted === "No" ||
      l3.surgeryCompleted === "yes" ||
      l3.surgeryCompleted === "no",
  );
  pushMissing(
    missing,
    "Level 3 Next Action Prediction",
    Boolean(l3.nextActionPrediction?.trim()),
  );
  pushMissing(
    missing,
    "Level 3 Clinical Rationale",
    Boolean(l3.clinicalRationale?.trim()),
  );

  pushMissing(
    missing,
    "Level 5 surgical report (text after a Level 5 heading)",
    Boolean(parsed.level5?.report?.trim()),
  );

  const dims = Array.isArray(l4.dimensions) ? l4.dimensions : [];
  const byKey = new Map(dims.map((d) => [d.key, d]));
  for (const def of LEVEL4_DIMENSIONS) {
    const d = byKey.get(def.key);
    const scoreOk =
      d != null &&
      Number.isFinite(d.aiScore) &&
      d.aiScore >= 1 &&
      d.aiScore <= 5;
    const justOk = Boolean(d?.justification?.trim());
    pushMissing(missing, `Level 4 ${def.label} AI score`, scoreOk);
    pushMissing(missing, `Level 4 ${def.label} justification`, justOk);
  }

  if (missing.length === 0) {
    return { ok: true, missing: [], message: "" };
  }

  return {
    ok: false,
    missing,
    message:
      "AI 输出解析不完整，请修正后重新上传。缺失字段：" +
      missing.join("；") +
      "。",
  };
}
