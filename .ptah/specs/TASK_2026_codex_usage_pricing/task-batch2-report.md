# Usage batch 2 — Durable owner

## Summary

Added a host-neutral native Codex usage owner and a versioned checkpoint in session metadata. The history reader uses the checkpoint for native Codex stats after reload. Claude history remains on its existing path. No live turn wiring was added.

## Files changed

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-session-usage-owner.ts` — owner, normalized checkpoint, restore validation, stats snapshot.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-session-usage-owner.spec.ts` — child, compaction, failure, interruption, reset, stale, late-terminal and corrupt-restore cases.
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` and `.spec.ts` — atomic native checkpoint write with identity/sidebar tokens; reload and ordinary-save preservation.
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` and `.spec.ts` — native checkpoint snapshot on history read, Claude regression case.
- This report is the required deliverable outside the six code files.

## Owner algorithm

`CodexSessionUsageOwner` owns absolute current-epoch counters and lifetime accrued counters per native thread. Accepted monotonic evidence contributes only positive per-class deltas. A proved reset starts a new epoch and retains prior accrual. Decreases without a reset leave the safe total intact and mark coverage partial. Repeated/stale evidence is ignored. A later accepted update for a failed or interrupted turn replaces the older turn checkpoint. Child threads accrue separately, and compaction does not clear accrual. Reasoning is inside output, never added again.

## Persisted format and version

`codexUsageCheckpoint` is optional on legacy metadata and now has `version: 2`, Ptah session ID, explicit native root thread ID, revision, coverage, child inclusion state, separate child total, cache-semantics flag, nullable catalog source/version placeholders, safe aggregate counters, and normalized per-thread checkpoints (`threadId`, accepted `turnId`, epoch, timestamp, terminal state, current counters, accrued counters, optional parent/model). Zod validates restore; corrupt or unknown-version data produces an empty partial owner with a content-free diagnostic. History logs that diagnostic through the injected logger. The metadata writer validates both shape and aggregate before persisting. Sidebar input is uncached + cache read + cache creation; output is the native output class. Cost remains a numeric metadata placeholder of zero until pricing batch 3, while the history stats snapshot reports `totalCost: null` and `pricingCoverage: none`.

## Callers outside scope

Searched callers with `git grep -n` before editing exported surfaces. Existing signatures remain compatible (the history reader's new injected parameter is optional). Outside the six-file scope:

- `apps/ptah-electron/src/di/codex-binding.types.ts:45-46` references metadata writer method types.
- `libs/backend/agent-sdk/src/lib/wiring/codex-chat-metadata-port.ts:17`, `wiring/codex-thread-identity-store.ts:88,129`, `wiring/session-runtime-identity-cache.ts:124` call `updateCodexExecution`.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:68` calls `readSessionHistory`.
- `libs/backend/agent-sdk/src/lib/message-transform/artifact-parity.spec.ts:320` and `session-history-reader.events-read.spec.ts:91` call the history reader; their constructor call sites retain the required existing arguments.

## Decisions

- Kept persistence in the existing metadata detail record and history reader facade; no PR #881-only files were created.
- Persisted per-thread accrued counters as well as current epoch counters so reset history survives reload and the aggregate can be checked.
- Treated parent and child counters as separate native threads; an unattributed child marks coverage partial.
- Preserved `SessionMetadata.totalCost` as a number for existing callers; zero is only a placeholder, and the authoritative native stats snapshot leaves cost unavailable.
- Skill discovery found no matching local skill. Ptah workspace analysis, AST inspection and dependent lookup were used; `rg` was unavailable on this Windows shell, so text searches used `git grep`.

## Open risks

- Batch 4 must wire the owner to the live stream, restore before first evidence, and export the owner through the agent-sdk public index if hosts need to construct it. The six-file scope prevented that index edit.
- Native parent totals' inclusion of child usage is not yet verified by authorized live observation. The checkpoint defaults to `childInclusion: unverified`, keeps child totals separately, and marks coverage partial; batch 4 must confirm the inclusion rule before asserting `disjoint`.
- A missing legacy checkpoint cannot prove pre-resume usage. Batch 4 must start such resumed sessions with partial coverage unless verified history can backfill it.
- The sidebar's legacy numeric `totalCost` cannot express unknown pricing; batch 3 must add cost provenance and align its presentation with the history snapshot.
- Tests, typecheck, lint and diagnostics were not run because this batch forbids them. The new specs are unexecuted.
- The foreign `task-tracking/landing-live-demo/HANDOFF.md` change was left untouched.

## Degradation audit

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0. `libs/backend/agent-sdk` remained at 4 unsuppressed sites (baseline 4); total workspace findings were 279, within baselines. `git diff --check` found no whitespace errors. Edited files were checked for CR and BOM; all are LF without BOM.

## Revision 1

The independent batch 2 review identified twelve defects. The changes below are confined to the six batch 2 source files. `CodexSessionUsageOwner` retains only the latest checkpoint per native thread, so it has no per-turn map to prune (batch 1 N1).

| Defect | Fix and location | Spec |
| --- | --- | --- |
| 1. Root identity | Separate Ptah session and native root thread IDs in constructor, restore and checkpoint; root lookup uses the native ID (`codex-session-usage-owner.ts:29,78,81,175,219`). | `codex-session-usage-owner.spec.ts:25,75`; metadata/history specs use distinct IDs. |
| 2. Child inclusion | Persist `childInclusion` and `childTotal`; default unverified keeps child usage separate, marks coverage partial, and only sums children when disjoint is asserted (`codex-session-usage-owner.ts:32,111,179,202`). | `codex-session-usage-owner.spec.ts:25,75`. |
| 3. Monotonic writer | Compare revision, per-class totals, child totals, epochs and accrued counters inside the queued write; reject regression with a logged diagnostic (`session-metadata-store.ts:167,1244-1252`). | `session-metadata-store.spec.ts:2233`. |
| 4. Stale ordinary save | Keep the stored checkpoint and its sidebar totals when an ordinary save carries an older copy (`session-metadata-store.ts:1304-1361`). | `session-metadata-store.spec.ts:2233`. |
| 5. Terminal downgrade | Retain terminal state when a later same-turn usage event says `none` (`codex-session-usage-owner.ts:185`). | `codex-session-usage-owner.spec.ts:58`. |
| 6. Class conflict | Record distinct diagnostics for equal-total class conflict, inconsistent classes, and reasoning greater than output (`codex-session-usage-owner.ts:44,156-170`). | `codex-session-usage-owner.spec.ts:87`. |
| 7. Thread cap | Limit schema and owner to 256 threads; overflow leaves safe totals intact and marks coverage partial (`codex-session-usage-owner.ts:6,38,137`). | `codex-session-usage-owner.spec.ts:102`. |
| 8. History isolation/count | Catch metadata read failure without aborting history; use persisted native message count in stats (`session-history-reader.service.ts:382-411`). | `session-history-reader.service.spec.ts:431,459`. |
| 9. Rejected snapshot | Rejected checkpoint history snapshot uses stored sidebar totals with partial coverage (`session-history-reader.service.ts:390-401`). | `session-history-reader.service.spec.ts:470`. |
| 10. Price placeholders | Document nullable catalog fields as batch 3 provenance placeholders (`codex-session-usage-owner.ts:34,212`). | Existing owner serialization specs. |
| 11. Fallback reporting | Log invalid stored checkpoint in metadata paths and caught metadata read failure in history. The audit flags suppression markers on `safeParse` branches as orphaned, so those branches use ordinary comments and explicit logger warnings (`session-metadata-store.ts:1186-1189,1244-1247,1346-1349`; `session-history-reader.service.ts:406-410`). | `session-history-reader.service.spec.ts:459,470`; audit below. |
| 12. Restore integrity | Validate accrued counters against current counters, root presence, revision, and parent existence (`codex-session-usage-owner.ts:101-118`). | `codex-session-usage-owner.spec.ts:115`. |

### Revision checks and remaining risk

The permitted degradation audit exited successfully: `agent-sdk` 4 findings against baseline 4; total 279. All six source files have LF without CR or BOM, and `git diff --check` is clear. Ptah AST inspection parsed all six changed files. Tests, typecheck, lint, diagnostics, and builds were not run under the task rules, so the added specs remain unexecuted. Batch 4 must supply the actual native root thread identity when constructing/restoring the owner; the current runtime identity contract only exposes the Ptah session ID, and this batch's scope did not permit wiring that call site. The foreign `task-tracking/landing-live-demo/HANDOFF.md` change remains untouched.
