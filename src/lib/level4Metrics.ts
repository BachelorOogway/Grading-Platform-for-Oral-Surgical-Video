/**
 * Level 4 OSATS metrics (6 dimensions; Use of Assistants excluded).
 * - AI vs expert: MAE, LCC, SROCC (pooled over forms × dimensions with both scores)
 * - Inter-expert (SHARED videos): ICC(2,1), Fisher-z averaged over expert pairs
 * - Hallucination rate: mean of per-form (Yes / labeled dimensions)
 */

export type ScorePair = {
  aiScore: number;
  expertScore: number;
};

export type Level4GlobalMetrics = {
  formCount: number;
  /** Number of (AI, expert) score pairs used */
  pairCount: number;
  /** Mean absolute error */
  mae: number | null;
  /** Linear / Pearson correlation coefficient (LCC / PLCC) */
  lcc: number | null;
  /** Spearman rank-order correlation coefficient */
  srocc: number | null;
  /** Forms that contributed a Level 4 hallucination rate */
  hallucinationFormCount: number;
  /** Sum of Yes labels across forms */
  hallucinationYesCount: number;
  /** Sum of dimension labels across forms */
  hallucinationTotalCount: number;
  /**
   * Mean of per-form hallucination rates
   * (each form: yesCount / dimensionCount).
   */
  meanHallucinationRate: number | null;
};

export type InterExpertIccMetrics = {
  /** SHARED videos with ≥2 completed expert gradings */
  sharedVideoCount: number;
  /** Distinct experts involved in those videos */
  sharedExpertCount: number;
  /** Expert pairs that contributed an ICC */
  expertPairCount: number;
  /** Score pairs pooled into pairwise ICCs (video × dimension × pair) */
  scorePairCount: number;
  /**
   * Mean pairwise ICC(2,1) after Fisher-z averaging
   * (absolute agreement between experts on shared videos).
   */
  icc: number | null;
  /** Fisher z of the averaged ICC (artanh of icc) */
  iccFisherZ: number | null;
};

function isScore(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5;
}

/** Pearson / LCC; null if <2 pairs or zero variance. */
export function linearCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const mx = sumX / n;
  const my = sumY / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Average ranks with tie handling (midranks). */
export function averageRanks(values: number[]): number[] {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j += 1;
    const rankSum = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = rankSum;
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank-order correlation (Pearson on midranks). */
export function spearmanCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  return linearCorrelation(averageRanks(xs), averageRanks(ys));
}

/**
 * ICC(2,1) absolute agreement for k raters × n targets.
 * matrix[i][j] = score of target i by rater j (complete, no missing).
 * Formula: (MSR - MSE) / (MSR + (k-1)MSE + k/n (MSC - MSE)).
 */
export function iccAbsoluteAgreement(matrix: number[][]): number | null {
  const n = matrix.length;
  if (n < 2) return null;
  const k = matrix[0]?.length ?? 0;
  if (k < 2) return null;
  for (const row of matrix) {
    if (!row || row.length !== k) return null;
  }

  let grand = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) grand += matrix[i][j];
  }
  grand /= n * k;

  let ssRows = 0;
  let ssErr = 0;
  const colSums = new Array<number>(k).fill(0);

  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < k; j++) {
      rowSum += matrix[i][j];
      colSums[j] += matrix[i][j];
    }
    const rowMean = rowSum / k;
    ssRows += k * (rowMean - grand) ** 2;
    for (let j = 0; j < k; j++) {
      ssErr += (matrix[i][j] - rowMean) ** 2;
    }
  }

  let ssCols = 0;
  for (let j = 0; j < k; j++) {
    const colMean = colSums[j] / n;
    ssCols += n * (colMean - grand) ** 2;
  }

  const dfR = n - 1;
  const dfC = k - 1;
  const dfE = (n - 1) * (k - 1);
  if (dfR <= 0 || dfE <= 0 || dfC <= 0) return null;

  const msr = ssRows / dfR;
  const msc = ssCols / dfC;
  const mse = ssErr / dfE;

  const den = msr + (k - 1) * mse + (k / n) * (msc - mse);
  if (!Number.isFinite(den) || den === 0) return null;
  const icc = (msr - mse) / den;
  if (!Number.isFinite(icc)) return null;
  return icc;
}

export function iccAbsoluteAgreement2Raters(
  raterA: number[],
  raterB: number[],
): number | null {
  const n = raterA.length;
  if (n !== raterB.length) return null;
  const matrix = raterA.map((a, i) => [a, raterB[i]]);
  return iccAbsoluteAgreement(matrix);
}

/** Fisher z-transform: artanh(r). Clamps |r| < 1. */
export function fisherZTransform(r: number | null): number | null {
  if (r == null || !Number.isFinite(r)) return null;
  const eps = 1e-7;
  const clamped = Math.min(1 - eps, Math.max(-1 + eps, r));
  return 0.5 * Math.log((1 + clamped) / (1 - clamped));
}

export function fisherZAverage(values: number[]): number | null {
  const zs: number[] = [];
  for (const r of values) {
    const z = fisherZTransform(r);
    if (z != null) zs.push(z);
  }
  if (zs.length === 0) return null;
  const meanZ = zs.reduce((a, b) => a + b, 0) / zs.length;
  const eps = 1e-7;
  const e = Math.exp(2 * meanZ);
  const r = (e - 1) / (e + 1);
  return Math.min(1 - eps, Math.max(-1 + eps, r));
}

export function meanAbsoluteError(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n === 0 || ys.length !== n) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(xs[i] - ys[i]);
  return sum / n;
}

export function computeLevel4GlobalMetrics(
  pairs: ScorePair[],
  formCount: number,
  formHallucinationRates: number[] = [],
  hallucinationYesCount = 0,
  hallucinationTotalCount = 0,
): Level4GlobalMetrics {
  const ai: number[] = [];
  const expert: number[] = [];
  for (const p of pairs) {
    if (!isScore(p.aiScore) || !isScore(p.expertScore)) continue;
    ai.push(p.aiScore);
    expert.push(p.expertScore);
  }

  const nRates = formHallucinationRates.length;
  const meanHallucinationRate =
    nRates > 0
      ? formHallucinationRates.reduce((a, b) => a + b, 0) / nRates
      : null;

  return {
    formCount,
    pairCount: ai.length,
    mae: meanAbsoluteError(ai, expert),
    lcc: linearCorrelation(ai, expert),
    srocc: spearmanCorrelation(ai, expert),
    hallucinationFormCount: nRates,
    hallucinationYesCount,
    hallucinationTotalCount,
    meanHallucinationRate,
  };
}

function parseParsedObject(parsedData: unknown): Record<string, unknown> {
  if (typeof parsedData === "string") {
    try {
      return JSON.parse(parsedData) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (parsedData && typeof parsedData === "object") {
    return parsedData as Record<string, unknown>;
  }
  return {};
}

function parseGradingObject(gradingData: unknown): Record<string, unknown> {
  if (typeof gradingData === "string") {
    try {
      return JSON.parse(gradingData) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (gradingData && typeof gradingData === "object") {
    return gradingData as Record<string, unknown>;
  }
  return {};
}

function aiScoreMapFromParsed(parsedData: unknown): Map<string, number> {
  const map = new Map<string, number>();
  const l4 = (parseParsedObject(parsedData).level4 ?? {}) as Record<
    string,
    unknown
  >;
  const dims = Array.isArray(l4.dimensions) ? l4.dimensions : [];
  for (const d of dims) {
    if (!d || typeof d !== "object") continue;
    const key = String((d as { key?: unknown }).key ?? "");
    const score = Number((d as { aiScore?: unknown }).aiScore);
    if (key && isScore(score)) map.set(key, score);
  }
  return map;
}

/**
 * Extract AI–expert score pairs from one grading form (+ optional AI parsedData).
 */
export function level4ScorePairsFromRow(
  gradingData: unknown,
  parsedData?: unknown,
): ScorePair[] {
  const l4 = (parseGradingObject(gradingData).level4 ?? {}) as Record<
    string,
    unknown
  >;
  const dims = Array.isArray(l4.dimensions) ? l4.dimensions : [];
  const aiByKey = aiScoreMapFromParsed(parsedData);
  const pairs: ScorePair[] = [];

  for (const d of dims) {
    if (!d || typeof d !== "object") continue;
    const row = d as {
      key?: unknown;
      expertScore?: unknown;
      aiScore?: unknown;
    };
    const key = String(row.key ?? "");
    const expertScore = Number(row.expertScore);
    let aiScore = Number(row.aiScore);
    if (!isScore(aiScore) && key) {
      const fromParsed = aiByKey.get(key);
      if (fromParsed != null) aiScore = fromParsed;
    }
    if (isScore(aiScore) && isScore(expertScore)) {
      pairs.push({ aiScore, expertScore });
    }
  }
  return pairs;
}

export type Level4HallucinationStats = {
  yesCount: number;
  totalCount: number;
  rate: number;
};

/** Per-form Level 4 justification hallucination rate = Yes / labeled dimensions. */
export function level4HallucinationFromGradingData(
  gradingData: unknown,
): Level4HallucinationStats | null {
  const l4 = (parseGradingObject(gradingData).level4 ?? {}) as Record<
    string,
    unknown
  >;

  const storedTotal = Number(l4.hallucinationTotalCount);
  const storedYes = Number(l4.hallucinationYesCount);
  if (
    Number.isFinite(storedTotal) &&
    storedTotal > 0 &&
    Number.isFinite(storedYes) &&
    storedYes >= 0
  ) {
    const rate =
      typeof l4.hallucinationRate === "number" &&
      Number.isFinite(l4.hallucinationRate)
        ? l4.hallucinationRate
        : storedYes / storedTotal;
    return { yesCount: storedYes, totalCount: storedTotal, rate };
  }

  const dims = Array.isArray(l4.dimensions) ? l4.dimensions : [];
  let yesCount = 0;
  let totalCount = 0;
  for (const d of dims) {
    if (!d || typeof d !== "object") continue;
    const hall = (d as { aiJustificationHallucination?: unknown })
      .aiJustificationHallucination;
    if (hall === true || hall === "yes" || hall === "Yes") {
      yesCount += 1;
      totalCount += 1;
    } else if (hall === false || hall === "no" || hall === "No") {
      totalCount += 1;
    }
  }
  if (totalCount <= 0) return null;
  return { yesCount, totalCount, rate: yesCount / totalCount };
}

/** Live form helper: Yes count / answered dimensions. */
export function computeLevel4HallucinationRate(
  dimensions: Record<string, { aiJustificationHallucination?: string }> | undefined,
  keys: string[],
): Level4HallucinationStats | null {
  let yesCount = 0;
  let totalCount = 0;
  for (const key of keys) {
    const v = dimensions?.[key]?.aiJustificationHallucination;
    if (v === "yes") {
      yesCount += 1;
      totalCount += 1;
    } else if (v === "no") {
      totalCount += 1;
    }
  }
  if (totalCount <= 0) return null;
  return { yesCount, totalCount, rate: yesCount / totalCount };
}

export type SharedExpertGradingRow = {
  videoOutputId: string;
  expertId: string;
  kind: string;
  gradingData: unknown;
};

function expertScoresByDimension(
  gradingData: unknown,
): Map<string, number> {
  const map = new Map<string, number>();
  const l4 = (parseGradingObject(gradingData).level4 ?? {}) as Record<
    string,
    unknown
  >;
  const dims = Array.isArray(l4.dimensions) ? l4.dimensions : [];
  for (const d of dims) {
    if (!d || typeof d !== "object") continue;
    const key = String((d as { key?: unknown }).key ?? "");
    const score = Number((d as { expertScore?: unknown }).expertScore);
    if (key && isScore(score)) map.set(key, score);
  }
  return map;
}

/**
 * Inter-expert ICC on SHARED videos rated by ≥2 experts.
 * Uses pairwise ICC(2,1) on co-rated (video × dimension) scores,
 * then Fisher-z averages the pairwise ICCs.
 */
export function computeInterExpertIccMetrics(
  rows: SharedExpertGradingRow[],
): InterExpertIccMetrics {
  const empty: InterExpertIccMetrics = {
    sharedVideoCount: 0,
    sharedExpertCount: 0,
    expertPairCount: 0,
    scorePairCount: 0,
    icc: null,
    iccFisherZ: null,
  };

  const shared = rows.filter((r) => r.kind === "SHARED");
  if (shared.length === 0) return empty;

  // video -> expertId -> dimension scores
  const byVideo = new Map<string, Map<string, Map<string, number>>>();
  for (const r of shared) {
    const dimScores = expertScoresByDimension(r.gradingData);
    if (dimScores.size === 0) continue;
    let experts = byVideo.get(r.videoOutputId);
    if (!experts) {
      experts = new Map();
      byVideo.set(r.videoOutputId, experts);
    }
    experts.set(r.expertId, dimScores);
  }

  const multiVideos = [...byVideo.entries()].filter(
    ([, experts]) => experts.size >= 2,
  );
  if (multiVideos.length === 0) return empty;

  const expertSet = new Set<string>();
  for (const [, experts] of multiVideos) {
    for (const id of experts.keys()) expertSet.add(id);
  }
  const expertIds = [...expertSet].sort();

  // targetKey = `${video}::${dim}` -> expertId -> score
  const targets = new Map<string, Map<string, number>>();
  for (const [videoId, experts] of multiVideos) {
    for (const [expertId, dimScores] of experts) {
      for (const [dim, score] of dimScores) {
        const key = `${videoId}::${dim}`;
        let row = targets.get(key);
        if (!row) {
          row = new Map();
          targets.set(key, row);
        }
        row.set(expertId, score);
      }
    }
  }

  const pairwiseIccs: number[] = [];
  let scorePairCount = 0;

  for (let i = 0; i < expertIds.length; i++) {
    for (let j = i + 1; j < expertIds.length; j++) {
      const a = expertIds[i];
      const b = expertIds[j];
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of targets.values()) {
        const sa = row.get(a);
        const sb = row.get(b);
        if (sa == null || sb == null) continue;
        xs.push(sa);
        ys.push(sb);
      }
      if (xs.length < 2) continue;
      const icc = iccAbsoluteAgreement2Raters(xs, ys);
      if (icc == null) continue;
      pairwiseIccs.push(icc);
      scorePairCount += xs.length;
    }
  }

  const icc = fisherZAverage(pairwiseIccs);

  return {
    sharedVideoCount: multiVideos.length,
    sharedExpertCount: expertIds.length,
    expertPairCount: pairwiseIccs.length,
    scorePairCount,
    icc,
    iccFisherZ: fisherZTransform(icc),
  };
}
