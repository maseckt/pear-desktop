let owner: string | null = null;
export function claimPlaybackRate(id: string) {
  owner = id;
}
export function releasePlaybackRate(id: string) {
  if (owner === id) owner = null;
}
export function isPlaybackRateControlledByOther(id: string) {
  return owner !== null && owner !== id;
}
