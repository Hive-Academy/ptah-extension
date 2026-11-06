/** Find the first ancestor that owns vertical scrolling for a lane. */
export function findScrollingAncestor(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}
