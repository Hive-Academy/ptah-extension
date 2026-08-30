/**
 * Bounds a transcript read to the END of the session.
 *
 * Omitting `tailBytes` reads the whole transcript. A caller that keeps only a
 * recent excerpt must pass a window: the implementation behind this port
 * parses JSONL on the backend main thread — in Electron the same event loop
 * that drives the windows — so reading a 50 MB transcript to keep 32 KB of it
 * costs a growing stall on every turn (TASK_2026_323, B4).
 */
export interface TranscriptReadOptions {
  /** Read only the last N bytes of the raw transcript. */
  readonly tailBytes?: number;
}

export interface ITranscriptReader {
  read(
    sessionId: string,
    workspacePath: string,
    options?: TranscriptReadOptions,
  ): Promise<string>;
}
