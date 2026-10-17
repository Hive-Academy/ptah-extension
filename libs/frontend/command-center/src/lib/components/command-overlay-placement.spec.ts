import type { Rect, SceneGeometry } from '../scene/connector-geometry';
import {
  EMPTY_PLATE_RESERVATION, choosePlateMode, findHoverPreviewPlacement, placePinnedPlate,
} from './command-overlay-placement';

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

function geometry(width = 1056, contentWidth = 241, viewportHeight = 205): SceneGeometry {
  return {
    stage: rect(0, 0, width, 800),
    streamViewport: rect(20, 70, contentWidth + 29, viewportHeight),
    streamContent: rect(27, 70, contentWidth, viewportHeight),
    rows: { first: rect(27, 80, contentWidth, 44), second: rect(27, 130, contentWidth, 44) },
    dial: rect(391, 180, 292, 292),
    rootButton: rect(447, 236, 180, 180),
    cards: {
      inProgress: rect(784, 100, 252, 80), waiting: rect(784, 200, 252, 80),
      finished: rect(784, 300, 252, 80), other: rect(784, 400, 252, 80),
    },
  };
}

describe('pinned plate placement', () => {
  it.each([[241, 241], [248, 248], [315, 256], [255, 255]])('caps %ipx content at %ipx', (contentWidth, expected) => {
    const placed = placePinnedPlate(geometry(contentWidth < 260 ? 1056 : 400, contentWidth), 'first', 'stream', 200);
    expect(placed?.plate.width).toBe(expected);
    expect(placed?.plate.x).toBe(27);
    expect(placed?.plate.y).toBe(132);
  });

  it('caps a four-row plate inside its scroll box and externally reserves a three-row plate', () => {
    const four = placePinnedPlate(geometry(), 'first', 'stream', 200);
    expect(four?.plate.height).toBe(153);
    expect(four?.scrollInsidePlate).toBe(true);
    expect(four?.reservation).toEqual({ pinnedId: 'first', anchorKind: 'stream', inlineSlotHeight: 161, reservedHeight: 0 });
    const three = placePinnedPlate(geometry(1056, 241, 161), 'first', 'stream', 200);
    expect(three?.plate.height).toBe(200);
    expect(three?.reservation).toEqual({ pinnedId: 'first', anchorKind: 'stream', inlineSlotHeight: 0, reservedHeight: 256 });
    expect(three?.plate.y).toBe(239);
  });

  it('places the root pin directly below the dial in every layout', () => {
    for (const width of [1056, 900, 400, 340]) {
      const placed = placePinnedPlate(geometry(width), 'root', 'root', 180);
      expect(placed?.plate.y).toBe(480);
      expect(placed?.reservation).toEqual({ pinnedId: 'root', anchorKind: 'root', inlineSlotHeight: 0, reservedHeight: 236 });
    }
  });

  it('latches the mode until a resize crosses the 16px dead band', () => {
    expect(choosePlateMode(120)).toBe('inline');
    expect(choosePlateMode(119, 'inline')).toBe('inline');
    expect(choosePlateMode(104, 'inline')).toBe('inline');
    expect(choosePlateMode(103, 'inline')).toBe('external');
    expect(choosePlateMode(135, 'external')).toBe('external');
    expect(choosePlateMode(136, 'external')).toBe('inline');
  });
});

describe('hover preview placement', () => {
  it('uses the 93px side candidate at 1440 when above is blocked', () => {
    const placed = findHoverPreviewPlacement(geometry(), 'first', 72);
    expect(placed).toEqual(rect(294, 80, 93, 72));
    expect(placed && placePinnedPlate(geometry(), 'first', 'stream', 72)?.reservation.reservedHeight).toBe(0);
    expect(EMPTY_PLATE_RESERVATION).toEqual({ pinnedId: null, anchorKind: null, inlineSlotHeight: 0, reservedHeight: 0 });
  });

  it('switches candidate to the next row and rejects row, dial, card and rail collisions', () => {
    const aboveBlocked = rect(20, 0, 270, 70);
    const first = findHoverPreviewPlacement(geometry(), 'first', 40, aboveBlocked);
    const second = findHoverPreviewPlacement(geometry(), 'second', 40, aboveBlocked);
    expect(first?.y).toBe(80);
    expect(second?.y).toBe(130);
    const blocked = geometry();
    expect(findHoverPreviewPlacement(blocked, 'first', 40, rect(0, 0, 400, 800))).toBeNull();
    expect(findHoverPreviewPlacement(blocked, 'missing', 40)).toBeNull();
  });

  it.each([959, 900, 400, 340])('suppresses the preview at %ipx', (width) => {
    expect(findHoverPreviewPlacement(geometry(width), 'first', 40)).toBeNull();
  });
});
