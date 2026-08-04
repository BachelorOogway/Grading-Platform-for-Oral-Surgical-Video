import { prisma } from "./prisma";
import { parseVideoNumber } from "./videoId";
import {
  DEFAULT_EXCLUSIVE_RANGES,
  DEFAULT_SHARED_RANGES,
  parseJsonSafe,
  stringifyJson,
  type NumericRange,
} from "./json";

export type { NumericRange };

export const AssignmentKind = {
  EXCLUSIVE: "EXCLUSIVE",
  SHARED: "SHARED",
} as const;

export type AssignmentKindValue = (typeof AssignmentKind)[keyof typeof AssignmentKind];

function normalizeRanges(raw: unknown): NumericRange[] {
  if (!Array.isArray(raw)) return [];
  const out: NumericRange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const start = Number((item as NumericRange).start);
    const end = Number((item as NumericRange).end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start > end) continue;
    out.push({ start: Math.floor(start), end: Math.floor(end) });
  }
  return out;
}

export function isInRanges(videoNumber: number, ranges: NumericRange[]) {
  return ranges.some((r) => videoNumber >= r.start && videoNumber <= r.end);
}

export async function getAssignmentConfig() {
  let row = await prisma.assignmentConfig.findUnique({
    where: { id: "default" },
  });

  if (!row) {
    row = await prisma.assignmentConfig.create({
      data: {
        id: "default",
        exclusiveRanges: stringifyJson(DEFAULT_EXCLUSIVE_RANGES),
        sharedRanges: stringifyJson(DEFAULT_SHARED_RANGES),
      },
    });
  }

  return {
    exclusiveRanges: normalizeRanges(
      parseJsonSafe(row.exclusiveRanges, DEFAULT_EXCLUSIVE_RANGES),
    ),
    sharedRanges: normalizeRanges(
      parseJsonSafe(row.sharedRanges, DEFAULT_SHARED_RANGES),
    ),
  };
}

export async function saveAssignmentConfig(input: {
  exclusiveRanges: NumericRange[];
  sharedRanges: NumericRange[];
}) {
  const exclusiveRanges = normalizeRanges(input.exclusiveRanges);
  const sharedRanges = normalizeRanges(input.sharedRanges);

  return prisma.assignmentConfig.upsert({
    where: { id: "default" },
    update: {
      exclusiveRanges: stringifyJson(exclusiveRanges),
      sharedRanges: stringifyJson(sharedRanges),
    },
    create: {
      id: "default",
      exclusiveRanges: stringifyJson(exclusiveRanges),
      sharedRanges: stringifyJson(sharedRanges),
    },
  });
}

export function classifyVideoNumber(
  videoNumber: number,
  config: { exclusiveRanges: NumericRange[]; sharedRanges: NumericRange[] },
): AssignmentKindValue | null {
  if (isInRanges(videoNumber, config.exclusiveRanges)) return AssignmentKind.EXCLUSIVE;
  if (isInRanges(videoNumber, config.sharedRanges)) return AssignmentKind.SHARED;
  return null;
}

export function classifyVideoOutputId(
  videoOutputId: string,
  config: { exclusiveRanges: NumericRange[]; sharedRanges: NumericRange[] },
): AssignmentKindValue | null {
  const n = parseVideoNumber(videoOutputId);
  if (n === null) return null;
  return classifyVideoNumber(n, config);
}

export async function syncSharedAssignmentsForExpert(expertDbId: string) {
  const config = await getAssignmentConfig();
  const outputs = await prisma.aiOutput.findMany({
    select: { id: true, videoOutputId: true },
  });

  const sharedOutputs = outputs.filter((o) => {
    const n = parseVideoNumber(o.videoOutputId);
    return n !== null && isInRanges(n, config.sharedRanges);
  });

  for (const o of sharedOutputs) {
    const existing = await prisma.taskAssignment.findFirst({
      where: { expertId: expertDbId, aiOutputId: o.id },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.taskAssignment.create({
      data: {
        expertId: expertDbId,
        aiOutputId: o.id,
        kind: AssignmentKind.SHARED,
        status: "PENDING",
      },
    });
  }
}
