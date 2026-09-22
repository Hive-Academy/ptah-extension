/**
 * Vendor marks for `ProviderMarkComponent` — a data table of inlined,
 * sanitized TypeScript path constants.
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
 * record carries ONLY a `viewBox` and a `d` array. `<title>`, `<desc>`,
 * comments, metadata, and any `class` or `id` attribute are stripped when the
 * constant is authored. Nothing at runtime parses SVG markup, so there is no
 * injection surface — the component builds `<svg><path [attr.d]>` in its
 * template.
 *
 * THE ALLOWLIST IS THE TABLE. No component may branch on a provider id
 * (the same rule `model-tier-derivation.ts` already holds). A provider id
 * absent from this table falls back to a lucide glyph chosen by the host;
 * a record with `kind: 'lucide'` PINS that glyph in the table so the host
 * does not have to guess it. Granting a vendor a real mark later is a
 * one-record edit here.
 *
 * All path records below are hand-authored simplified monochrome marks,
 * drawn on a `0 0 24 24` stroke grid (stroke-width 2, round caps) so they
 * render consistently beside the lucide fallbacks. They can drift from a
 * vendor's current mark and nothing detects that drift — accepted by
 * Decision 10's trade-off. Licensing for individual marks is owned by a
 * separate lane (D1 / D2 in `context.md`).
 */

/**
 * The lucide glyph a host picks for an id this table does not know.
 * `Terminal` for a CLI route, `Server` for an endpoint or local server,
 * `Bot` otherwise.
 */
export type ProviderMarkLucideIcon = 'Bot' | 'Server' | 'Terminal';

/**
 * One vendor mark. `kind: 'path'` is an inlined sanitized mark; `kind:
 * 'lucide'` resolves to the named lucide fallback glyph.
 */
export type ProviderMark =
  | {
      readonly kind: 'path';
      readonly viewBox: string;
      readonly d: readonly string[];
    }
  | { readonly kind: 'lucide'; readonly icon: ProviderMarkLucideIcon };

/**
 * Hand-authored simplified monochrome llama head shared by both Ollama
 * entries — Ollama and Ollama Cloud are the same vendor mark.
 */
const OLLAMA_MARK_D: readonly string[] = [
  'M8 3 L8 6',
  'M12 3 L12 6',
  'M6 6 C4.3 6 3 7.3 3 9 L3 15 C3 18.9 6.1 21 10 21 L14 21 C17.9 21 21 18.9 21 15 L21 9 C21 7.3 19.7 6 18 6 Z',
  'M9 11 L9.01 11',
  'M14 21 L14 17',
];

/**
 * The vendor-mark table, keyed by registry provider id (merged registry:
 * Anthropic providers, CLI agent adapters, and `ptah-cli` — Ptah's own CLI
 * agent id). User-defined custom entries are deliberately absent; they always
 * fall back.
 */
export const PROVIDER_MARKS: Readonly<Record<string, ProviderMark>> = {
  openrouter: {
    kind: 'path',
    viewBox: '0 0 24 24',
    // Simplified routing mark: two mirrored chevrons meeting at a point.
    d: ['M3 6 L12 12 L3 18', 'M21 6 L12 12 L21 18'],
  },
  ollama: { kind: 'path', viewBox: '0 0 24 24', d: OLLAMA_MARK_D },
  'ollama-cloud': { kind: 'path', viewBox: '0 0 24 24', d: OLLAMA_MARK_D },
  opencode: {
    kind: 'path',
    viewBox: '0 0 24 24',
    // Simplified hexagon with an inner prompt chevron.
    d: ['M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z', 'M8.5 9 L13.5 12 L8.5 15'],
  },
  pi: {
    kind: 'path',
    viewBox: '0 0 24 24',
    // Simplified pi glyph: top bar plus two legs.
    d: ['M5 7 L19 7', 'M8 7 L8 18', 'M14 7 L14 18'],
  },
  'ptah-cli': {
    kind: 'path',
    viewBox: '0 0 24 24',
    // Ptah's own CLI agent id (`agent-process.types.ts`), rendered as a
    // simplified stroke "P".
    d: [
      'M8 21 L8 3 L14.5 3 C17.5 3 19.5 5 19.5 8 C19.5 11 17.5 13 14.5 13 L8 13',
    ],
  },
  // Lucide pins: the table names the fallback glyph so the host does not
  // have to. Everything NOT listed here falls back to the host-supplied
  // `fallback` input of `ProviderMarkComponent`.
  anthropic: { kind: 'lucide', icon: 'Bot' },
  'claude-cli': { kind: 'lucide', icon: 'Terminal' },
  'lm-studio': { kind: 'lucide', icon: 'Server' },
};
