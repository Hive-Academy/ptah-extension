## Files changed

- `libs/backend/worker-runtime/src/lib/paths.ts` and adjacent spec: injectable worker paths and private directory.
- `workspace-registry.ts` and spec: realpath-derived IDs, persisted registry, snapshot list.
- `token-store.ts` and spec: private atomic token file, typed permission error, issuance, lookup and revocation.
- `pairing-window.ts` and spec: salted in-memory code hash, snapshot grants, expiry, failure limit and uniform delayed rejections.
- `admin-key.ts` and spec: fresh private key material on each start.
- `redact.ts` and spec: log record and free-text redaction.
- `src/index.ts`: public exports.
- This report.

## Decisions

- Per-connection backoff and close 4429 remain in the connection layer in Batch 18. Options: add a pure helper here or handle state in the connection layer. Evidence: W3 makes the limit per connection, while this batch owns the global pairing window and Batch 18 owns `connection.ts`. Reversible: yes.
- Reused the protocol library's code encoder, normalizer, TTL bounds, grant type and fixed pairing rejection message. Options: duplicate or import. Evidence: `libs/worker-protocol/src/lib/pairing-code.ts` and `errors.ts` already define the wire contract. Reversible: yes.

## Spec coverage

- Identical pairing rejections and 250 ms minimum delay: `pairing-window.spec.ts`, “returns identical delayed rejections for wrong, expired, used and absent windows”.
- Window expiry and five-failure close: `pairing-window.spec.ts`, “expires and closes after five failed exchanges”.
- Grant snapshot fixed at open and both input forms: `pairing-window.spec.ts`, “uses eight Crockford characters, accepts display and bare forms, and snapshots grants”.
- Code format: same pairing spec; protocol's existing `pairing-code.spec.ts` covers 40-bit encoding and alphabet.
- Token permission refusal and private atomic write: `token-store.spec.ts`, “refuses group or world readable files and writes private tokens atomically”.
- Workspace ID format and persistence: `workspace-registry.spec.ts`, “derives the ID from the real path and persists it”.
- Redaction: `redact.spec.ts`, “masks token secrets, pairing codes and admin keys”.
- Admin key material: `admin-key.spec.ts`, “creates fresh private 32-byte material on each start”.
- Scoped `ptah_get_diagnostics` after edits: zero errors; Jest and Nx verification deferred to orchestrator by instruction.

## Not done / Clarifications Needed

- Per-connection backoff and socket closure await Batch 18's connection layer.
- No test runner was invoked under this lane's verification rules. Skill discovery yielded no listed matching skill for this backend-only task.
