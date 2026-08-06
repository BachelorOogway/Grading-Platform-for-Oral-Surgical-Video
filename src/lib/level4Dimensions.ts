/**
 * Level 4 OSATS dimensions — single source of truth for parse, form, metrics, export.
 * Rubrics shown to experts (AI scores are hidden on the grading form).
 */

export type Level4RubricLevel = {
  score: 1 | 3 | 5;
  text: string;
};

export type Level4DimensionDef = {
  key: string;
  label: string;
  /** Regexes tried in order against the Level 4 section */
  patterns: RegExp[];
  rubrics: Level4RubricLevel[];
};

export const LEVEL4_DIMENSIONS: Level4DimensionDef[] = [
  {
    key: "respectForTissue",
    label: "Respect for Tissue",
    patterns: [/^Respect for Tissue:\s*(\d)\s*-\s*(.+)$/im],
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
    patterns: [
      /^Time and Motion\s*\(Efficiency of Movement\):\s*(\d)\s*-\s*(.+)$/im,
      /^Time and Motion:\s*(\d)\s*-\s*(.+)$/im,
      /^Time and motion:\s*(\d)\s*-\s*(.+)$/im,
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
    patterns: [/^Instrument Handling:\s*(\d)\s*-\s*(.+)$/im],
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
    patterns: [/^Knowledge of Instruments:\s*(\d)\s*-\s*(.+)$/im],
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
    patterns: [
      /^Flow of Operation\s*&\s*Forward Planning:\s*(\d)\s*-\s*(.+)$/im,
      /^Flow of Operation:\s*(\d)\s*-\s*(.+)$/im,
      /^Flow of operation:\s*(\d)\s*-\s*(.+)$/im,
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
    patterns: [/^Knowledge of Specific Procedure:\s*(\d)\s*-\s*(.+)$/im],
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
