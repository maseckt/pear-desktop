export function seekSeconds(value: unknown, fallback: number): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 600
    ? value
    : fallback;
}
