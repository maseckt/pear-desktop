// Optional presentation feed. Consumers do not load providers or own searches.
export interface LyricsView {
  videoId: string;
  state: 'loading' | 'ready' | 'empty';
  text: string;
  lines: { text: string; startMs: number; endMs?: number }[];
  stylesheet?: string;
}

let current: LyricsView | null = null;
const listeners = new Set<(view: LyricsView | null) => void>();
const notify = (
  listener: (view: LyricsView | null) => void,
  view: LyricsView | null,
) => {
  try {
    listener(view);
  } catch (error) {
    console.error('Lyrics view consumer failed', error);
  }
};
export const getLyricsView = () => current;
export const publishLyricsView = (view: LyricsView | null) => {
  current = view;
  for (const listener of listeners) notify(listener, view);
};
export const subscribeLyricsView = (
  listener: (view: LyricsView | null) => void,
) => {
  listeners.add(listener);
  notify(listener, current);
  return () => {
    listeners.delete(listener);
  };
};
