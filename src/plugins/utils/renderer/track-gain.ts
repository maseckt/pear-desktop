export function trackGainDb(loudness: unknown, maximum: unknown): number {
  const max =
    typeof maximum === 'number' && Number.isFinite(maximum)
      ? Math.max(0, Math.min(maximum, 24))
      : 12;
  return typeof loudness === 'number' && Number.isFinite(loudness)
    ? Math.min(Math.max(-loudness, 0), max)
    : 0;
}
