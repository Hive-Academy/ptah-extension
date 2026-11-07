## Verdict

**REVISE — 5/10.** Three of five Phase B/C findings are resolved. Grade classification and pre-fingerprint failure handling remain partial. New defects affect quoted-secret redaction and ordering of a delayed setup failure. Inspection only; no tests or Nx commands were run.

## Finding status

1. **Phase A #1 — PARTIAL.** The event now redacts before pushing `stats.error` (`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:501-517`); raw text is logged at :503-507. Quoted values with whitespace are incompletely redacted (new finding 1).
2. **Phase B/C #1 — RESOLVED.** `upsertRow` reports write failure (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:1294-1305`). Settlement sends `INDEXING_COMPLETE` only when persistence succeeds, otherwise one `INDEXING_FAILED` for a successful run (:867-906).
3. **Phase B/C #2 — RESOLVED for the cited overlap.** Open order is assigned at `indexing-control.service.ts:751-760`; an older manual run cannot replace the newer persisted background run (:922-936). The test checks the final `lastRun` and single stored write (`indexing-control.service.spec.ts:1324-1337`). See new findings 2–3 for other ordering cases.
4. **Phase B/C #3 — PARTIAL.** `isDocumentReview` excludes documents only from the unattributed branch (`libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts:210-214`). A document review with matching `runId` or unique `sessionId` can still become a grade at :227-235, although task reconciliation excludes every document review (`spec-extractor.ts:173-179`).
5. **Phase B/C #4 — RESOLVED.** The progress handler checks `liveCensuses` before emitting (`indexing-control.service.ts:765-781`); final release removes the record first (:808-816). The test invokes a late callback (`indexing-control.service.spec.ts:1536-1554`).
6. **Phase B/C #5 — PARTIAL.** Failed SHA derivation after fingerprinting records failed `lastRun` and pushes failed once (`indexing-control.service.ts:628-645,686-712`). Fingerprint derivation failure still only logs and rethrows (:632-640), without fixed UI status or push; the test asserts that gap (`indexing-control.service.spec.ts:1588-1606`).

## New findings

1. **Serious — quoted credentials with spaces leak.** `libs/backend/memory-curator/src/lib/triggers/redact-secrets.ts:49-55` matches only the first non-whitespace token. For `{"password":"alpha beta"}`, `beta` remains in the UI snippet when within its first 140 characters (`memory-trigger.service.ts:514-517`). Match quoted values through their closing quote, handle unquoted values separately, and test a sentinel containing whitespace.
2. **Serious — delayed background setup failure can overwrite a newer census.** Both derivations start at `indexing-control.service.ts:628-631`, but a rejected SHA receives its sequence only when handled at :643 and :695. If derivation is delayed while a later census opens and settles (:751-760, :867), the older setup attempt receives a larger sequence and replaces the newer success (:922-936). Reserve sequence and start time when the attempt starts; pass both to the failure recorder and test this interleaving.
3. **Moderate — wall-clock rollback can drop a legitimate newer census.** `indexing-control.service.ts:922-931` skips when the stored `startedAt` is greater, even if this instance's sequence says the current census opened later. A clock correction can hide the current result while returning success and sending a completion push (:875-886). Prioritize same-instance sequence over wall-clock time; use a durable ordering token or explicit cross-instance conflict rule for persisted rows.

## Decisions

- Settlement calls `persistLastRun` once at `indexing-control.service.ts:867`; branches send at most one terminal push (:875-906). A stale skip writes zero times. Pause chooses no settlement result and writes no `lastRun` (:827-843). Registry deletion remains identity checked (:808-816).
- The event producer limits regex input to 4096 characters (`memory-trigger.service.ts:65-67,514-517`). The patterns at `redact-secrets.ts:35-73` show no apparent catastrophic nested backtracking on that bounded path. The 32-character mixed-case base64 rule at :70-74 can hide ordinary long identifiers and path components; narrow it if preserving those errors matters.
- The implementer reports scoped lint/typecheck passed, skill-synthesis tests passed, and a memory-curator timing failure passed on retry. I did not independently rerun them.
