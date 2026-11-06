/**
 * The NGXUI Lightfall inputs (same names and meaning), minus `className`/`style`
 * (set them on the host) and `dpr` (see `maxDpr`). Colours are hex strings.
 */
export interface LightfallOptions {
  /** Beam, flare and fog colour. */
  readonly color: string;
  /** Added on the brightest light so the core turns white-hot. */
  readonly coreColor: string;
  /** Beam origin from the canvas centre, as a fraction of its width. */
  readonly horizontalBeamOffset: number;
  /** Beam origin above the canvas bottom, as a fraction of its height. */
  readonly verticalBeamOffset: number;
  readonly horizontalSizing: number;
  readonly verticalSizing: number;
  readonly flowSpeed: number;
  readonly flowStrength: number;
  readonly fogIntensity: number;
  readonly fogScale: number;
  readonly fogFallSpeed: number;
  readonly wispDensity: number;
  readonly wispSpeed: number;
  readonly wispIntensity: number;
  readonly decay: number;
  readonly falloffStart: number;
  /** How far the fog leans toward the pointer. */
  readonly mouseTiltStrength: number;
  /** Seconds the pointer takes to settle (0 follows it at once). */
  readonly mouseSmoothTime: number;
  /** Highest device pixel ratio drawn; the frame-rate governor may go lower. */
  readonly maxDpr: number;
}

/** NGXUI's defaults, recoloured to the brand amber (#f5a524 / #ffbb4d, core #fff9eb). */
export const LIGHTFALL_DEFAULTS: LightfallOptions = {
  color: '#ffb340',
  coreColor: '#fff3d6',
  horizontalBeamOffset: 0,
  verticalBeamOffset: 0,
  horizontalSizing: 0.5,
  verticalSizing: 2,
  flowSpeed: 0.35,
  flowStrength: 0.25,
  fogIntensity: 0.45,
  fogScale: 0.3,
  fogFallSpeed: 0.6,
  wispDensity: 1,
  wispSpeed: 15,
  wispIntensity: 5,
  decay: 1.1,
  falloffStart: 1.2,
  mouseTiltStrength: 0.01,
  mouseSmoothTime: 0,
  maxDpr: 2,
};

/** `#rgb` or `#rrggbb` to 0..1 channels; anything else reads as white (as NGXUI). */
export function hexToRgb(hex: string): [number, number, number] {
  let value = hex.trim().replace(/^#/, '');
  if (value.length === 3) value = [...value].map((c) => c + c).join('');
  const parsed = /^[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value, 16) : 0xffffff;
  return [((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255];
}
