import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

describe('composer visual regressions', () => {
  const root = join(__dirname, '../../../..');
  const source = (path: string) => readFileSync(join(root, path), 'utf8');

  it('keeps the empty-stage scrim isolated without raising it over suggestions', () => {
    const stage = source('libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.css');
    const body = /\.empty-chat__stage\s*\{([^}]+)\}/.exec(stage)?.[1] ?? '';
    expect(body).toContain('isolation: isolate;');
    expect(body).not.toMatch(/z-index:/);
    expect(stage).toMatch(/\.empty-chat__stage::before\s*\{[^}]*z-index: -1;/);
    expect(css).toContain("[data-glass-surface]:has(.popover-panel, .suggestions-panel) { z-index: 30; }");
    expect(css).toContain("[data-glass-surface='content']:has(.popover-panel, .suggestions-panel)");
  });

  it('pairs active-row ink with its fill and keeps descriptions and badges at full contrast', () => {
    const option = source('libs/frontend/chat/src/lib/components/file-suggestions/suggestion-option.component.ts');
    expect(option).toContain("'[class.suggestion-active]': 'isActive()'");
    const active = block(/:root \.suggestions-panel ptah-suggestion-option\.suggestion-active/);
    expect(active).toContain('background: oklch(var(--p));');
    expect(active).toContain('color: oklch(var(--pc));');
    expect(block(/:root \.suggestions-panel ptah-suggestion-option\.suggestion-active \.opacity-70/)).toContain('opacity: 1;');
    const badge = block(/:root \.suggestions-panel ptah-suggestion-option\.suggestion-active \.badge\.badge/);
    expect(badge).toContain('background: oklch(var(--pc));');
    expect(badge).toContain('color: oklch(var(--p));');
  });

  it('frames the whole composer card in the selected-session ink while focused', () => {
    expect(block(/\.chat-composer-card\.chat-composer-card--plan/)).toContain('--composer-focus-ink: oklch(var(--in));');
    expect(block(/:root:not\(\[data-glass='on'\]\) \.chat-composer-card:focus-within/)).toContain('inset 0 0 0 1px var(--composer-focus-ink)');
    expect(block(/:root\[data-glass='on'\] \.chat-composer-card textarea:focus-visible/)).toContain('outline: none;');
    const glow = block(/:root\[data-theme\]\[data-glass='on'\] \.chat-composer-card:focus-within::before/);
    expect(glow).toContain('var(--glass-glow-halo)');
    expect(glow).toContain('pointer-events: none;');
  });

  it.each(['anubis', 'ptah-glass', 'ptah-glass-light'])('keeps the %s selection palette above 4.5:1', (theme) => {
    const config = source('apps/ptah-extension-webview/tailwind.config.js');
    const palette = new RegExp(`["']?${theme}["']?:\\s*\\{([^}]+)`).exec(config)?.[1] ?? '';
    const color = (key: string) => new RegExp(`["']?${key}["']?:\\s*["'](#[a-fA-F0-9]{6})["']`).exec(palette)?.[1] ?? '';
    const luminance = (hex: string) => {
      expect(hex).toMatch(/^#[a-fA-F0-9]{6}$/);
      const channels = [1, 3, 5].map((offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const fill = luminance(color('primary'));
    const ink = luminance(color('primary-content'));
    expect((Math.max(fill, ink) + 0.05) / (Math.min(fill, ink) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses deep warm ink on light warning footnotes and preserves dark glass', () => {
    const popover = source('libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts');
    expect(popover).toContain('autopilot-warning text-[11px] text-warning');
    expect(block(/:root\[data-theme-mode='light'\] \.autopilot-warning/)).toContain('color: var(--ptah-gold-strong);');
    expect(block(/:root\[data-glass='on'\]\[data-glass-mode='dark'\] \.autopilot-warning/)).toContain('color: oklch(var(--wa) / 0.8);');
  });
});

/**
 * Body of the first rule whose selector ends with `selector` directly before `{`.
 * Callers pass a selector that occurs first as its own token block. Token blocks
 * hold no nested braces, so the body stops at the first `}`.
 */
function block(selector: RegExp): string {
  return new RegExp(`${selector.source}\\s*\\{([^}]+)\\}`).exec(css)?.[1] ?? '';
}

/** Alpha of a `--token: oklch(var(--b1) / <alpha>)` declaration in a block body. */
function b1Alpha(body: string, token: string): number {
  return Number(new RegExp(`${token}:\\s*oklch\\(var\\(--b1\\) / ([\\d.]+)\\)`).exec(body)?.[1]);
}

/** Plain number value of a `--token: <n>;` declaration in a block body. */
function numberValue(body: string, token: string): number {
  return Number(new RegExp(`${token}:\\s*([\\d.]+);`).exec(body)?.[1]);
}

const lightBlock = block(/:root\[data-theme\]\[data-glass='on'\]/);
const darkBlock = block(/:root\[data-theme\]\[data-glass='on'\]\[data-glass-mode='dark'\]/);
const hatches = [...css.matchAll(/:root\[data-theme\]\[data-glass='on'\]:is\(\[data-glass-mode='dark'\], \[data-glass-mode='light'\]\)\s*\{([^}]+)\}/g)];

describe('glass local scrim floors', () => {
  it('clears only Electron dock canvases and composer wrappers under glass', () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) =>
      selector.includes('.electron-git-dock') || selector.includes('[data-composer-overlay]'),
    );
    expect(rules.length).toBeGreaterThanOrEqual(5);
    for (const [, selector] of rules) {
      expect(selector).toContain(":root[data-glass='on']");
    }
    expect(css).toContain(".electron-git-dock :is([data-testid='changed-file-tree'], [data-testid='review-canvas-list'])");
  });

  it('marks the composer attachment menu as an overlay without changing the shared native popover', () => {
    const source = readFileSync(join(__dirname, '../../../../libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts'), 'utf8');
    expect(source).toMatch(/<div content data-glass-surface="overlay" data-composer-overlay[^>]*role="menu"/);
  });

  it('keeps composer overlays dense and respects opaque accessibility modes', () => {
    const composer = block(/:root\[data-glass='on'\] \[data-composer-overlay\]/);
    expect(numberValue(composer, '--glass-composer-overlay-alpha')).toBeGreaterThanOrEqual(0.98);
    expect(composer).toContain('--glass-fill-overlay: oklch(var(--b1) / var(--glass-composer-overlay-alpha));');
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)\s*\{\s*:root\[data-glass='on'\] \[data-composer-overlay\]\s*\{\s*--glass-composer-overlay-alpha: 1;/);
  });

  it('keeps the dark reading surfaces opaque enough', () => {
    for (const [token, floor] of Object.entries({ '--glass-plate': 0.5, '--glass-fill-tile': 0.5, '--glass-fill-input': 0.58, '--glass-code': 0.94, '--glass-under-bar': 0.6, '--glass-scrim-text': 0.62 })) {
      expect(b1Alpha(darkBlock, token)).toBeGreaterThanOrEqual(floor);
    }
  });

  it('keeps the light text scrim opaque enough', () => {
    expect(b1Alpha(lightBlock, '--glass-scrim-text')).toBeGreaterThanOrEqual(0.5);
  });

  it('uses solid plates in the glass escape hatches', () => {
    expect(hatches).toHaveLength(2);
    for (const [, body] of hatches) {
      expect(body).toContain('--glass-plate: oklch(var(--b1));');
    }
  });
});

describe('glass scene tint', () => {
  it('derives the tint once from the alpha token', () => {
    expect(lightBlock).toContain('--glass-tint: oklch(var(--b1) / var(--glass-tint-alpha));');
    expect([...css.matchAll(/--glass-tint:\s*oklch\(var\(--b1\) \/ var\(--glass-tint-alpha\)\)/g)]).toHaveLength(1);
  });

  it('keeps the base tint alpha at the measured floor (dark 0.70, light 0.50)', () => {
    expect(numberValue(darkBlock, '--glass-tint-alpha')).toBeGreaterThanOrEqual(0.7);
    expect(numberValue(lightBlock, '--glass-tint-alpha')).toBeGreaterThanOrEqual(0.5);
  });

  it('paints an opaque tint and an opaque or near-opaque text scrim in both escape hatches', () => {
    for (const [, body] of hatches) {
      expect(body).toContain('--glass-tint: oklch(var(--b1));');
      expect(body).toMatch(/--glass-scrim-text: oklch\(var\(--b1\)(?: \/ 0\.9\d*)?\);/);
    }
  });

  it('lays the tint over the scene on the backdrop layer', () => {
    // The scene layer itself (the hatches only hide it with display: none).
    const layer = /:root\[data-glass='on'\]::before\s*\{[^}]*content:[^}]*\}/.exec(css)?.[0] ?? '';
    expect(layer).toMatch(/background:\s*linear-gradient\(var\(--glass-tint\), var\(--glass-tint\)\), var\(--glass-scene, none\) center \/ cover no-repeat;/);
  });

  it('declares the tint and scrim tokens only under glass selectors (non-glass themes stay unchanged)', () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const declaring = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => /--glass-(?:tint|tint-alpha|scrim-text):/.test(body));
    expect(declaring.length).toBeGreaterThan(0);
    for (const [, selector] of declaring) expect(selector).toContain("[data-glass='on']");
  });

  it('drops the retired content and solid fill tokens', () => {
    expect(css).not.toMatch(/--glass-fill-(?:content|solid)\b/);
  });

  // Measured values: see the "Per-theme tint alpha" comment in styles.css. A change
  // here needs a new contrast measurement over the theme's own scene, not an edit.
  it('pins the measured per-theme tint alphas', () => {
    expect(numberValue(block(/:root\[data-theme='nord'\]\[data-glass='on'\]\[data-glass-mode='light'\]/), '--glass-tint-alpha')).toBe(0.72);
    expect(numberValue(block(/:root\[data-theme='cupcake'\]\[data-glass='on'\]\[data-glass-mode='light'\]/), '--glass-tint-alpha')).toBe(0.38);
  });

  it('pins the measured glass caption ink of dark and dracula, in dark glass only', () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const measured: Record<string, string> = { dark: '69.9176% 0.013402 250.8703', dracula: '71.9009% 0.013235 170.6564' };
    for (const [theme, bcm] of Object.entries(measured)) {
      const rules = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector, body]) => selector.includes(`[data-theme='${theme}']`) && body.includes(bcm));
      expect(rules).toHaveLength(1);
      expect(rules[0][1].trim()).toBe(`:root[data-theme='${theme}'][data-glass='on'][data-glass-mode='dark']`);
    }
  });

  it('paints the transcript column scrim only once a message exists, and clears the plates inside it', () => {
    const column = block(/:root\[data-theme\]\[data-glass='on'\] ptah-chat-transcript \.chat-scroll-content:has\(> \.chat-msg-slot\)/);
    expect(column).toContain('background: var(--glass-scrim-text);');
    expect(css).not.toMatch(/ptah-chat-transcript \.chat-scroll-content\s*\{[^}]*--glass-scrim-text/);
    const inner = block(/ptah-chat-transcript \.chat-scroll-content:has\(> \.chat-msg-slot\) :is\(\[data-glass-surface='content'\], \.chat-bubble:not\(\.chat-bubble-primary\):not\(\.cs-user-bubble\)\)/);
    expect(inner).toContain('background: transparent;');
  });

  it('never sets the tint itself in a per-theme rule, only its alpha', () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\[data-theme='[^']+'\]/.test(selector)) expect(body).not.toMatch(/--glass-tint:/);
    }
  });
});


describe('Ptah backdrop scenes', () => {
  const scenes = ['aurora', 'ember', 'tide', 'horizon'];
  const modes = [
    { theme: 'ptah-glass', floors: [0.70, 0.62, 0.58, 0.50] },
    { theme: 'ptah-glass-light', floors: [0.50, 0.42, 0.42, 0.38] },
  ];

  it.each(modes)('keeps all $theme scenes at their measured tint floors and reuses each URI', ({ theme, floors }) => {
    const selector = `:root[data-theme='${theme}'][data-glass='on']`;
    const start = css.indexOf(`${selector} {\n  --glass-scene-aurora:`);
    expect(start).toBeGreaterThan(-1);
    const body = css.slice(start, css.indexOf('}', start) + 1);
    expect(body).toContain('--glass-scene: var(--glass-scene-aurora);');
    expect(body).toContain('--glass-tint-alpha: var(--glass-tint-alpha-aurora);');
    for (const [index, scene] of scenes.entries()) {
      expect(numberValue(body, `--glass-tint-alpha-${scene}`)).toBeGreaterThanOrEqual(floors[index]);
      const encoded = new RegExp(`--glass-scene-${scene}: url\\("data:image/svg\\+xml,([^"\\n]+)"\\);`).exec(body)?.[1];
      expect(encoded).toBeDefined();
      const decoded = decodeURIComponent(encoded ?? '').trim();
      expect(decoded.startsWith('<svg')).toBe(true);
      expect(decoded.endsWith('</svg>')).toBe(true);
      const svg = new DOMParser().parseFromString(decoded, 'image/svg+xml');
      expect(svg.querySelector('parsererror')).toBeNull();
      expect(svg.documentElement.localName).toBe('svg');
      expect(new XMLSerializer().serializeToString(svg)).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(encoded).not.toContain("'");
      expect(css.split(encoded ?? 'missing-uri')).toHaveLength(2);
    }
  });

  it('scopes six overrides to the pair at specificity (0,4,0), after the dark tokens, without overriding opaque tint', () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => selector.includes('[data-scene='));
    expect(rules).toHaveLength(6);
    for (const [, selector, body] of rules) {
      expect(selector.trim()).toMatch(/^:root\[data-theme='ptah-glass(?:-light)?'\]\[data-glass='on'\]\[data-scene='(?:ember|tide|horizon)'\]$/);
      expect([...body.matchAll(/(--[\w-]+):/g)].map((match) => match[1])).toEqual(['--glass-scene', '--glass-tint-alpha']);
      expect(css.indexOf(selector.trim())).toBeGreaterThan(css.indexOf(":root[data-theme][data-glass='on'][data-glass-mode='dark']"));
      const scene = /data-scene='([^']+)'/.exec(selector)?.[1];
      expect(body).toContain(`--glass-scene: var(--glass-scene-${scene});`);
      expect(body).toContain(`--glass-tint-alpha: var(--glass-tint-alpha-${scene});`);
    }
  });
});
