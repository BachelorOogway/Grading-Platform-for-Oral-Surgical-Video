/** 从 videoOutputId（如 V01、V75）解析视频序号 */
export function parseVideoNumber(videoOutputId: string): number | null {
  const m = /^[vV](\d+)$/.exec((videoOutputId ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatVideoOutputId(videoNumber: number): string {
  return `V${String(videoNumber).padStart(2, "0")}`;
}

/**
 * Canonical exclusive Video ID: V01, V02, ...
 * Returns null if the input is not a valid video id.
 */
export function normalizeVideoOutputId(raw: string): string | null {
  const n = parseVideoNumber(raw);
  if (n == null) return null;
  return formatVideoOutputId(n);
}
