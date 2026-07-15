/**
 * Brand configuration — the SINGLE place to re-skin every showcase video.
 *
 * When porting this pipeline to another product/SaaS, this is the only file you
 * need to edit. Every brand string and color in the compositor resolves from
 * `BRAND` here:
 *   - `wordmark`    → persistent corner watermark (Watermark.tsx)
 *   - `productName` → default intro-card subtitle (ShowcaseVideo.tsx)
 *   - `tagline`     → outro tagline / domain (OutroCard.tsx)
 *   - `ctaLabel`    → outro call-to-action pill (OutroCard.tsx)
 *   - `theme`       → color + font system (re-exported as THEME by theme.ts)
 */

export interface BrandTheme {
  bg: string;
  bgDeep: string;
  /** Center glow for NEW operator-stage work (calmed dim emerald). */
  bgGlow: string;
  /** Legacy dim-blue center glow — the shipped dyad-vs-ptah backdrop uses this
   *  so its blue center is preserved while new work uses the emerald bgGlow. */
  bgGlowLegacy: string;
  amber: string;
  /** Lighter amber for highlights/emissive tips. */
  amberLight: string;
  amberDeep: string;
  /** Emerald accent — the "operator" second hue for NEW video work. */
  emerald: string;
  /** Lighter emerald for emissive highlights. */
  emeraldLight: string;
  /**
   * Legacy indigo accent. KEPT for back-compat: the shipped dyad-vs-ptah scenes
   * (ProviderOrbit, Mcp*) are built on it and must retain their look. NEW work
   * uses amber + emerald, not indigo.
   */
  indigo: string;
  textStrong: string;
  textSoft: string;
  textFaint: string;
  font: string;
}

export interface BrandConfig {
  /** Persistent low-opacity wordmark in the top-right. Empty string hides it. */
  wordmark: string;
  /** Default intro-card subtitle when a scene provides no `introCopy`. */
  productName: string;
  /** Outro tagline / domain, rendered lowercase under the CTA. */
  tagline: string;
  /** Outro call-to-action pill label. */
  ctaLabel: string;
  /** Color + font system shared across intro/outro/captions/backdrop/ring. */
  theme: BrandTheme;
}

export const BRAND: BrandConfig = {
  wordmark: 'PTAH',
  productName: 'Ptah',
  tagline: 'ptah.live',
  ctaLabel: 'Get Ptah free',
  theme: {
    // "Operator" ink bases — near-black, only a faint hint of emerald in the
    // center glow (amber/emerald come from the PROPS, not a colored fog).
    bg: '#08090c',
    bgDeep: '#0e1015',
    bgGlow: '#0b1613',
    bgGlowLegacy: '#10203f',
    // Operator amber ramp.
    amber: '#f5a524',
    amberLight: '#ffbb4d',
    amberDeep: '#c97e0e',
    // Operator emerald accent.
    emerald: '#34d399',
    emeraldLight: '#6ee7b7',
    // Legacy — untouched for dyad-vs-ptah back-compat.
    indigo: '#4f6bed',
    textStrong: '#ffffff',
    textSoft: 'rgba(255,255,255,0.72)',
    textFaint: 'rgba(255,255,255,0.45)',
    font: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
  },
};
