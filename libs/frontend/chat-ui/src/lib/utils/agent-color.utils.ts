/**
 * Structured oklch color: { l, c, h }. Used so callers can derive variants
 * (different alpha, lower chroma, etc.) WITHOUT regex-parsing a CSS string.
 */
export interface OklchColor {
  l: number;
  c: number;
  h: number;
}

/**
 * Sentinel returned when the requested agent is a falsy/empty type and we
 * cannot produce concrete l/c/h values. Callers should detect this via
 * `isThemeFallbackColor()` and use a CSS variable fallback (e.g.
 * `oklch(var(--bc) / x)`) instead of stringifying the sentinel.
 */
export const THEME_FALLBACK_OKLCH: OklchColor = { l: NaN, c: NaN, h: NaN };

export function isThemeFallbackColor(c: OklchColor): boolean {
  return Number.isNaN(c.l) || Number.isNaN(c.c) || Number.isNaN(c.h);
}

/**
 * Built-in agent color map (structured oklch) for theme consistency.
 */
const BUILTIN_AGENT_COLORS: Record<string, OklchColor> = {
  Explore: { l: 0.6, c: 0.18, h: 145 }, // Green
  Plan: { l: 0.55, c: 0.2, h: 300 }, // Purple
  'general-purpose': { l: 0.55, c: 0.2, h: 265 }, // Indigo
  'claude-code-guide': { l: 0.6, c: 0.18, h: 210 }, // Sky blue
  'statusline-setup': { l: 0.55, c: 0.05, h: 250 }, // Slate
};

/**
 * Generate a structured oklch color from an agent type string.
 *
 * Returns concrete `{ l, c, h }` values for built-in and custom agents.
 * For empty/falsy input we return `THEME_FALLBACK_OKLCH` so callers can
 * branch explicitly (e.g. fall back to `oklch(var(--bc) / x)`) rather than
 * regex-parsing a CSS string back into numbers.
 */
export function generateAgentColorOklch(agentType: string): OklchColor {
  if (!agentType) return THEME_FALLBACK_OKLCH;

  const builtin = BUILTIN_AGENT_COLORS[agentType];
  if (builtin) return builtin;

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < agentType.length; i++) {
    hash = agentType.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Convert hash to hue (0-360)
  const hue = Math.abs(hash % 360);

  // L=0.55 provides good contrast on both light and dark backgrounds.
  // C=0.15 gives vibrant but not oversaturated colors.
  return { l: 0.55, c: 0.15, h: hue };
}

/** Format a structured oklch color as a CSS string with optional alpha. */
export function formatOklch(color: OklchColor, alpha?: number): string {
  if (isThemeFallbackColor(color)) {
    const a = alpha === undefined ? 0.5 : alpha;
    return `oklch(var(--bc) / ${a})`;
  }
  if (alpha === undefined) {
    return `oklch(${color.l} ${color.c} ${color.h})`;
  }
  return `oklch(${color.l} ${color.c} ${color.h} / ${alpha})`;
}

/**
 * Generate a consistent oklch CSS string from an agent type string.
 * Same string always produces the same color.
 *
 * Built-in agents get fixed oklch colors for theme consistency.
 * Custom agents get dynamically generated colors based on name hash.
 * Empty/falsy input returns a theme-aware gray fallback.
 *
 * Prefer `generateAgentColorOklch()` when you need to derive variants
 * (different alpha/chroma) without round-tripping through string parsing.
 */
export function generateAgentColor(agentType: string): string {
  return formatOklch(generateAgentColorOklch(agentType));
}
