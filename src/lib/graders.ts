/** Every video is graded by exactly this many experts. */
export const GRADERS_PER_VIDEO = 3;

export function isTiebreakerSlot(slot: number | null | undefined) {
  return Number(slot) === GRADERS_PER_VIDEO;
}
