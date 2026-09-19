export type NumericRange = { start: number; end: number };

export const DEFAULT_EXCLUSIVE_RANGES: NumericRange[] = [
  { start: 1, end: 200 },
];

/** @deprecated Shared ranges removed — kept empty for DB compatibility. */
export const DEFAULT_SHARED_RANGES: NumericRange[] = [];

export function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}
