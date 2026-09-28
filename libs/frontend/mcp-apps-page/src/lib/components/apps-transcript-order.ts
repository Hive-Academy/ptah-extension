import type { ExecutionNode } from '@ptah-extension/shared';

/** One entry of the merged Apps transcript. */
export type AppsTranscriptItem =
  | {
      readonly kind: 'user';
      readonly key: string;
      readonly at: number;
      readonly text: string;
    }
  | {
      readonly kind: 'node';
      readonly key: string;
      readonly at: number;
      readonly node: ExecutionNode;
    };

/**
 * Transcript order: by time, and on a tie the user bubble first, because a
 * bubble (typed, or "Submitted: …" stamped when `surface:action` was SENT) is
 * the cause of the nodes sharing its millisecond. Items of the same kind and
 * time keep their input order (`Array.prototype.sort` is stable). Written
 * without subtraction so an unstamped node (`Infinity`) compares correctly.
 */
export function compareTranscriptItems(
  a: AppsTranscriptItem,
  b: AppsTranscriptItem,
): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.kind === b.kind) return 0;
  return a.kind === 'user' ? -1 : 1;
}
