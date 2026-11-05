# Batch 13.9 code logic review

Verdict: REVISE
Score: 5/10
Review family: codex (implementer: claude)

## Prior findings

| Finding | Judgment | Evidence |
| --- | --- | --- |
| N1: early release before SDK `init` | Partly fixed | `chat-session.service.ts:1928,2159-2160,2362` now settles successful attempts; `session-driver-lock-coordinator.ts:192-205` retains an unbound record's provisional owner. The same-tab and stale-removal paths below can still release that owner before binding. |
| N2: dummy required injection | Fixed | `chat-session.service.ts:426-427` requires `driverLock` without `undefined!`; the optional preceding constructor parameters have explicit defaults. |
| N3: duplicate liveness check | Duplicate removed, safety regressed | `control-endpoint.ts:187-191` checks once, then releases. The rewritten spec at `control-endpoint.spec.ts:44-53` checks only the already-live case and loses the false-then-true race assertion. |

## New defects

1. **Serious — a second attempt on one tab can release the first live SDK query's lock.** `session-driver-lock-coordinator.ts:166-181,192-205`; `chat-session.service.ts:1900-1902,1927-1929`. After attempt A returns before `init`, `settleDrive` parks its provisional owner. Attempt B on the same tab and session runs `beginDrive`, which deletes the parked marker but reuses the same single `provisional = tabId`. If B fails before replacing the record, its `catch` calls `abandonDrive` and clears that shared provisional owner. A's unbound record and query remain live, but `releaseEmpty` frees the kernel lock; A's later `init` cannot restore continuous exclusivity. A later `settleDrive` is a no-op. **Fix:** track provisional ownership by attempt/record token or a lease count, and make each attempt abandon only its own lease. Keep the kernel lock until the live record is admitted or removed. Test overlapping attempts with B failing before A binds.

2. **Serious — removal of a displaced record can clear a replacement's provisional owner.** `session-driver-lock-coordinator.ts:327-333`; `session-registry.service.ts:364-365,871-902`. Registering a replacement on the same tab notifies removal for the old record before storing the new one. The callback is asynchronous; `removed` iterates every owner and abandons any provisional with that tab ID, without checking the removed record's token or generation. A concurrent `beginDrive` for the replacement can therefore acquire and park a provisional owner that the old record's removal callback later releases, leaving the replacement unbound SDK query without its kernel lock. **Fix:** associate provisional ownership with the record token or generation, and have removal clear only the matching owner; serialize replacement/admission against removal. Add a displacement test that holds the removal callback until the new attempt has begun.

3. **Serious — operator release can pass a stale liveness check.** `control-endpoint.ts:181-192`; `control-endpoint.spec.ts:44-53`. `hasLiveRecord` is awaited. If it reports false and a record becomes live before `source.release`, the endpoint releases its kernel lock despite the live owner. The previous false-then-true test made this interleaving observable; the replacement test only covers a true first check. Two adjacent checks did not close every check-to-release window, but deleting one restores the specific between-check race and weakens the guard. **Fix:** make liveness validation and release one serialized coordinator operation, or use a nonce/generation checked at release time. Restore a test where ownership becomes live between observation and close.

## Five logic questions

1. **Silent failure:** findings 1-3 can release a kernel name while an SDK query remains live; the RPC can still report activation or enqueue success (`chat-session.service.ts:1899,2111`).
2. **User action:** retry or activate the same tab while an earlier resume awaits SDK `init`; restart a tab that displaces an old record; request operator release during binding.
3. **Input data:** the same `tabId` and session ID across attempts, or an old record removal event carrying the same tab ID as a new record, produces the wrong ownership decision.
4. **Dependency failure/timeout/shape:** failed B attempts trigger `abandonDrive` against A's shared provisional. A query that never emits `init` remains locked while its record exists and is released on record removal; if neither bind nor removal arrives, the owner persists with the record. Lock acquisition failures still refuse the turn in `ensure` (`session-driver-lock-coordinator.ts:126-143`).
5. **Missing requirement:** the plan's one provisional entry per session (`implementation-plan.md:703-710`) does not define overlapping attempts or stale record-removal generations. Those need an explicit ownership identity to uphold continuous exclusivity.

## Decisions and verification

- **Decision:** REVISE. The normal return-before-`init` sequence is protected, but three concurrent sequences can still release a live driver's lock. This separates 5/10 from a sound 7/10; the core lock guarantee remains unproven, while the usual path and required injection are corrected, so the foundation is not wholly wrong. Reversible by changing ownership accounting and release serialization.
- Reviewed the specified nine-file diff, coordinator and control endpoint flows, registry displacement, and the W10 ownership contract. No tests or builds run, as requested. Implementer-reported verification was 19/19 across platform-core, rpc-handlers, ptah-electron, mcp-bench and degradation-audit; those passing checks do not cover the interleavings above. Scoped `ptah_get_diagnostics` was attempted twice and reported TypeScript checking still running, with all three source files unchecked. Skill catalogue/loading tool was unavailable in this lane.
