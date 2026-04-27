/**
 * Built-in agent color map (oklch) for theme consistency.
 * Extracted from InlineAgentBubbleComponent for reuse in compact view.
 */
const BUILTIN_AGENT_COLORS: Record<string, string> = {
  Explore: 'oklch(0.6 0.18 145)', // Green
  Plan: 'oklch(0.55 0.2 300)', // Purple
  'general-purpose': 'oklch(0.55 0.2 265)', // Indigo
  'claude-code-guide': 'oklch(0.6 0.18 210)', // Sky blue
  'statusline-setup': 'oklch(0.55 0.05 250)', // Slate
};

/**
 * Generate a consistent oklch color from an agent type string.
 * Same string always produces the same color.
 *
 * Built-in agents get fixed oklch colors for theme consistency.
 * Custom agents get dynamically generated colors based on name hash.
 * Empty/falsy input returns a theme-aware gray fallback.
 */
export function generateAgentColor(agentType: string): string {
  if (!agentType) return 'oklch(var(--bc) / 0.5)';

  if (BUILTIN_AGENT_COLORS[agentType]) {
    return BUILTIN_AGENT_COLORS[agentType];
  }

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < agentType.length; i++) {
    hash = agentType.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Convert hash to hue (0-360)
  const hue = Math.abs(hash % 360);

  // Use oklch for theme-aware generated colors
  // L=0.55 provides good contrast on both light and dark backgrounds
  // C=0.15 gives vibrant but not oversaturated colors
  return `oklch(0.55 0.15 ${hue})`;
}
