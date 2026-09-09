/**
 * Shared helpers for opening discrepancy items from the grading and the
 * discrepancy-solve routes, so both apply the same rules.
 */
import { prisma } from "@/lib/prisma";
import { parseJsonSafe } from "@/lib/json";
import {
  findCategoricalDisagreements,
  isHallucinationPath,
} from "@/lib/categoricalFields";
import { findTimingBoundDiscrepancies } from "@/lib/timingDiscrepancy";

export type OpenableDiscrepancy = { path: string; label: string };

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
    if (!a.gradingResult) return [];
    const g = parseJsonSafe<unknown>(a.gradingResult.gradingData, null);
    return g != null && typeof g === "object" ? [g] : [];
  });
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
