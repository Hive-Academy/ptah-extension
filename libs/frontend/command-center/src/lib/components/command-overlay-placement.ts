import type { Rect, SceneGeometry } from '../scene/connector-geometry';

export interface PlateReservation {
  readonly pinnedId: string | null;
  readonly anchorKind: 'stream' | 'root' | null;
  readonly inlineSlotHeight: number;
  readonly reservedHeight: number;
}

export type PlateMode = 'inline' | 'external';

export interface PinnedPlatePlacement {
  readonly mode: PlateMode;
  readonly plate: Rect;
  readonly scrollInsidePlate: boolean;
  readonly reservation: PlateReservation;
}

export const EMPTY_PLATE_RESERVATION: PlateReservation = {
  pinnedId: null, anchorKind: null, inlineSlotHeight: 0, reservedHeight: 0,
};

/** A 16px dead band prevents reservation-driven resize feedback. */
export function choosePlateMode(availableHeight: number, previous: PlateMode | null = null): PlateMode {
  if (previous === 'inline') return availableHeight < 104 ? 'external' : 'inline';
  if (previous === 'external') return availableHeight >= 136 ? 'inline' : 'external';
  return availableHeight >= 120 ? 'inline' : 'external';
}

/** Uses the unreserved viewport height. Pass the previous mode only for a real resize. */
export function placePinnedPlate(
  geometry: SceneGeometry,
  pinnedId: string,
  anchorKind: 'stream' | 'root',
  naturalPlateHeight: number,
  previousMode: PlateMode | null = null,
): PinnedPlatePlacement | null {
  const natural = Math.max(0, naturalPlateHeight);
  const width = Math.min(256, Math.max(0, geometry.streamContent.width));
  if (anchorKind === 'root') {
    const plateHeight = Math.min(natural, Math.max(0, geometry.stage.y + geometry.stage.height - geometry.dial.y - geometry.dial.height - 8));
    const rootWidth = Math.min(width, geometry.dial.width);
    return {
      mode: 'external',
      plate: { x: Math.max(geometry.dial.x, Math.min(geometry.rootButton.x, geometry.dial.x + geometry.dial.width - rootWidth)), y: geometry.dial.y + geometry.dial.height + 8, width: rootWidth, height: plateHeight },
      scrollInsidePlate: natural > plateHeight,
      reservation: { pinnedId, anchorKind, inlineSlotHeight: 0, reservedHeight: plateHeight + 56 },
    };
  }
  const row = geometry.rows[pinnedId];
  if (!row) return null;
  const availableHeight = geometry.streamViewport.height - 44 - 8;
  const mode = choosePlateMode(availableHeight, previousMode);
  const plateHeight = mode === 'inline' ? Math.min(natural, Math.max(0, availableHeight)) : natural;
  return {
    mode,
    plate: {
      x: geometry.streamContent.x,
      y: mode === 'inline' ? row.y + row.height + 8 : geometry.streamViewport.y + geometry.streamViewport.height + 8,
      width,
      height: plateHeight,
    },
    scrollInsidePlate: natural > plateHeight,
    reservation: {
      pinnedId, anchorKind,
      inlineSlotHeight: mode === 'inline' ? plateHeight + 8 : 0,
      reservedHeight: mode === 'external' ? plateHeight + 56 : 0,
    },
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function inside(rect: Rect, bounds: Rect): boolean {
  return rect.x >= bounds.x && rect.y >= bounds.y && rect.x + rect.width <= bounds.x + bounds.width && rect.y + rect.height <= bounds.y + bounds.height;
}

/** Returns a visual preview only when its whole rectangle is safe. It never reserves space. */
export function findHoverPreviewPlacement(
  geometry: SceneGeometry,
  anchorId: string,
  previewHeight: number,
  rail: Rect | null = null,
  anchorKind: 'stream' | 'root' = 'stream',
): Rect | null {
  if (geometry.stage.width < 960 || previewHeight <= 0) return null;
  const anchor = anchorKind === 'root' ? geometry.rootButton : geometry.rows[anchorId];
  if (!anchor) return null;
  const obstacles = [geometry.streamViewport, geometry.dial, ...Object.values(geometry.rows), ...Object.values(geometry.cards), ...(rail ? [rail] : [])];
  const safe = (candidate: Rect): boolean => candidate.width >= 92 && inside(candidate, geometry.stage) && obstacles.every((rect) => !intersects(candidate, rect));
  const above: Rect = { x: geometry.streamViewport.x, y: geometry.streamViewport.y - previewHeight - 4, width: Math.min(256, geometry.streamViewport.width), height: previewHeight };
  if (safe(above)) return above;
  const rightGap = geometry.dial.x - (geometry.streamViewport.x + geometry.streamViewport.width);
  const right: Rect = { x: geometry.streamViewport.x + geometry.streamViewport.width + 4, y: anchor.y, width: Math.min(256, rightGap - 8), height: previewHeight };
  if (safe(right)) return right;
  const below: Rect = { x: geometry.streamViewport.x, y: geometry.streamViewport.y + geometry.streamViewport.height + 4, width: Math.min(256, geometry.streamViewport.width), height: previewHeight };
  return safe(below) ? below : null;
}
