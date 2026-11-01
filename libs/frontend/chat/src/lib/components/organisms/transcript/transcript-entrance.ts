export const ENTRANCE_CAP = 6;

type MessageIdentity = string | { readonly id: string };

export interface EntranceInput {
  readonly previousIds: readonly string[];
  readonly nextIds: readonly string[];
  readonly suppressed: boolean;
  readonly replaying: boolean;
  readonly pinned: boolean;
  readonly cap: number;
}

/** Keep the anchor's strict suffix test available to both consumers. */
export function isStrictHeadPrepend(
  previous: readonly MessageIdentity[],
  next: readonly MessageIdentity[],
): boolean {
  if (previous.length === 0 || next.length <= previous.length) return false;
  const suffixStart = next.length - previous.length;
  for (let index = 0; index < previous.length; index++) {
    const oldId = previous[index];
    const newId = next[suffixStart + index];
    if ((typeof newId === 'string' ? newId : newId.id) !==
        (typeof oldId === 'string' ? oldId : oldId.id)) return false;
  }
  return true;
}

/** A finalized tail can replace streaming ids without adding a new turn. */
export function isTailSwap(
  previous: readonly string[],
  next: readonly string[],
): boolean {
  if (previous.length !== next.length || previous.length < 2) return false;
  const firstChanged = previous.findIndex((id, index) => id !== next[index]);
  if (firstChanged < 1) return false;
  const oldTail = new Set(previous.slice(firstChanged));
  const newTail = new Set(next.slice(firstChanged));
  return previous.slice(firstChanged).every((id) => !newTail.has(id)) &&
    next.slice(firstChanged).every((id) => !oldTail.has(id));
}

/** Assign delays only to newly added messages in the mounted tail. */
export function planEntrance(input: EntranceInput): ReadonlyMap<string, number> {
  const { previousIds, nextIds, suppressed, replaying, pinned, cap } = input;
  if (suppressed || cap <= 0 || isStrictHeadPrepend(previousIds, nextIds) ||
      isTailSwap(previousIds, nextIds)) return new Map();

  const previous = new Set(previousIds);
  const added = nextIds.filter((id) => !previous.has(id));
  if (added.length === 0) return new Map();

  const openBatch = previousIds.length === 0 || !nextIds.some((id) => previous.has(id));
  if ((replaying && !openBatch) || (!openBatch && !pinned)) return new Map();

  const addedIds = new Set(added);
  const result = new Map<string, number>();
  for (const id of nextIds.slice(-cap)) {
    if (addedIds.has(id)) result.set(id, result.size);
  }
  return result;
}
