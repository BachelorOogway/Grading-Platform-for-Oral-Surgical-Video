export type NumericRange = { start: number; end: number };

export const DEFAULT_EXCLUSIVE_RANGES: NumericRange[] = [
  { start: 1, end: 75 },
  { start: 100, end: 175 },
];

export const DEFAULT_SHARED_RANGES: NumericRange[] = [
  { start: 76, end: 99 },
  { start: 176, end: 200 },
];

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
