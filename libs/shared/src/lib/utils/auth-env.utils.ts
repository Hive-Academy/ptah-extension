import type { AuthEnv } from '../types/auth-env.types';

export function isDirectAnthropic(authEnv: AuthEnv): boolean {
  const baseUrl = authEnv.ANTHROPIC_BASE_URL?.trim();
  return !baseUrl || /^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl);
}

/**
 * Base URLs Ptah treats as a local translation proxy. Sessions on these drop
 * the `'user'` tier from `Options.settingSources`, because the user's own
 * `~/.claude/settings.json` describes a different provider than the proxy the
 * session is actually talking to.
 */
const LOCALHOST_BASE_URL_RE = /^https?:\/\/(127\.0\.0\.1|localhost)/i;

/**
 * Whether a session on `baseUrl` will include `'user'` in its
 * `Options.settingSources`.
 *
 * This lives in `shared` because two libs that must never disagree both need
 * the answer and neither may import the other:
 *
 *  - `agent-sdk`'s `SdkQueryOptionsBuilder` USES it to build `settingSources`.
 *  - `output-styles` USES it to predict whether a user-tier style FILE will be
 *    visible to the binary, which is the whole flag-vs-inject decision.
 *
 * It was previously a regex literal duplicated across both, held together by a
 * spec that read the builder's source text and compared the two patterns. One
 * function means there is nothing left to drift, so that guard is gone.
 *
 * An absent or blank base URL is first-party Anthropic — not a local proxy —
 * so the user tier is included.
 */
export function includesUserSettingSource(
  baseUrl: string | undefined,
): boolean {
  return !LOCALHOST_BASE_URL_RE.test(baseUrl?.trim() ?? '');
}
