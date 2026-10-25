/**
 * Decorative per-provider accents for the provider list (TASK_2026_631): a
 * row's left border and mark-box tint only — colour never carries identity,
 * the provider name always stays in text.
 *
 * Brand-ish approximations, continued from the approved prototype
 * (`.ptah/specs/TASK_2026_631_7a3e/prototype/index.html`): one accent per
 * vendor across its ids (`anthropic`/`claude-cli`, `openai-codex`/`codex`,
 * `opencode`/`-go`/`-zen`, `ollama`/`ollama-cloud`, `github-copilot`/`copilot`).
 * The ids added in revise-1 (`openrouter`, `kimi-code`, `z-ai`, `grok`) are
 * the other owner ids `ProviderMarkComponent` draws a real vendored mark for
 * (`PROVIDER_BRAND_SLUGS` in libs/frontend/ui); their hues approximate each
 * vendor's current brand (OpenRouter "Grape" purple, Moonshot/Kimi indigo,
 * Z.ai blue, xAI monochrome grey). `gemini` was dropped in revise-1: no such
 * owner id exists anywhere in the provider tables.
 *
 * Ids the table does not know (custom providers, aggregators) fall back to
 * the muted text tier, which holds 3:1 on every base layer in both anubis
 * themes — the same neutral accent `change-set-card` uses.
 */
export const PROVIDER_ACCENTS: Readonly<Record<string, string>> = {
  anthropic: '#d97757',
  'claude-cli': '#d97757',
  'openai-codex': '#10a37f',
  codex: '#10a37f',
  opencode: '#3b82f6',
  'opencode-go': '#3b82f6',
  'opencode-zen': '#3b82f6',
  antigravity: '#8b5cf6',
  'github-copilot': '#8957e5',
  copilot: '#8957e5',
  ollama: '#9ca3af',
  'ollama-cloud': '#9ca3af',
  openrouter: '#6d28d9',
  'kimi-code': '#4f46e5',
  'z-ai': '#0ea5e9',
  grok: '#71717a',
};

const GENERIC_PROVIDER_ACCENT = 'oklch(var(--bcm, var(--bc)))';

/** The accent colour of a provider id (decorative, never identity-bearing). */
export function providerAccent(providerId: string): string {
  return Object.hasOwn(PROVIDER_ACCENTS, providerId)
    ? PROVIDER_ACCENTS[providerId]!
    : GENERIC_PROVIDER_ACCENT;
}
