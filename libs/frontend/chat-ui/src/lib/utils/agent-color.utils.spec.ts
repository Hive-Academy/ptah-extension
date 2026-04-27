import { generateAgentColor } from './agent-color.utils';

describe('generateAgentColor', () => {
  it('returns the theme-aware fallback for empty input', () => {
    expect(generateAgentColor('')).toBe('oklch(var(--bc) / 0.5)');
  });

  it('returns the fixed built-in color for known agents', () => {
    expect(generateAgentColor('Explore')).toBe('oklch(0.6 0.18 145)');
    expect(generateAgentColor('Plan')).toBe('oklch(0.55 0.2 300)');
    expect(generateAgentColor('general-purpose')).toBe('oklch(0.55 0.2 265)');
    expect(generateAgentColor('claude-code-guide')).toBe('oklch(0.6 0.18 210)');
    expect(generateAgentColor('statusline-setup')).toBe('oklch(0.55 0.05 250)');
  });

  it('returns deterministic generated color for unknown agents', () => {
    const a = generateAgentColor('my-custom-agent');
    const b = generateAgentColor('my-custom-agent');
    expect(a).toBe(b);
    expect(a).toMatch(/^oklch\(0\.55 0\.15 \d+(\.\d+)?\)$/);
  });

  it('produces different hues for different unknown agents', () => {
    const a = generateAgentColor('alpha');
    const b = generateAgentColor('beta');
    expect(a).not.toBe(b);
  });
});
