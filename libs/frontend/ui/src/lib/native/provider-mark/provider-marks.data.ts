/**
 * Hand-authored provider glyphs for `ProviderMarkComponent` — a data table of
 * inlined, sanitized TypeScript path constants in the shared `MarkArtwork`
 * shape, drawn by the one mark renderer (`ptah-mark-svg`).
 *
 * WHY TYPESCRIPT CONSTANTS AND NOT `.svg` ASSETS (plan Decision 10, D1 + D2).
 * The VS Code Marketplace ingestion scanner rejects trademarked AI product
 * names in non-JS files, and it scans a file PATH before its contents — so
 * `assets/icons/<vendor>.svg` would carry the token regardless of what is
 * inside the file, and a failed extension id is permanently burned
 * (`CLAUDE.md:180-189`). Path data authored as TypeScript compiles into the
 * webview JS bundle, and JS bundles pass the scanner.
 *
 * SANITIZATION IS A BUILD-TIME OBLIGATION, NOT A RUNTIME ONE. Each path
 * carries ONLY its `d` data (and a `null` fill: stroke glyphs are painted in
 * `currentColor`). `<title>`, `<desc>`, comments, metadata, and any `class` or
 * `id` attribute are stripped when the constant is authored. Nothing at
 * runtime parses SVG markup, so there is no injection surface — the renderer
 * builds `<svg><path [attr.d]>` in its template.
 *
 * THE ALLOWLIST IS THE TABLE. No component may branch on a provider id
 * (the same rule `model-tier-derivation.ts` already holds). A provider id
 * absent from this table (and from `PROVIDER_BRAND_SLUGS`) falls back to a
 * lucide glyph chosen by the host; a record with `kind: 'lucide'` PINS that
 * glyph in the table so the host does not have to guess it.
 *
 * LICENSING (R1, resolved 2026-09-23 by the user: real vendor marks). Vendors
 * with a vendored logo are NOT drawn here: `PROVIDER_BRAND_SLUGS`
 * (`../brand-mark/brand-slugs.ts`) maps their provider ids to the vendored
 * artwork in `PROVIDER_BRAND_ART`, whose licence and trademark notes live in
 * `../brand-mark/brand-icons-notices.txt`. This table keeps only the
 * providers with no vendored mark. Its stroke records are hand-authored
 * simplified monochrome marks on a `0 0 24 24` grid (stroke-width 2, round
 * caps, applied by the renderer), so they render consistently beside the
 * lucide fallbacks. They can drift from a vendor's current mark and nothing
 * detects that drift — accepted by Decision 10's trade-off.
 */
import type { MarkArtwork, MarkArtworkPath } from '../brand-mark/mark-artwork';

/**
 * The lucide glyph a host picks for an id this table does not know.
 * `Terminal` for a CLI route, `Server` for an endpoint or local server,
 * `Bot` otherwise.
 */
export type ProviderMarkLucideIcon = 'Bot' | 'Server' | 'Terminal';

/** Hand-authored 24-grid line artwork, drawn with a `currentColor` stroke. */
export type ProviderStrokeMark = MarkArtwork & { readonly kind: 'stroke' };

/**
 * One table record. `kind: 'stroke'` is an inlined sanitized glyph; `kind:
 * 'lucide'` resolves to the named lucide fallback glyph.
 */
export type ProviderMark =
  | ProviderStrokeMark
  | { readonly kind: 'lucide'; readonly icon: ProviderMarkLucideIcon };

/** A `0 0 24 24` stroke glyph from its path segments, in paint order. */
export function strokeMark(segments: readonly string[]): ProviderStrokeMark {
  return {
    viewBox: '0 0 24 24',
    kind: 'stroke',
    paths: segments.map((d): MarkArtworkPath => ({ d, fill: null })),
  };
}

/**
 * Hand-authored simplified monochrome llama head shared by both Ollama
 * entries — Ollama and Ollama Cloud are the same vendor mark.
 */

/**
 * The hand-authored mark table, keyed by registry provider id (merged
 * registry: Anthropic-compatible providers, CLI agent adapters, and
 * `ptah-cli` — Ptah's own CLI agent id). User-defined custom entries are
 * deliberately absent; they always fall back.
 */
export const PROVIDER_MARKS: Readonly<Record<string, ProviderMark>> = {
  // Simplified pi glyph: top bar plus two legs.
  pi: strokeMark(['M5 7 L19 7', 'M8 7 L8 18', 'M14 7 L14 18']),
  // Ptah's own CLI agent id (`agent-process.types.ts`), rendered as a
  // simplified stroke "P".
  'ptah-cli': strokeMark([
    'M8 21 L8 3 L14.5 3 C17.5 3 19.5 5 19.5 8 C19.5 11 17.5 13 14.5 13 L8 13',
  ]),
  // Everything NOT listed here (or in `PROVIDER_BRAND_SLUGS`) falls
  // back to the host-supplied `fallback` input of `ProviderMarkComponent`.
};
