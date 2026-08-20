/**
 * Inline stroke icons for the self-shot overlays.
 *
 * Hand-authored rather than pulled from an icon package: every glyph is a list
 * of `path` commands on a 24×24 grid with `pathLength="1"`, which lets the
 * renderer draw each stroke on by animating `strokeDashoffset` from 1 → 0
 * regardless of the path's real length. Paths within an icon are staggered so a
 * glyph assembles itself instead of appearing whole.
 *
 * Add a glyph by adding a key here — `beats.json` references it by name via the
 * optional `icon` field on `keyword` / `stat` beats.
 */
import React from 'react';

export type IconName =
  | 'sparkles'
  | 'layers'
  | 'agents'
  | 'memory'
  | 'wizard'
  | 'terminal'
  | 'shield'
  | 'plug'
  | 'branch'
  | 'trending'
  | 'runtimes'
  | 'code';

/** Each icon is an ordered list of path `d` strings; order drives the stagger. */
const ICONS: Record<IconName, string[]> = {
  sparkles: [
    'M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16 10.1 11.4 5.5 9.5 10.1 7.6z',
    'M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  ],
  layers: ['M12 2 3 7l9 5 9-5-9-5z', 'M3 12l9 5 9-5', 'M3 17l9 5 9-5'],
  agents: [
    'M3 3h4v4H3z',
    'M10 3h4v4h-4z',
    'M17 3h4v4h-4z',
    'M3 10h4v4H3z',
    'M10 10h4v4h-4z',
    'M17 10h4v4h-4z',
    'M3 17h4v4H3z',
    'M10 17h4v4h-4z',
    'M17 17h4v4h-4z',
  ],
  memory: [
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z',
    'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
    'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  ],
  wizard: [
    'M2 22l9-9',
    'M13 5l6 6',
    'M16.5 1.5l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8L12.5 5.5l2.8-1.2z',
  ],
  terminal: ['M4 17l6-6-6-6', 'M12 19h8'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
  plug: ['M12 22v-5', 'M9 7V2', 'M15 7V2', 'M6 7h12v4a6 6 0 0 1-12 0z'],
  branch: [
    'M6 3v12',
    'M21 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M18 9a9 9 0 0 1-9 9',
  ],
  trending: ['M22 7l-8.5 8.5-5-5L2 17', 'M16 7h6v6'],
  runtimes: ['M2 8h6v11H2z', 'M9 4h6v15H9z', 'M16 8h6v11h-6z'],
  code: ['M16 18l6-6-6-6', 'M8 6l-6 6 6 6'],
};

export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && value in ICONS;
}

/**
 * Draw-on stroke icon. `progress` (0→1) sweeps each path's dash offset closed,
 * with a per-path stagger so multi-stroke glyphs build up.
 */
export const AnimatedIcon: React.FC<{
  name: IconName;
  size: number;
  color: string;
  progress: number;
  strokeWidth?: number;
}> = ({ name, size, color, progress, strokeWidth = 2 }) => {
  const paths = ICONS[name];
  // Each path gets its own slice of the timeline, overlapping by half a slot.
  const slot = 1 / (paths.length + 1);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ overflow: 'visible' }}>
      {paths.map((d, i) => {
        const start = i * slot * 0.85;
        const local = Math.max(0, Math.min(1, (progress - start) / (slot * 2)));
        return (
          <path
            key={`${name}-${i}`}
            d={d}
            pathLength={1}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={1}
            strokeDashoffset={1 - local}
            opacity={local > 0 ? 1 : 0}
          />
        );
      })}
    </svg>
  );
};
