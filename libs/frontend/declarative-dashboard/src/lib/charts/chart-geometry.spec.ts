import { chartGeometry } from './chart-geometry';

describe('chartGeometry', () => {
  it('falls back to categorical spacing for mixed numeric and categorical line x values', () => {
    const geometry = chartGeometry([{ name: 'Mixed', points: [{ x: 100, y: 1 }, { x: '100', y: 2 }, { x: 'Tue', y: 3 }] }], 'line-chart');
    expect(geometry.rows.map(point => point.px)).toEqual([140, 300, 460]);
    expect(geometry.firstX).toBe(100);
    expect(geometry.lastX).toBe('Tue');
  });
  it('uses categorical slots for numeric bar x values', () => {
    const geometry = chartGeometry([{ name: 'Numeric', points: [{ x: 0, y: 1 }, { x: 2, y: 2 }, { x: 100, y: 3 }] }], 'bar-chart');
    expect(geometry.rows.map(point => point.px)).toEqual([140, 300, 460]);
    expect(geometry.rows.map(point => point.barX)).toEqual([76, 236, 396]);
    expect(geometry.rows.map(point => point.barWidth)).toEqual([128, 128, 128]);
  });
  it('scales numeric x values proportionally and negative y around zero', () => {
    const geometry = chartGeometry([{ name: 'A', points: [{ x: 0, y: -10 }, { x: 2, y: 0 }, { x: 10, y: 10 }] }], 'line-chart');
    expect(geometry.rows.map(point => point.px)).toEqual([60, 156, 540]);
    expect(geometry.rows.map(point => point.py)).toEqual([220, 130, 40]);
    expect(geometry.baseline).toBe(130);
  });
  it('aligns shared categories and groups bars across series', () => {
    const geometry = chartGeometry([
      { name: 'A', points: [{ x: 'Mon', y: -2 }, { x: 'Tue', y: 4 }] },
      { name: 'B', points: [{ x: 'Tue', y: 2 }] },
    ], 'bar-chart');
    expect(geometry.rows[1].px).toBe(geometry.rows[2].px);
    expect(geometry.rows[2].barX).toBe(geometry.rows[1].barX + geometry.rows[1].barWidth);
    expect(geometry.rows[0].barY).toBe(geometry.baseline);
    expect(geometry.rows.every(point => point.barHeight >= 0)).toBe(true);
    expect(geometry.series[0].dash).not.toBe(geometry.series[1].dash);
  });
  it('handles empty, singleton, all-zero and extreme finite values', () => {
    expect(chartGeometry([], 'line-chart').rows).toEqual([]);
    for (const ys of [[0], [Number.MAX_VALUE, -Number.MAX_VALUE]]) {
      const geometry = chartGeometry([{ name: 'A', points: ys.map(y => ({ x: y, y })) }], 'line-chart');
      expect(geometry.rows.every(point => Number.isFinite(point.px) && Number.isFinite(point.py))).toBe(true);
    }
  });
  it('labels numeric axis bounds even when points arrive out of order', () => {
    const geometry = chartGeometry([{ name: 'A', points: [{ x: 8, y: 1 }, { x: 2, y: 3 }] }], 'line-chart');
    expect(geometry.firstX).toBe(2);
    expect(geometry.lastX).toBe(8);
  });
  it('keeps every one of 5000 points and its original index', () => {
    const points = Array.from({ length: 5000 }, (_, x) => ({ x, y: x }));
    const geometry = chartGeometry([{ name: 'A', points }], 'line-chart');
    expect(geometry.series[0].polyline.split(' ')).toHaveLength(5000);
    expect(geometry.rows[4999].pointIndex).toBe(4999);
    expect(points[4999]).toEqual({ x: 4999, y: 4999 });
  });
});
