import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

describe('glass local scrim floors', () => {
  it('keeps the dark reading surfaces opaque enough', () => {
    const block = /:root\[data-theme\]\[data-glass='on'\]\[data-glass-mode='dark'\]\s*\{([^}]+)\}/.exec(css)?.[1] ?? '';
    for (const [token, floor] of Object.entries({ '--glass-plate': 0.5, '--glass-fill-tile': 0.5, '--glass-fill-input': 0.58, '--glass-code': 0.94, '--glass-under-bar': 0.6 })) {
      const alpha = Number(new RegExp(`${token}:\\s*oklch\\(var\\(--b1\\) / ([\\d.]+)\\)`).exec(block)?.[1]);
      expect(alpha).toBeGreaterThanOrEqual(floor);
    }
  });

  it('uses solid plates in the glass escape hatches', () => {
    expect(css.match(/--glass-plate:\s*oklch\(var\(--b1\)\);/g)).toHaveLength(2);
  });
});
