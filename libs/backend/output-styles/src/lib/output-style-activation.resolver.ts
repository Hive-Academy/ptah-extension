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
 * ## Why this takes a boolean and not a base URL
 *
 * It used to take `providerBaseUrl` and INFER user-tier visibility from a
 * localhost regex duplicated out of `sdk-query-options-builder.ts`. That
 * inference was only ever valid because one caller existed and its
 * `settingSources` rule was known here. It is not a property of the provider —
 * it is a property of the SESSION's `settingSources`, which the caller owns:
 * `SdkQueryOptionsBuilder` drops `'user'` on a local proxy, while
 * `PtahCliRegistry` hardcodes all three sources for every spawn. A caller that
 * always keeps the user tier and got the inferred answer would take the inject
 * branch and apply the style TWICE — once from the file the binary reads, once
 * from the appended body.
 *
 * So the caller states the fact. Callers that derive it from a base URL use
 * `includesUserSettingSource` (shared) — the same function the builder uses to
 * BUILD `settingSources`, which is what makes the two impossible to separate.
 */
import { injectable } from 'tsyringe';
import type {
  ActivationDecision,
  OutputStyleEntry,
} from '@ptah-extension/shared';

export interface ResolveActivationInput {
  /** The already name-resolved winner from discovery, or `null` for "no style". */
  readonly style: OutputStyleEntry | null;
  /**
   * Whether this session's `Options.settingSources` includes `'user'` — the
   * ONE axis on which a style file can be invisible to the binary.
   */
  readonly userSettingSourceIncluded: boolean;
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
    // user tier is the ONLY one HU can drop
    input.userSettingSourceIncluded;

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
