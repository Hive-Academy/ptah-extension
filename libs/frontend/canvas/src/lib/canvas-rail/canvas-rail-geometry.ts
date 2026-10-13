import { COMPACT_RAIL_CARD_HEIGHT, type CompactRailDensity } from '@ptah-extension/chat-ui';

export const RAIL_CARD_GAP = 8;
export const RAIL_COLLAPSED_CARD_HEIGHT = 56;

export function railCardHeight(density: CompactRailDensity, collapsed: boolean): number {
  return collapsed ? RAIL_COLLAPSED_CARD_HEIGHT : COMPACT_RAIL_CARD_HEIGHT[density];
}

export function railAnchorScrollTop(index: number, height: number, viewportHeight: number, scrollTop: number): number {
  const top = index * (height + RAIL_CARD_GAP);
  if (top < scrollTop) return top;
  if (top + height > scrollTop + viewportHeight) return Math.max(0, top + height - viewportHeight);
  return scrollTop;
}

export interface RailGeometryBaseline {
  readonly key: string;
  readonly order: readonly string[];
}

export interface RailGeometrySample extends RailGeometryBaseline {
  readonly heights: readonly number[];
}

export function checkRailGeometry(
  baseline: RailGeometryBaseline | null,
  sample: RailGeometrySample,
  expectedHeight: number,
): { baseline: RailGeometryBaseline; shifts: number } {
  if (!baseline || baseline.key !== sample.key) {
    return { baseline: { key: sample.key, order: [...sample.order] }, shifts: 0 };
  }
  const reordered = baseline.order.length !== sample.order.length ||
    baseline.order.some((id, index) => id !== sample.order[index]);
  return {
    baseline,
    shifts: sample.heights.filter((height) => height !== expectedHeight).length + Number(reordered),
  };
}
