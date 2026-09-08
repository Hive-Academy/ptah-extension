// Planted fixture for the degradation-audit self-test (Revision 2, B-1/S-3
// Zone 3). The marker sits above the STATEMENT ("void" starts the statement
// on its own line), while the `.catch(...)` call's own leftmost token
// (`job`) is one line further down — the line directly above the CALL is
// code (`void`), not a comment, so only the statement-level zone finds it.

export function fireAndForgetWrapped(job: Promise<void>): void {
  // degradation-audit: optional-capability — background sync; failure is fine, retried next cycle
  void job.catch(() => undefined);
}
