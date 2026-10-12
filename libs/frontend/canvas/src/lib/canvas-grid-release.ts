import type { GridStackNode } from 'gridstack';
import { compactResizeBounds } from './canvas-layout-intent';

type Position = { x: number; y: number; w: number; h: number };

export function nodesNeedingLayout<T extends Position>(
  nodes: readonly GridStackNode[],
  derived: ReadonlyMap<string, T>,
  bounded: (id: string) => boolean,
): Array<{ node: GridStackNode & { el: HTMLElement }; target: T }> {
  const changed: Array<{
    node: GridStackNode & { el: HTMLElement };
    target: T;
  }> = [];
  for (const node of nodes) {
    if (typeof node.id !== 'string' || !node.el) continue;
    const target = derived.get(node.id);
    if (!target) continue;
    // Bounds must be applied to newly created tiles even when geometry matches.
    if (
      node.x !== target.x ||
      node.y !== target.y ||
      node.w !== target.w ||
      node.h !== target.h ||
      node.maxH !== compactResizeBounds(bounded(node.id)).maxH
    )
      changed.push({
        node: node as GridStackNode & { el: HTMLElement },
        target,
      });
  }
  return changed;
}

export function geometryDriftCount(
  nodes: readonly GridStackNode[],
  derived: ReadonlyMap<string, Position>,
): number {
  let count = 0;
  for (const node of nodes) {
    if (typeof node.id !== 'string') continue;
    const target = derived.get(node.id);
    if (
      target &&
      (node.x !== target.x ||
        node.y !== target.y ||
        node.w !== target.w ||
        node.h !== target.h)
    )
      count++;
  }
  return count;
}

/** Protect live geometry from Gridstack's top-gravity pack during a release/load. */
export function pinLiveNodes(
  nodes: readonly GridStackNode[],
  liveIds: ReadonlySet<string>,
): Array<{ node: GridStackNode; locked: boolean | undefined }> {
  const pinned: Array<{ node: GridStackNode; locked: boolean | undefined }> =
    [];
  for (const node of nodes) {
    if (typeof node.id !== 'string' || !liveIds.has(node.id)) continue;
    pinned.push({ node, locked: node.locked });
    node.locked = true;
  }
  return pinned;
}

export function restorePinnedNodes(
  pinned: readonly { node: GridStackNode; locked: boolean | undefined }[],
): void {
  for (const { node, locked } of pinned) node.locked = locked;
}

/** Snapshot first: removeNode replaces the engine's nodes array. */
export function staleGridNodes(
  nodes: readonly GridStackNode[],
  liveIds: ReadonlySet<string>,
): GridStackNode[] {
  return nodes.filter(
    (node) => typeof node.id !== 'string' || !liveIds.has(node.id),
  );
}
