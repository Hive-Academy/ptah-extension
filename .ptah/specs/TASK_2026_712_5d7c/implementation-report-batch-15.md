# Batch 15 implementation report

Implemented the six owned files. No task state, unrelated source, registrations, or persisted output-style files were changed. No git commands were run (the backend role prohibits git, including the requested commit-stat inspection); Batch 14 contracts were verified directly in source.

## Files changed

- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts`
- `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/plan-usage-reader.types.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader.ts`
- `libs/backend/auth-providers/src/lib/quota/provider-owner.accounts.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/plan-usage.accounts.spec.ts`

## Acceptance evidence

- Known owner is the existing SHA-256 fingerprint of trimmed email plus organization; no config directory enters that identity. Changed email or organization separates owners. `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:121`.
- Named owner discovery reads accountInfo through the Batch 14 named overload. Failed or missing identity stays route/revision/epoch/run/session-specific; there is no last-known promotion. `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:640`.
- The optional backend-only claudeRoute and sessionHandle select the certified source. Existing callers remain optional; public snapshots explicitly select public fields and do not copy routes, directories, email or organization. `libs/backend/auth-providers/src/lib/quota/readers/plan-usage-reader.types.ts:51`.
- Named reads require a session, verify its owner before and after usage, and use the named probe for all calls. Missing query returns no-open-session; mismatch/stale epoch/unknown proof cannot use owner-cache fallback. Probe query/epoch validation remains the Batch 14 boundary. `libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader.ts:172`.
- Settled windows stay keyed by owner. Named calls revalidate their live source rather than returning an unvalidated TTL hit; in-flight work is separated by source, revision, epoch, run and session. Same-owner transient failures after successful proof may return stale windows. `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:194`.
- Failed source proof bypasses cache reads, writes, and new ledger evidence. Historical ledger evidence retains its original owner attribution. `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:378`.
- Disposal aborts pending work and clears flights/cache/failure metadata; a late available response is rejected before settlement. Capacity is checked again when flights release; failure timestamps are retained only for cached owners. `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:208`.
- No-context ambient selection and TTL behavior are retained; Codex owner behavior and its reader are unchanged. `libs/backend/auth-providers/src/lib/quota/readers/claude-plan-usage.reader.ts:217`.
- Specs cover trimmed identity, same identity in two directories, changed email/org, route/run-specific failed discovery, and public identity redaction. `libs/backend/auth-providers/src/lib/quota/provider-owner.accounts.spec.ts:44`.
- Specs cover same-owner stale across directories, stale epoch/source mismatch/no-open-query, late changed identity, independent source flights, unknown owners, ambient caching, disposal and concurrent cache capacity. `libs/backend/auth-providers/src/lib/quota/plan-usage.accounts.spec.ts:65`.

## Diagnostics result

Final `ptah_get_diagnostics` scoped to all six changed files: **zero diagnostics in requested files**, clean coverage, zero warnings. The owning project still reports eight errors in two out-of-scope existing specs whose ambient-only mocks do not satisfy the Batch 14 overloaded SessionQuotaProbe contract:

- `libs/backend/auth-providers/src/lib/quota/plan-limit-ledger.service.spec.ts`: lines 87, 88, 97.
- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.spec.ts`: lines 68, 69, 98, 640, 641.

Those files require updated overloaded probe mocks by their owner; they were not modified. The reader's narrower adapter surface accepts existing ambient-only adapters as well as the full probe. No Nx, Jest, tsc, lint, builds, package, sign-in, credential changes, SDK calls or paid inference were run. New specs mock the provider surfaces; CI must execute them. Formatting used the installed Prettier API only.

## Decisions

- Keep known owner hashing unchanged and expose its Claude-specific helper for source verification. Options: duplicate hash logic or reuse the resolver's identity function. Evidence: existing ownerForClaudeAccount and plan lines 209?210 prescribe email+organization independent of directory. Reversible additive helper.
- Carry optional `claudeRoute` alongside the existing `sessionHandle`; named reads require an explicit session. Options: infer a recent query or fail unavailable without a source handle. Evidence: plan requires that query; Batch 14 readAccount requires a session, and bindAccountRoute refuses rebinding. Missing session fails closed. Reversible optional API, with discovery wiring left to its assigned batch.
- Revalidate named sources for every read, sharing settled cache only after identity proof; split active flights by route/epoch/run/session. Options: serve an owner TTL hit without checking the source, or perform bounded SDK control reads. Evidence: changed owner/epoch and no-open-query acceptance forbid unchecked TTL hits. Reversible; adds bounded control reads, no polling or inference.
- Source-proof failures are internal noncacheable readings; transient usage failures with successful identity proof retain same-owner stale behavior. Public assembly never spreads the internal carrier. Reversible internal metadata.
- Preserve existing ambient and Codex paths. No account-resource fallback accesses disk, ambient credentials, or unrelated query for named reads. No persisted style writes fall within the six-file scope or were touched.

## Not done / integration follow-up

- CI execution is pending by instruction; this report does not claim tests passed.
- Eight sibling-spec diagnostics remain outside ownership, as listed above.
- Discovery/launch callers must pass the optional certified route and matching session handle; Batch 17 populates the immutable session binding (D17). This batch provides the requested backend seam only.
- Disposal is exposed on PlanUsageService; composition-root wiring is outside ownership. No new timers/listeners were added.
- Batch 12?15 phase logic/style reviews remain with the invoking workflow.
