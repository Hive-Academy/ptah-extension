/** Select the newest intersecting slots, then return them in reading order. */
export function selectVisibleEntrance(
  viewport: DOMRectReadOnly,
  itemsNewestFirst: readonly { id: string; rect: DOMRectReadOnly }[],
  cap: number,
): string[] {
  if (cap <= 0) return [];
  const selected: string[] = [];
  for (const item of itemsNewestFirst) {
    if (item.rect.height <= 0) continue;
    if (item.rect.top >= viewport.bottom) continue;
    if (item.rect.bottom <= viewport.top) break;
    selected.push(item.id);
    if (selected.length >= cap) break;
  }
  return selected.reverse();
}
