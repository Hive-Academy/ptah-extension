import type { TilePositionObservation } from './canvas-layout-intent';

interface GestureNodeObservation {
  readonly id?: unknown;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
}

interface GestureObservationContext {
  readonly kind: 'drag' | 'resize';
  readonly draggedId: string;
  readonly expectedTabIds: readonly string[];
  readonly lastDraggedPosition: TilePositionObservation;
}

/** Validate a complete Gridstack snapshot before translating gesture intent. */
export function readCompleteGestureNodes(
  nodes: readonly GestureNodeObservation[],
  gesture: GestureObservationContext,
): readonly TilePositionObservation[] | null {
  if (nodes.length !== gesture.expectedTabIds.length) return null;
  const expected = new Set(gesture.expectedTabIds);
  const seen = new Set<string>();
  const observations: TilePositionObservation[] = [];
  for (const node of nodes) {
    if (
      typeof node.id !== 'string' ||
      !expected.has(node.id) ||
      seen.has(node.id) ||
      typeof node.x !== 'number' ||
      !Number.isFinite(node.x) ||
      typeof node.y !== 'number' ||
      !Number.isInteger(node.y) ||
      typeof node.w !== 'number' ||
      !Number.isFinite(node.w) ||
      typeof node.h !== 'number' ||
      !Number.isInteger(node.h)
    ) {
      return null;
    }
    seen.add(node.id);
    observations.push(
      gesture.kind === 'drag' && node.id === gesture.draggedId
        ? gesture.lastDraggedPosition
        : { tabId: node.id, x: node.x, y: node.y, w: node.w, h: node.h },
    );
  }
  return seen.size === expected.size ? observations : null;
}
