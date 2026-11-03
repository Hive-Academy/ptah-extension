/**
 * Deny window for UNROUTABLE permission requests only — those with no valid
 * UUID session/tab surface to render the prompt (the broadcast-fallback case,
 * e.g. gateway `gw-<id>` tabs). Routable webview requests keep an infinite wait
 * so a user can legitimately take minutes to answer. See F2 in TASK_2026_155.
 */
export const UNROUTABLE_PERMISSION_TIMEOUT_MS = 60_000;

/**
 * Model-facing text for a denial Ptah manufactured. Callers send it with
 * `interrupt: false` so the CLI does not replace it with a canned user refusal.
 * A system abort is not a human decision (TASK_2026_247).
 */
export function buildSystemAbortPermissionMessage(
  toolName: string,
  internalReason: string,
): string {
  return `SYSTEM ABORT — this was NOT a user decision. Ptah cancelled the pending permission request for tool "${toolName}" because the session was being torn down (for example an authentication or configuration change) or the prompt could not be routed to any UI surface before its deny window expired. No human ever saw this prompt, and nobody reviewed or refused the tool call. Do NOT treat this as a user denial and do NOT abandon the work you were asked to do. The operation may be retried once the session is available again. Internal reason: "${internalReason}".`;
}
