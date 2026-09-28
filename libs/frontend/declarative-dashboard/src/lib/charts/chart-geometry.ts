import type { DashboardSeries } from '@ptah-extension/shared';

export interface ChartPoint {
  readonly seriesIndex: number;
  readonly pointIndex: number;
  readonly name: string;
  readonly x: string | number;
  readonly y: number;
  readonly px: number;
  readonly py: number;
  readonly barX: number;
  readonly barY: number;
  readonly barWidth: number;
  readonly barHeight: number;
}

/** Fixed SVG coordinates; attributes only, with no DOM or style dependencies. */
export function chartGeometry(series: readonly DashboardSeries[], kind: 'line-chart' | 'bar-chart') {
  const points = series.flatMap(item => item.points);
  const categories = [...new Set(points.map(point => point.x))];
  const categoryIndex = new Map(categories.map((value, index) => [value, index]));
  const numeric = kind === 'line-chart' && points.every(point => typeof point.x === 'number');
  const xs = points.map(point => typeof point.x === 'number' ? point.x : 0);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = Math.min(0, ...points.map(point => point.y));
  const maxY = Math.max(0, ...points.map(point => point.y));
  // Divide first so finite contract values near Number.MAX_VALUE cannot overflow.
  const ratio = (value: number, min: number, max: number) => {
    const scale = Math.max(Math.abs(min), Math.abs(max), 1);
    return min === max ? 0.5 : (value / scale - min / scale) / (max / scale - min / scale);
  };
  const y = (value: number) => 220 - ratio(value, minY, maxY) * 180;
  const baseline = y(0);
  const slot = 480 / Math.max(categories.length, 1);
  const barWidth = slot * 0.8 / Math.max(series.length, 1);
  const rows: ChartPoint[] = [];
  const geometry = series.map((item, seriesIndex) => {
    const mapped = item.points.map((point, pointIndex): ChartPoint => {
      const category = categoryIndex.get(point.x) ?? 0;
      const px = numeric ? 60 + ratio(Number(point.x), minX, maxX) * 480
        : 60 + (category + 0.5) * slot;
      const py = y(point.y);
      const result = { ...point, name: item.name, seriesIndex, pointIndex, px, py,
        barX: 60 + category * slot + slot * 0.1 + seriesIndex * barWidth,
        barY: Math.min(baseline, py), barWidth, barHeight: Math.abs(py - baseline) };
      rows.push(result);
      return result;
    });
    return { name: item.name, points: mapped,
      polyline: mapped.map(point => `${point.px},${point.py}`).join(' '),
      dash: seriesIndex === 0 ? 'none' : `${seriesIndex * 3 + 2} 3` };
  });
  return { series: geometry, rows, baseline, minY, maxY,
    firstX: numeric && points.length ? minX : categories[0] ?? '',
    lastX: numeric && points.length ? maxX : categories.at(-1) ?? '' };
}
