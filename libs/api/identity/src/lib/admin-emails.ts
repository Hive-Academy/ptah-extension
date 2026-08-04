import type { ConfigService } from '@nestjs/config';

/**
 * THE definition of "is this address an admin", in one place.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * `ADMIN_EMAILS` was parsed independently in FIVE places (`AdminGuard`,
 * `MemberGuard`, `MemberEntitlementController`, `AdminService`, and the forum
 * SSO controller that TASK_2026_177 P1b later deleted, leaving four). Every
 * copy re-implemented split/trim/lowercase,
 * and they had ALREADY drifted: two of them trimmed the incoming email before
 * comparing and three did not, so ` admin@x.com ` was an admin on some surfaces
 * and not on others. Five copies of an authorization predicate is five chances
 * for the definition of "admin" to diverge silently.
 *
 * ── WHAT THIS FILE DOES *NOT* DO: FLATTEN THE FAILURE POLICY ───────────────
 * The call sites are NOT interchangeable, and collapsing them into one
 * boolean would be the wrong fix. There are two distinct postures and both are
 * correct where they are:
 *
 *   AUTHORIZING (`AdminGuard`) — an unset allowlist must DENY, loudly. A guard
 *   that answers "nobody is an admin" and lets the request continue is exactly
 *   how a misconfigured deploy opens an admin surface.
 *
 *   INFORMATIONAL (everything else) — the flag decides whether a moderation
 *   affordance renders. It authorizes nothing,
 *   so an unset allowlist correctly means "nobody is flagged" and must NEVER
 *   throw. `member.guard.spec.ts` pins this: an unset `ADMIN_EMAILS` must not
 *   block a legitimate member.
 *
 * So the PARSE is shared and the POLICY is not. {@link isAdminEmail} answers
 * `false` for an unconfigured allowlist, and {@link isAdminAllowlistConfigured}
 * lets the one authorizing caller detect that case and fail closed itself —
 * which keeps the fail-closed decision visible at the guard that makes it,
 * rather than hidden behind a flag argument here.
 */

/**
 * The configured allowlist, normalized: split on `,`, trimmed, lower-cased,
 * empties dropped. `[]` when `ADMIN_EMAILS` is unset, blank, or separators only
 * — all three are indistinguishable as *configuration* and are treated alike.
 *
 * Read through `ConfigService` and never `process.env`: in a deploy where
 * config comes from somewhere the process environment does not mirror, a direct
 * `process.env` read would keep returning the right answer in tests and in
 * local dev and the wrong one in production.
 */
export function parseAdminEmails(config: ConfigService): string[] {
  const raw = config.get<string>('ADMIN_EMAILS');
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when an allowlist is actually configured (at least one usable entry).
 *
 * For the AUTHORIZING caller only. `AdminGuard` uses this to fail closed on a
 * missing allowlist. Its only other caller — a forum SSO controller that
 * emitted an operator breadcrumb before degrading every admin to a regular
 * user — was deleted by TASK_2026_177 P1b. Nothing
 * else should need it — an informational flag has no business distinguishing
 * "not configured" from "not listed", because both mean "do not show the
 * badge".
 */
export function isAdminAllowlistConfigured(config: ConfigService): boolean {
  return parseAdminEmails(config).length > 0;
}

/**
 * Case-insensitive, whitespace-tolerant membership test of `email` against
 * `ADMIN_EMAILS`.
 *
 * `false` for an absent/blank email and for an unconfigured allowlist — this
 * function never throws, so an informational caller can use it directly and an
 * authorizing one composes it with {@link isAdminAllowlistConfigured}.
 */
export function isAdminEmail(
  config: ConfigService,
  email: string | null | undefined,
): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  return parseAdminEmails(config).includes(normalized);
}
