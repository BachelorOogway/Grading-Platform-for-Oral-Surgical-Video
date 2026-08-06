import { LEVEL4_DIMENSIONS } from "./level4Dimensions";

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
    /Procedure Type:\s*(.*?)\s*\[Human Expert Evaluation:\s*Procedure Type\]/is.exec(
      section,
    );
  if (procMatch) {
    procedureType = safeTrim(procMatch[1]);
  } else {
    const fallback = /Procedure Type:\s*(.+)$/im.exec(section);
    procedureType = fallback ? safeTrim(fallback[1]) : "";
  }

  const structuresSection = extractSection(
    section,
    /Anatomical and Pathological Structures/i,
    /Total number of detected structures|Instrument Inventory/i,
  );
  const structureNames = parseItemsBeforeEval(
    structuresSection,
    "Structures",
    "Anatomical and Pathological Structures",
  );

  const totalStructuresLine = section.match(/Total number of detected structures:\s*(\d+)/i);
  const totalStructures = totalStructuresLine ? Number(totalStructuresLine[1]) : null;

  const instrumentsSection = extractSection(
    section,
    /Instrument Inventory/i,
    /Total number of detected instruments/i,
  );
  const instrumentNames = parseItemsBeforeEval(
    instrumentsSection,
    "Inventory",
    "Instrument Inventory",
  );

  const totalInstrumentsLine = section.match(/Total number of detected instruments:\s*(\d+)/i);
  const totalInstruments = totalInstrumentsLine ? Number(totalInstrumentsLine[1]) : null;

  let spatialPositioning = "";
  const spatialMatch =
    /Spatial Positioning:\s*(.*?)\s*\[Human Expert Evaluation:\s*Spatial Positioning\]/is.exec(
      section,
    );
  if (spatialMatch) {
    spatialPositioning = safeTrim(spatialMatch[1]);
  } else {
    const fallback = /Spatial Positioning:\s*(.+)$/im.exec(section);
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
  const phaseRegex =
    /\[(\d{2}:\d{2}:\d{2})\s+to\s+(\d{2}:\d{2}:\d{2})\]\s*-\s*([^\r\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = phaseRegex.exec(section))) {
    phases.push({
      aiStartTime: m[1],
      aiEndTime: m[2],
      description: safeTrim(m[3]),
    });
  }

  const totalPhasesLine = section.match(/Total number of detected phases:\s*(\d+)/i);
  const totalPhases = totalPhasesLine
    ? Number(totalPhasesLine[1])
    : phases.length;

  let missedStepsEvaluation = "";
  const missedMatch =
    /Missed Steps Evaluation:\s*(.+?)(?=\[Human Expert Evaluation\]|$)/is.exec(section);
  if (missedMatch) {
    missedStepsEvaluation = safeTrim(missedMatch[1]);
  }

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
    /Is the surgery completed\?\s*\[?\s*(Yes|No)\s*\]?/i.exec(section) ||
    /Is the surgery completed\?\s*(Yes|No)/i.exec(section);
  const surgeryCompleted = surgeryCompletedMatch
    ? surgeryCompletedMatch[1]
    : null;

  let nextActionPrediction = "";
  let clinicalRationale = "";

  const nextMatch = /Next Action Prediction:\s*(.+)/is.exec(section);
  if (nextMatch) {
    const raw = nextMatch[1];
    const rationaleSplit = /Clinical Rationale:\s*/i.exec(raw);
    if (rationaleSplit) {
      nextActionPrediction = safeTrim(raw.slice(0, rationaleSplit.index));
      clinicalRationale = safeTrim(raw.slice(rationaleSplit.index + rationaleSplit[0].length));
      clinicalRationale = clinicalRationale.split("[Human Expert Evaluation")[0].trim();
    } else {
      nextActionPrediction = safeTrim(raw.split("[Human Expert Evaluation")[0]);
    }
  }

  return {
    nextActionPrediction,
    clinicalRationale,
    surgeryCompleted,
  };
}

function parseLevel4(text: string): AiParsedData["level4"] {
  const sectionMatch = text.match(/Level\s*4\s*Analysis[\s\S]*$/i);
  const section = sectionMatch?.[0] ?? "";

  const dimensions: AiLevel4Dimension[] = [];
  for (const def of LEVEL4_DIMENSIONS) {
    let matched: RegExpExecArray | null = null;
    for (const pattern of def.patterns) {
      matched = pattern.exec(section);
      if (matched) break;
    }
    if (matched) {
      const justification = safeTrim(matched[2]).split(
        /\[Human Expert Evaluation/i,
      )[0];
      dimensions.push({
        key: def.key,
        label: def.label,
        aiScore: Number(matched[1]),
        justification: safeTrim(justification),
      });
    }
  }

  return { dimensions };
}

export function parseAiOutputToParsedData(inputText: string): AiParsedData {
  const text = inputText ?? "";
  return {
    level1: parseLevel1(text),
    level2: parseLevel2(text),
    level3: parseLevel3(text),
    level4: parseLevel4(text),
  };
}
