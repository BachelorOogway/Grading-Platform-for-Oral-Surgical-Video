/** Every video is graded by exactly this many experts. */
export const GRADERS_PER_VIDEO = 3;

export function isTiebreakerSlot(slot: number | null | undefined) {
  return Number(slot) === GRADERS_PER_VIDEO;
}

type SlotOrdered = {
  id: string;
  assignedAt: Date | string;
};

/**
 * The chronological third claimer on a video is the only one who may initiate
 * discrepancy solve. Prefer assignedAt order over graderSlot so mis-numbered
 * slots cannot leak the red button to grader 1 / 2.
 */
export function isChronologicalTiebreaker(
  myAssignmentId: string,
  siblings: SlotOrdered[],
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
