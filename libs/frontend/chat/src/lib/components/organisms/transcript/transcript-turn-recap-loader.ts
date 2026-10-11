import { InjectionToken } from '@angular/core';
// Type only, erased: `buildTurnSummaryModel` is a value of the lazy
// `turn-recap` entry, so eager code reaches it only through the dynamic
// `import()` below (decision #101).
import type { buildTurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';

/** What the transcript takes from the lazy `@ptah-extension/chat-ui/turn-recap` entry. */
export interface TranscriptTurnRecap {
  readonly buildTurnSummaryModel: typeof buildTurnSummaryModel;
}

/** Resolves the `turn-recap` entry; rejects when its chunk fails to load. */
export type TranscriptTurnRecapLoader = () => Promise<TranscriptTurnRecap>;

/**
 * One shared load of the entry (decision #104 a). The cache holds only the
 * module namespace promise, never summary data: models and maps live in the
 * transcript's derived signals and `DisplayDockState`'s tab-keyed state.
 * Concurrent callers join the attempt in flight; a rejected attempt is
 * dropped, so the next call makes a fresh one. Nothing here retries on its
 * own: the caller decides when the next attempt is due.
 */
export function cachedTurnRecapLoader(
  load: TranscriptTurnRecapLoader,
): TranscriptTurnRecapLoader {
  let attempt: Promise<TranscriptTurnRecap> | null = null;
  return () => {
    if (attempt === null) {
      const current = load();
      attempt = current;
      // Handles the rejection on this branch only; callers still see it.
      current.catch(() => {
        if (attempt === current) attempt = null;
      });
    }
    return attempt;
  };
}

/**
 * The loader of the `turn-recap` entry, shared by every transcript of the
 * webview (root). The Angular compiler emits the same dynamic `import()` for
 * the summary chip's `@defer`, so both land in one lazy chunk and the eager
 * closure is unchanged (Batches 32 and 33 gate it).
 */
export const TRANSCRIPT_TURN_RECAP_LOADER =
  new InjectionToken<TranscriptTurnRecapLoader>('TRANSCRIPT_TURN_RECAP_LOADER', {
    providedIn: 'root',
    factory: () =>
      cachedTurnRecapLoader(() => import('@ptah-extension/chat-ui/turn-recap')),
  });
