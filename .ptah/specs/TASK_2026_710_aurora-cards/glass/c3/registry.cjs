// Theme registry for the prototype = what ThemeService's DAISYUI_THEMES would carry.
//   glass: opt in (data-glass="on")      mode: data-glass-mode      scene: key of the override map in build.cjs
//   stock: DaisyUI prebuilt (channel vars come from full.css)       bcmT: share of b1 mixed into bc for --bcm
//   ink:   rare per-theme override string (measured; see NOTES.md)
module.exports = {
  'ptah-glass': { label: 'Ptah Glass', glass: true, mode: 'dark', scene: 'ptah-glass' },
  'ptah-glass-light': { label: 'Ptah Glass Light', glass: true, mode: 'light', scene: 'ptah-glass-light' },
  dark: { label: 'dark', stock: true, glass: true, mode: 'dark', scene: 'dark', bcmT: 0.03, ink: '--bc: 95% 0.012 250;' },
  nord: { label: 'nord', stock: true, glass: true, mode: 'light', scene: 'nord', bcmT: 0.12 },
  cupcake: { label: 'cupcake', stock: true, glass: true, mode: 'light', scene: 'cupcake', bcmT: 0.18 },
  dracula: { label: 'dracula', stock: true, glass: true, mode: 'dark', scene: 'dracula', bcmT: 0.03 },
  lofi: { label: 'lofi (opt-out)', stock: true, glass: false, mode: 'light', bcmT: 0.3 },
};
