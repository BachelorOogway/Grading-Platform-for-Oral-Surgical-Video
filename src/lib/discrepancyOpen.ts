/**
 * Shared helpers for opening discrepancy items from the grading and the
 * discrepancy-solve routes, so both apply the same rules.
 */
import { prisma } from "@/lib/prisma";
import { parseJsonSafe } from "@/lib/json";
import {
  categoricalCompareToken,
  findCategoricalDisagreements,
  getCategoricalRaw,
  isHallucinationPath,
} from "@/lib/categoricalFields";
import {
  findTimingBoundDiscrepancies,
  isTimingPath,
  timesWithinThreshold,
} from "@/lib/timingDiscrepancy";
import { GRADERS_PER_VIDEO } from "@/lib/graders";

export type OpenableDiscrepancy = { path: string; label: string };

function gradingFromAssignment(a: {
  gradingResult: { gradingData: string } | null;
}): unknown | null {
  if (!a.gradingResult) return null;
  const g = parseJsonSafe<unknown>(a.gradingResult.gradingData, null);
  return g != null && typeof g === "object" ? g : null;
}

/** All completed gradings for one AI output, newest state from the DB. */
export async function loadCompletedGradings(
  aiOutputId: string,
): Promise<unknown[]> {
  const assignments = await prisma.taskAssignment.findMany({
    where: { aiOutputId, status: "COMPLETED" },
    include: { gradingResult: true },
    orderBy: { graderSlot: "asc" },
  });
  return assignments.flatMap((a) => {
    const g = gradingFromAssignment(a);
    return g ? [g] : [];
  });
}

/** Gradings for slots 1..GRADERS_PER_VIDEO on this video (order by slot). */
export async function loadAllGradings(aiOutputId: string): Promise<unknown[]> {
  const assignments = await prisma.taskAssignment.findMany({
    where: {
      aiOutputId,
      graderSlot: { in: Array.from({ length: GRADERS_PER_VIDEO }, (_, i) => i + 1) },
    },
    include: { gradingResult: true },
    orderBy: { graderSlot: "asc" },
  });
  // One entry per slot so a missing grader fails agreement (length < 3).
  const bySlot = new Map(
    assignments.map((a) => [a.graderSlot, gradingFromAssignment(a)]),
  );
  const out: unknown[] = [];
  for (let slot = 1; slot <= GRADERS_PER_VIDEO; slot++) {
    const g = bySlot.get(slot);
    if (!g) return out; // incomplete → callers see length < 3
    out.push(g);
  }
  return out;
}

/**
 * Resolve as soon as the three graders' current answers already line up —
 * no need to wait for every expert to click submit on the discrepancy form.
 * Categorical: exact token match. Timing: any pair within the 3s tolerance.
 */
export function gradersAgreeOnPath(
  gradings: unknown[],
  fieldPath: string,
): { agreed: boolean; token: string | null; value: unknown } {
  if (gradings.length < GRADERS_PER_VIDEO) {
    return { agreed: false, token: null, value: null };
  }

  if (isTimingPath(fieldPath)) {
    const raws = gradings.map((g) => getCategoricalRaw(g, fieldPath));
    const strings = raws.map((v) =>
      typeof v === "string" ? v : v == null ? null : String(v),
    );
    if (strings.some((s) => s == null || s === "")) {
      return { agreed: false, token: null, value: null };
    }
    // Also reject when the open-rule still flags this bound/window.
    const stillOpen = findTimingBoundDiscrepancies(gradings).some(
      (t) => t.path === fieldPath,
    );
    if (stillOpen || !timesWithinThreshold(strings)) {
      return { agreed: false, token: null, value: null };
    }
    return {
      agreed: true,
      token: strings[0],
      value: raws[0],
    };
  }

  const raws = gradings.map((g) => getCategoricalRaw(g, fieldPath));
  const tokens = raws.map((v) => categoricalCompareToken(v));
  if (tokens.some((t) => t == null)) {
    return { agreed: false, token: null, value: null };
  }
  const first = tokens[0]!;
  if (!tokens.every((t) => t === first)) {
    return { agreed: false, token: null, value: null };
  }
  return { agreed: true, token: first, value: raws[0] };
}

/**
 * Upsert items to OPEN. Items already OPEN are left untouched unless
 * `resetVotes` is set, so in-flight expert submissions are not wiped.
 */
export async function openDiscrepancyItems(
  aiOutputId: string,
  items: OpenableDiscrepancy[],
  createdByExpert: string,
  opts: { resetVotes?: boolean } = {},
): Promise<string[]> {
  const opened: string[] = [];
  for (const it of items) {
    const existing = await prisma.discrepancyItem.findUnique({
      where: { aiOutputId_fieldPath: { aiOutputId, fieldPath: it.path } },
      select: { id: true, status: true },
    });
    if (existing?.status === "OPEN" && !opts.resetVotes) continue;

    const item = await prisma.discrepancyItem.upsert({
      where: { aiOutputId_fieldPath: { aiOutputId, fieldPath: it.path } },
      update: {
        status: "OPEN",
        resolvedValue: null,
        fieldLabel: it.label,
        createdByExpert,
      },
      create: {
        aiOutputId,
        fieldPath: it.path,
        fieldLabel: it.label,
        status: "OPEN",
        createdByExpert,
      },
    });
    await prisma.discrepancyVote.deleteMany({
      where: { discrepancyItemId: item.id },
    });
    opened.push(it.path);
  }
  return opened;
}

/** Level 2 windows more than 3s apart between any two graders. */
export async function syncTimingDiscrepancies(
  aiOutputId: string,
  createdByExpert: string,
): Promise<string[]> {
  const gradings = await loadCompletedGradings(aiOutputId);
  const items = findTimingBoundDiscrepancies(gradings);
  return openDiscrepancyItems(aiOutputId, items, createdByExpert);
}

/**
 * Level 4 hallucination: any disagreement between the first two graders opens
 * a discrepancy on its own — OSATS scores never do.
 */
export function hallucinationDisagreements(
  grading1: unknown,
  grading2: unknown,
): OpenableDiscrepancy[] {
  if (!grading1 || !grading2) return [];
  return findCategoricalDisagreements(grading1, grading2)
    .filter((d) => isHallucinationPath(d.path))
    .map((d) => ({ path: d.path, label: d.label }));
}
