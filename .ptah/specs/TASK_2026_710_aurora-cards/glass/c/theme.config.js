/**
 * Ptah Glass — DaisyUI 4 theme pair (panelist P3).
 *
 * Paste the two objects into `daisyui.themes` of
 * apps/ptah-extension-webview/tailwind.config.js:
 *
 *   daisyui: { themes: [ { anubis: {...} }, { 'anubis-light': {...} },
 *                        { 'ptah-glass': {...} }, { 'ptah-glass-light': {...} } ] }
 *
 * COLOUR ROLES (decision, see NOTES.md):
 *   primary   = Ptah gold          (every btn-primary, link, selection, focus ring)
 *   secondary = champagne gold     (headings / eyebrow text that the app keys on `text-secondary`)
 *   accent    = Nile teal          (secondary highlights, aurora counter-colour)
 *   neutral   = deep lapis (dark) / deep indigo (light) — the "dark glass card" tint
 *
 * A DaisyUI theme cannot carry alpha. Everything translucent lives in glass-layer.css.
 * Every custom key of `anubis` / `anubis-light` is present here:
 *   --bcm, --state-ink-{run,need,err,done,idle}, --ptah-check-edge,
 *   --rounded-box/-btn/-badge, --animation-btn/-input, --btn-focus-scale,
 *   --border-btn, --tab-border, --tab-radius.
 */
module.exports = {
  /* ------------------------------------------------------------------ */
  /* DARK — lapis night, smoky glass, gold brand                         */
  /* ------------------------------------------------------------------ */
  'ptah-glass': {
    'color-scheme': 'dark',

    // PRIMARY: Ptah gold. Filled buttons use the glass-layer gradient + dark ink.
    primary: '#e4b94a',
    'primary-focus': '#f2cd6b',
    'primary-content': '#1b1403',

    // SECONDARY: champagne gold (text-secondary headings stay in the brand family).
    secondary: '#efd48c',
    'secondary-focus': '#f6e2ab',
    'secondary-content': '#1b1403',

    // ACCENT: Nile teal.
    accent: '#45d0be',
    'accent-focus': '#6ce0d1',
    'accent-content': '#04201c',

    // NEUTRAL: lapis-tinted dark (btn-neutral, tooltips).
    neutral: '#1c2650',
    'neutral-focus': '#27346a',
    'neutral-content': '#e8edf9',

    // BASE: the opaque colours under the glass (also the source of bg-base-*/NN tints).
    'base-100': '#0b1226',
    'base-200': '#111a35',
    'base-300': '#1a2650',
    'base-content': '#edf1fb',
    // Secondary text tier (#aab6d3). Measured on glass in NOTES.md.
    '--bcm': '77.648% 0.0435 267.58',
    '--state-ink-run': '#93bdff',
    '--state-ink-need': '#ffb066',
    '--state-ink-err': '#ff9696',
    '--state-ink-done': '#5fe0a0',
    '--state-ink-idle': '#a3aecb',
    '--ptah-check-edge': '55%',

    // SEMANTIC COLORS (bright fills + dark ink; the alert/badge glass layer tints them).
    info: '#6aa6ff',
    'info-content': '#04122b',
    success: '#3fd08a',
    'success-content': '#03180d',
    // Orange, deliberately off the gold hue (same rule as anubis).
    warning: '#ff9f45',
    'warning-content': '#231000',
    error: '#ff6b6b',
    'error-content': '#2a0505',

    // DAISYUI CUSTOM PROPERTIES — large glass radii, hairline borders.
    '--rounded-box': '1.5rem',
    '--rounded-btn': '9999px',
    '--rounded-badge': '9999px',
    '--animation-btn': '0.18s',
    '--animation-input': '0.2s',
    '--btn-focus-scale': '1.02',
    '--border-btn': '1px',
    '--tab-border': '1px',
    '--tab-radius': '9999px',
  },

  /* ------------------------------------------------------------------ */
  /* LIGHT — milky pastel glass, lavender -> peach, deep-gold ink        */
  /* ------------------------------------------------------------------ */
  'ptah-glass-light': {
    'color-scheme': 'light',

    // PRIMARY: DEEP gold so `text-primary`, links and checked controls clear 4.5:1 on milky glass.
    // Filled .btn-primary is the same bright gold gradient as the dark theme (glass-layer.css).
    primary: '#7c5700',
    'primary-focus': '#624300',
    'primary-content': '#fff8e6',

    secondary: '#9a6b12',
    'secondary-focus': '#7a5300', // used as TEXT by the setup card eyebrow
    'secondary-content': '#fff8e6',

    accent: '#0b7f77',
    'accent-focus': '#08655f',
    'accent-content': '#effffd',

    // NEUTRAL: deep indigo — the single "dark glass card" for contrast (reference 3).
    neutral: '#2b2650',
    'neutral-focus': '#1f1b3d',
    'neutral-content': '#f1eefc',

    'base-100': '#f7f3fd',
    'base-200': '#eee8f8',
    'base-300': '#e2daf1',
    'base-content': '#1e1936',
    // Secondary text tier (#5b5379). Measured on glass in NOTES.md.
    '--bcm': '46.559% 0.0614 293.53',
    '--state-ink-run': '#2449b0',
    '--state-ink-need': '#8f5200',
    '--state-ink-err': '#a31f26',
    '--state-ink-done': '#0f6434',
    '--state-ink-idle': '#5f5878',
    '--ptah-check-edge': '55%',

    info: '#2a5fd0',
    'info-content': '#ffffff',
    success: '#167a45',
    'success-content': '#ffffff',
    warning: '#f59a3a',
    'warning-content': '#2a1300',
    error: '#cf3a3a',
    'error-content': '#ffffff',

    '--rounded-box': '1.5rem',
    '--rounded-btn': '9999px',
    '--rounded-badge': '9999px',
    '--animation-btn': '0.18s',
    '--animation-input': '0.2s',
    '--btn-focus-scale': '1.02',
    '--border-btn': '1px',
    '--tab-border': '1px',
    '--tab-radius': '9999px',
  },
};
