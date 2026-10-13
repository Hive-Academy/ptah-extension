import { canvasDetailGeometry } from './canvas-detail-geometry';
import type { CanvasLayout } from './canvas-layout.service';

describe('canvasDetailGeometry', () => {
  it('extends the selected compact row through every overlapping tile', () => {
    const layout: CanvasLayout = {
      cellHeight: 100,
      columns: 2,
      tiles: [
        { tabId: 'A', x: 0, y: 0, w: 6, h: 6 },
        { tabId: 'B', x: 6, y: 0, w: 6, h: 2 },
        { tabId: 'C', x: 6, y: 2, w: 6, h: 2 },
        { tabId: 'D', x: 6, y: 4, w: 6, h: 2 },
      ],
    };

    const detail = canvasDetailGeometry('C', layout, 900);
    expect(detail?.rowEnd).toBe(6);
    expect(detail?.topPx).toBe(600);
    expect(detail?.belowIds).toEqual(new Set());
  });
});
