export type SavedRange = { videoId: string; start: number; end: number };
export function validRange(
  start: unknown,
  end: unknown,
  duration: number,
): boolean {
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(duration) &&
    start >= 0 &&
    end > start + 0.25 &&
    end <= duration
  );
}
export function savedRanges(value: unknown): SavedRange[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-500).filter((raw): raw is SavedRange => {
    if (!raw || typeof raw !== 'object') return false;
    const entry = raw as Record<string, unknown>;
    return (
      typeof entry.videoId === 'string' &&
      /^[\w-]{11}$/.test(entry.videoId) &&
      validRange(entry.start, entry.end, 7 * 86400)
    );
  });
}
