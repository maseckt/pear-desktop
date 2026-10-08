export type SharedAudioGraph = {
  audioContext: AudioContext;
  audioSource: MediaElementAudioSourceNode;
};
let current: SharedAudioGraph | null = null;
export function rememberAudioGraph(graph: SharedAudioGraph) {
  current = graph;
}
export function latestAudioGraph() {
  return current;
}
