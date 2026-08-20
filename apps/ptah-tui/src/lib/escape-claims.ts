/**
 * Which surface owns the next Escape press.
 *
 * `escape-target.ts` answers "given the shell's layout, what does Escape close
 * next" — and it is correct. The defect this module fixes is one level up: a
 * surface can hold transient state that Escape should cancel *without* being a
 * modal or an overlay. The sidebar's delete confirmation and the settings
 * auth-provider configurator are both like that. Each binds its own Escape,
 * and the AppShell handler is gated only on `!modalActive && !overlayActive`,
 * so neither suppressed it: Ctrl+E → `d` → Esc cancelled the delete confirm
 * *and* closed the sidebar, two surfaces for one press.
 *
 * A surface claims Escape while its transient state is open and releases it on
 * the way out. The shell handles Escape only when nothing holds a claim.
 *
 * Keyed by id rather than counted so that a double mount, a re-render that
 * re-runs the effect, or a release that never had a matching claim all settle
 * to the same state. A bare counter drifts, and it drifts *upward* — which is
 * the failure that disables Escape for the whole session.
 *
 * Ink-free and immutable on purpose so it is unit-testable.
 */

export type EscapeClaims = readonly string[];

export const NO_ESCAPE_CLAIMS: EscapeClaims = [];

/** Idempotent: claiming an id already held returns the same array. */
export function addEscapeClaim(claims: EscapeClaims, id: string): EscapeClaims {
  if (claims.includes(id)) return claims;
  return [...claims, id];
}

/** Idempotent: releasing an id not held returns the same array. */
export function removeEscapeClaim(
  claims: EscapeClaims,
  id: string,
): EscapeClaims {
  if (!claims.includes(id)) return claims;
  return claims.filter((claim) => claim !== id);
}

/**
 * True when some surface has claimed Escape, so the AppShell handler must not
 * also act on this press.
 */
export function isEscapeClaimed(claims: EscapeClaims): boolean {
  return claims.length > 0;
}
