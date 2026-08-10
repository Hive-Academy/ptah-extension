/**
 * The ONLY place that decides how an output style reaches a session.
 * `inject` is defined as `!fileVisible`, so the two paths are complements of
 * one boolean and CANNOT both be true. R3 / Req 5.3.
 *
 * The `outputStyle` KEY always rides the flag tier (Options.settings), which
 * the binary's km() enables unconditionally — so key visibility is not an
 * input here. Only FILE visibility varies, because HU gates directory scans
 * on i3('userSettings') / i3('projectSettings').
 *
 * Mirrors sdk-query-options-builder.ts:625-629 exactly. If that predicate
 * changes, this must change with it — see the guard spec.
 */
import { injectable } from 'tsyringe';
import type {
  ActivationDecision,
  OutputStyleEntry,
} from '@ptah-extension/shared';

/**
 * Provider base URLs whose sessions drop the `'user'` tier from
 * `settingSources` — the ONE axis on which a style file can be invisible.
 *
 * This is a deliberate duplicate of the literal in
 * `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`, not a
 * shared import: `output-styles` must not depend on `agent-sdk` (that would
 * invert the lib graph). The duplication is held honest by a drift guard in
 * `output-style-activation.resolver.spec.ts`, which reads the builder source
 * and fails CI if the two literals separate.
 */
export const LOCALHOST_BASE_URL_RE = /^https?:\/\/(127\.0\.0\.1|localhost)/i;

export interface ResolveActivationInput {
  /** The already name-resolved winner from discovery, or `null` for "no style". */
  readonly style: OutputStyleEntry | null;
  /** `ProviderProfile.baseUrl` for the session being started. */
  readonly providerBaseUrl: string | undefined;
}

export function resolveActivation(
  input: ResolveActivationInput,
): ActivationDecision {
  if (!input.style) return { path: 'none' };

  // Built-ins live in the binary's CwH map, keyed by name, independent of any
  // directory scan — always resolvable. Plugin styles load through the plugin
  // mechanism, not through HU's settingSources-gated scan.
  const fileVisible =
    input.style.tier === 'builtin' ||
    input.style.tier === 'plugin' ||
    input.style.tier === 'project' ||
    // user tier is the ONLY one HU drops, and only for localhost providers
    !LOCALHOST_BASE_URL_RE.test(input.providerBaseUrl?.trim() ?? '');

  return fileVisible
    ? { path: 'flag', styleName: input.style.name }
    : {
        path: 'inject',
        // `body` is optional on `OutputStyleEntry` only because built-ins carry
        // no text (it lives in the binary). This branch is reachable for the
        // user tier alone, and discovery always populates `body` for a
        // file-backed tier — so the fallback is unreachable in practice and
        // exists to keep the union total rather than to paper over a gap.
        body: input.style.body ?? '',
        styleName: input.style.name,
      };
}

/**
 * Thin injectable wrapper so the decision can be reached through DI from the
 * chat-session call site. It holds no state and does no I/O — every rule lives
 * in the pure function above, which is what the truth-table spec exercises.
 */
@injectable()
export class OutputStyleActivationResolver {
  resolve(input: ResolveActivationInput): ActivationDecision {
    return resolveActivation(input);
  }
}
