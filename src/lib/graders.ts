/** Every video is graded by exactly this many experts. */
export const GRADERS_PER_VIDEO = 3;

export function isTiebreakerSlot(slot: number | null | undefined) {
  return Number(slot) === GRADERS_PER_VIDEO;
}

export type GradingOrderPeer = {
  id: string;
  status: string;
  /** When this grader's result was last submitted; null if not completed. */
  completedAt: Date | string | null;
};

function completedAtMs(v: Date | string | null | undefined): number {
  if (v == null) return Number.POSITIVE_INFINITY;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** Completed peers earliest-first (who finished grading first this round). */
export function completedInSubmitOrder(
  siblings: GradingOrderPeer[],
): GradingOrderPeer[] {
  return siblings
    .filter((s) => s.status === "COMPLETED" && s.completedAt != null)
    .sort((a, b) => {
      const d = completedAtMs(a.completedAt) - completedAtMs(b.completedAt);
      if (d !== 0) return d;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Discrepancy-solve + 3-column UI is only for the person who grades after two
 * others have already submitted this round (regrade / AI re-upload resets the
 * round). Claim order and DB graderSlot do not matter.
 */
export function isSubmissionOrderTiebreaker(
  my: GradingOrderPeer,
  siblings: GradingOrderPeer[],
): boolean {
  const othersDone = completedInSubmitOrder(
    siblings.filter((s) => s.id !== my.id),
  );
  if (othersDone.length < GRADERS_PER_VIDEO - 1) return false;

  const secondPriorAt = completedAtMs(othersDone[GRADERS_PER_VIDEO - 2].completedAt);

  // Still pending, but two others already finished → I am the third to grade.
  if (my.status !== "COMPLETED") return true;

  // Already submitted: only the third completer keeps the tiebreaker view.
  const myAt = completedAtMs(my.completedAt);
  return Number.isFinite(myAt) && myAt >= secondPriorAt;
}

/**
 * Position in this grading round: 1 = first to submit, 2 = second, 3 = third.
 * Pending graders show "next" slot (completedCount + 1).
 */
export function gradingRoundSlot(
  myAssignmentId: string,
  siblings: GradingOrderPeer[],
): number {
  const done = completedInSubmitOrder(siblings);
  const mine = done.findIndex((s) => s.id === myAssignmentId);
  if (mine >= 0) return mine + 1;
  return Math.min(done.length + 1, GRADERS_PER_VIDEO);
}

/** @deprecated Prefer isSubmissionOrderTiebreaker — claim order is wrong after regrade. */
export function isChronologicalTiebreaker(
  myAssignmentId: string,
  siblings: Array<{ id: string; assignedAt: Date | string }>,
): boolean {
  if (siblings.length < GRADERS_PER_VIDEO) return false;
  const sorted = [...siblings].sort((a, b) => {
    const ta = new Date(a.assignedAt).getTime();
    const tb = new Date(b.assignedAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  return sorted[GRADERS_PER_VIDEO - 1]?.id === myAssignmentId;
}
