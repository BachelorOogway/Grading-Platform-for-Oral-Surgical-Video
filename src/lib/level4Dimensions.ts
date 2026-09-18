/**
 * Level 4 OSATS dimensions — single source of truth for parse, form, metrics, export.
 * Rubrics shown to experts (AI scores are hidden on the grading form).
 *
 * AI outputs often vary wording (e.g. "Suture/needle handling", "Quality of final
 * product"). `aliases` lists accepted labels; matching ignores case and collapses
 * whitespace / punctuation so minor formatting changes still parse.
 */

export type Level4RubricLevel = {
  score: 1 | 3 | 5;
  text: string;
};

export type Level4DimensionDef = {
  key: string;
  label: string;
  /**
   * Accepted AI label variants (canonical name first). Matching is
   * case-insensitive and ignores extra spaces / punctuation between words.
   */
  aliases: string[];
  rubrics: Level4RubricLevel[];
};

export const LEVEL4_DIMENSIONS: Level4DimensionDef[] = [
  {
    key: "respectForTissue",
    label: "Respect for Tissue",
    aliases: ["Respect for Tissue", "Respect for tissue"],
    rubrics: [
      {
        score: 1,
        text: "Frequently applies unnecessary force; tissue damage from improper instrument use",
      },
      {
        score: 3,
        text: "Careful tissue handling, minor accidental tissue damage occasionally",
      },
      {
        score: 5,
        text: "Consistently gentle tissue manipulation; minimal tissue trauma",
      },
    ],
  },
  {
    key: "timeAndMotion",
    label: "Time and Motion (Efficiency of Movement)",
    aliases: [
      "Time and Motion (Efficiency of Movement)",
      "Time and Motion",
      "Time and motion",
      "Efficiency of Movement",
    ],
    rubrics: [
      {
        score: 1,
        text: "Abundant redundant, unnecessary movements",
      },
      {
        score: 3,
        text: "Reasonably efficient, but some wasted motions present",
      },
      {
        score: 5,
        text: "Fully economical movements, peak procedural efficiency",
      },
    ],
  },
  {
    key: "instrumentHandling",
    label: "Instrument Handling",
    aliases: [
      "Instrument Handling",
      "Suture/needle handling",
      "Suture / needle handling",
      "Suture needle handling",
      "Needle handling",
      "Suture handling",
    ],
    rubrics: [
      {
        score: 1,
        text: "Repeated hesitant, stiff, awkward instrument manipulation; wrong instruments selected",
      },
      {
        score: 3,
        text: "Competent control; occasional stiff or clumsy movements",
      },
      {
        score: 5,
        text: "Fluid, smooth instrument motion; zero awkwardness",
      },
    ],
  },
  {
    key: "knowledgeOfInstruments",
    label: "Knowledge of Instruments",
    aliases: [
      "Knowledge of Instruments",
      "Knowledge of Instrument",
      // Alternate AI global-rating wording maps onto this OSATS slot
      "Overall performance",
      "Overall Performance",
    ],
    rubrics: [
      {
        score: 1,
        text: "Regularly requests incorrect instruments; unaware of proper tool selection",
      },
      {
        score: 3,
        text: "Knows most instrument names and selects appropriate tools for tasks",
      },
      {
        score: 5,
        text: "Fully familiar with all instruments, their functions and proper usage",
      },
    ],
  },
  {
    key: "flowOfOperation",
    label: "Flow of Operation & Forward Planning",
    aliases: [
      "Flow of Operation & Forward Planning",
      "Flow of Operation and Forward Planning",
      "Flow of Operation",
      "Flow of operation",
      "Forward Planning",
    ],
    rubrics: [
      {
        score: 1,
        text: "Frequent pauses; unsure of upcoming procedural steps",
      },
      {
        score: 3,
        text: "Shows moderate advance planning; logical progression through operation stages",
      },
      {
        score: 5,
        text: "Clear pre-planned surgical workflow; uninterrupted, effortless procedural flow",
      },
    ],
  },
  {
    key: "knowledgeOfSpecificProcedure",
    label: "Knowledge of Specific Procedure",
    aliases: [
      "Knowledge of Specific Procedure",
      "Knowledge of the Specific Procedure",
      // Alternate AI wording maps onto this OSATS slot
      "Quality of final product",
      "Quality of Final Product",
      "Final product quality",
    ],
    rubrics: [
      {
        score: 1,
        text: "Poor understanding of procedural sequence, anatomy and critical steps",
      },
      {
        score: 3,
        text: "Grasp of core procedural steps; minor gaps in detailed knowledge",
      },
      {
        score: 5,
        text: "Comprehensive mastery of all operative steps, risks and anatomy",
      },
    ],
  },
];

export const LEVEL4_DIMENSION_KEYS = LEVEL4_DIMENSIONS.map((d) => d.key);

export function level4LabelForKey(key: string): string {
  return LEVEL4_DIMENSIONS.find((d) => d.key === key)?.label ?? key;
}

/** Collapse case / punctuation so "Suture/needle handling" ≡ "suture needle handling". */
export function normalizeLevel4Label(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a free-form AI dimension title to a canonical Level 4 key, if any. */
export function matchLevel4DimensionKey(rawLabel: string): string | null {
  const norm = normalizeLevel4Label(rawLabel);
  if (!norm) return null;

  for (const def of LEVEL4_DIMENSIONS) {
    for (const alias of def.aliases) {
      if (normalizeLevel4Label(alias) === norm) return def.key;
    }
  }

  // Soft contains: e.g. "Time and Motion (Efficiency of Movement):"
  for (const def of LEVEL4_DIMENSIONS) {
    for (const alias of def.aliases) {
      const a = normalizeLevel4Label(alias);
      if (a.length >= 8 && (norm.includes(a) || a.includes(norm))) {
        return def.key;
      }
    }
  }

  return null;
}
