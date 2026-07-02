/**
 * Shared visual theme for the showcase compositor — brand colors + font stack.
 * Kept in one place so intro/outro/captions/backdrop stay cohesive.
 */
export const THEME = {
  bg: '#05060c',
  bgDeep: '#0a0f1e',
  bgGlow: '#10203f',
  amber: '#f5b544',
  amberDeep: '#f59e0b',
  indigo: '#4f6bed',
  textStrong: '#ffffff',
  textSoft: 'rgba(255,255,255,0.72)',
  textFaint: 'rgba(255,255,255,0.45)',
  font: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
} as const;
