import type { FlatStreamEventUnion } from '@ptah-extension/shared';

export function selectDeliveredBlockOwners(
  fullEvents: readonly FlatStreamEventUnion[],
  delivered: readonly FlatStreamEventUnion[],
  blockOwners: ReadonlyMap<FlatStreamEventUnion, string>,
): Record<string, string> {
  const fullCounts = new Map<string, number>();
  const deliveredCounts = new Map<string, number>();
  for (const event of fullEvents) {
    const owner = blockOwners.get(event);
    if (owner) fullCounts.set(owner, (fullCounts.get(owner) ?? 0) + 1);
  }
  for (const event of delivered) {
    const owner = blockOwners.get(event);
    if (owner) {
      deliveredCounts.set(owner, (deliveredCounts.get(owner) ?? 0) + 1);
    }
  }
  const selected: Record<string, string> = {};
  delivered.forEach((event, index) => {
    const owner = blockOwners.get(event);
    if (owner && deliveredCounts.get(owner) === fullCounts.get(owner)) {
      selected[String(index)] = owner;
    }
  });
  return selected;
}

export function selectDeliveredSyntheticResults(
  delivered: readonly FlatStreamEventUnion[],
  syntheticToolResults: ReadonlySet<FlatStreamEventUnion>,
): number[] {
  const indices: number[] = [];
  delivered.forEach((event, index) => {
    if (syntheticToolResults.has(event)) indices.push(index);
  });
  return indices;
}
