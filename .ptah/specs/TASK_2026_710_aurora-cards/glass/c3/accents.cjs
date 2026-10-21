// Primary-accent definitions for the two Ptah glass themes (gold = default, no attribute).
// build.cjs turns these into the "8. Accent" section of glass-layer.css. Hex in, OKLCH channels out.
//   p/pf/pc      -> DaisyUI --p/--pf/--pc (primary, primary-focus, primary-content)
//   focus/link   -> text-ish uses (focus ring, links, brand h1); gold = --ptah-gold chip
//   a/b/ink      -> filled .btn-primary / progress gradient (top, bottom, label ink); hovA/hovB hover gradient
//   glow         -> btn-primary drop-glow colour
module.exports = {
  'ptah-glass': {
    violet: { p: '#b9a2ff', pf: '#cbb9ff', pc: '#150c33', focus: '#e0d5ff', link: '#d9ccff', gold: '#b9a2ff', a: '#cdbcff', b: '#a68aff', ink: '#150c33', hovA: '#ddd0ff', hovB: '#b59cff', glow: 'rgb(167 138 255 / 0.6)' },
    teal: { p: '#35c8d0', pf: '#5fd8e0', pc: '#031a1f', focus: '#9aeaf0', link: '#7fe3ea', gold: '#35c8d0', a: '#6fdde6', b: '#2fb9c6', ink: '#031a1f', hovA: '#8be6ee', hovB: '#3fc6d3', glow: 'rgb(53 200 208 / 0.6)' },
  },
  'ptah-glass-light': {
    violet: { p: '#5b3fc4', pf: '#4a31a6', pc: '#f6f2ff', focus: '#4a31a6', link: '#4a31a6', gold: '#6b46d6', a: '#c9b8ff', b: '#a88cf7', ink: '#1a0f45', hovA: '#d8caff', hovB: '#b59cf9', glow: 'rgb(124 92 240 / 0.5)' },
    teal: { p: '#0a6b73', pf: '#08555c', pc: '#effeff', focus: '#07545b', link: '#07545b', gold: '#0e8d97', a: '#7fe0e6', b: '#35bfcb', ink: '#02262b', hovA: '#97e8ed', hovB: '#44cbd6', glow: 'rgb(14 141 151 / 0.5)' },
  },
};
