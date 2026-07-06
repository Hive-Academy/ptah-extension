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
  bgGlow: string;
  amber: string;
  amberDeep: string;
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
  },
};
