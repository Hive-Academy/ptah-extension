# Code Logic Review — `TASK_2026_563_2939`, Batch 6

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 1        |
| Failure modes found | 0        |

The scoped restore contract, active-only get, and rejected-pin handling are implemented. No material logic defect was established. Actual SQLite isolation tests and explicit error handling place this above the 5–6 band; the remaining test gap and limited host/driver verification do not justify the exemplary 9–10 band.

Scope: the seven named Batch 6 files were read in full, including the shared registry and both specs. Production changes were compared with the uncommitted HEAD diff. MemoryStore was inspected only as dependency context, not re-reviewed as Batch 6. Inputs included context.md, implementation-plan.md component 8 and its r1 corrections, task-description.md M5 criteria 5–7, batches.md Batch 6, and Batch 3 logic finding 1. No Batch 6 style review existed when checked. No applicable AGENTS.md or CLAUDE.md was found in the reviewed files' ancestor directories within the worktree.

All references below are relative to `D:\projects\ptah-extension-memory-quality-source`. Abbreviations: **H** = `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`; **HS** = the adjacent `memory-rpc.handlers.spec.ts`; **S** = the adjacent `memory-rpc.schema.ts`; **SS** = the adjacent `memory-rpc.schema.spec.ts`; **Store** = `libs/backend/memory-curator/src/lib/memory.store.ts`; **Registry** = `libs/shared/src/lib/types/rpc.types.ts`.

Verification: the authorized `npx nx test @ptah-extension/rpc-handlers --testPathPatterns='"memory-rpc"'` completed with **2 suites passed, 129 tests passed, 0 snapshots**, Jest time 19.219 seconds. Nx reported target success; it also reported an unrelated disabled Nx Cloud organization (401). PowerShell displayed native stderr warnings about the deprecated Jest executor and module loading. No rerun was performed. `ptah_get_diagnostics` returned **Unavailable: None of the requested files are inside the workspace root**. No diagnostics pass is claimed. The VS Code surface test, full lint/typecheck, and a second SQLite driver run were not executed in this review. The real-store tests use disposable `:memory:` databases (HS:1756,1763); no existing database was opened or modified. Source was not edited.

## Five logic questions

### 1. How does this fail silently?

The prior false-success pin defect is closed: H:281 and H:297 branch on the store's affected-row boolean and return `{ success: false, pinned: false }`. Store:565 returns false for zero affected rows. The envelope precedent is real: the unchanged missing-parameter and exception paths at H:277,287,295,303 already return it. This is an operation-failure envelope, not a claim that the stored pinned value became false. A quarantined pinned row stays pinned.

No new silent-success failure was found. List/restore SQL errors throw `PERSISTENCE_UNAVAILABLE` (H:807,864), rather than returning an empty list or zero count. The existing best-effort use-recording behavior remains explicit at H:259.

### 2. What user action produces unexpected behaviour?

No unexpected action was established under the approved contract. Omitting restore workspaceRoot is rejected before the store call (S:138; H:828). Explicit null is accepted even with no folder open (HS:1587), while a named unauthorized workspace is rejected (H:843; HS:1559). An all-scope listing is deliberately broader than restore, and each item carries its original root for routing (H:781,792).

### 3. What input data produces a wrong answer?

None established for the new inputs. Exactly one defined selector is required (S:147); empty IDs, over-500 arrays, false `all`, invalid reason syntax and empty roots fail validation (SS:162,180,196,204,212,220). Duplicates do not inflate the restore count because Store:922 deduplicates and Store:948 returns actual changes. NULL and named rows remain distinct because Store:944 always includes `workspace_root IS @ws`.

### 4. What happens when a dependency fails?

Validation maps to `INVALID_PARAMS` (H:774,833), named authorization failure to `UNAUTHORIZED_WORKSPACE` (H:846), and synchronous store failures to sanitized client messages with `PERSISTENCE_UNAVAILABLE` (H:802,859; HS:1604,1722). A malformed list page that throws during mapping is caught by the same boundary. Store restore uses a transaction and rethrows write errors (Store:947,954), so the RPC does not manufacture success.

The added handlers do not log row objects, excerpts, content, or selected IDs. Null restore logs only `{ scope: 'unscoped' }` (H:840). Error paths do log raw exception strings (H:772,805,831,862), following neighboring handlers; this inspection is not a guarantee that arbitrary future dependency error text is redacted. The present bound SQL statements do not interpolate memory content (Store:874,941). No remote dependency, timer, listener, or fire-and-forget operation was added.

### 5. What is missing that the requirements never mentioned?

There is no separate operator identity or admin gate: any caller already able to invoke the memory RPC surface can explicitly restore NULL-scope rows. The CLI generic `rpc.call` forwards the method and params (apps/ptah-cli/src/cli/commands/interact.ts:539,556), and the manifest requires only the host's memory capability (libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:308). This is the approved policy, explicitly specified at implementation-plan.md:808–816, not an authorization regression hidden by null coalescing.

The `purgeJunk` precedent is therefore followed for named scopes and intentionally differs for null: H:491 explains that code-symbol rows have no NULL workspace, whereas restore has legitimate NULL-memory targets and cannot become an all-workspace mutation (Store:944). A future operator-only trust model would require a separate contract; it is not implied by the current plan. Finding 1 records the remaining symmetric pin test gap.

## Failure modes

No runtime failure mode was established in this batch. Examined paths include required/null/omitted roots, unauthorized named roots, all/workspace read scope, selector exclusion and limits, get suppression, mutation rejection, store exceptions, and registration. Real-store assertions at HS:1907 and HS:1927 prove NULL-to-named and named-to-NULL isolation; HS:1984 proves get visibility changes after restore. Residual uncertainty: no full host boot, VS Code partition execution, cross-process race exercise, full-project static checks, or second-driver verification. Store concurrency and cache mechanics remain Batch 3 ownership.

## Blocking issues

None established.

## Serious issues

None established.

## Moderate and minor issues

### Finding 1 — Real-store unpin coverage omits a quarantined pinned row — Minor

- File: `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.spec.ts:2005`.
- Scenario: `memory:unpin` targets a quarantined row whose persisted `pinned` value is already true.
- Evidence: the real-store test pins an unpinned quarantined row but unpins only a nonexistent ID (HS:2009–2010); seedMemory always seeds pinned=0 (HS:1837). The mock suite covers false return for both methods (HS:1889), so this is a test-coverage suggestion, not a demonstrated runtime defect.
- Impact: that asymmetric database-state case is not protected end to end against future caller/store drift.
- Recommendation: seed an already-pinned quarantined row, call unpin, assert the failure envelope and persisted pinned=1, then restore and verify the original pin state remains. Current H:297 and Store:562 correctly preserve it by inspection.

## Data flow

1. **OK — discoverability:** shared barrel re-exports memory types (Registry:21); imports, method map and runtime entries include both new methods (Registry:389,1731,3732). H:133 lists both in METHODS, and the manifest consumes that list with `requires: ['memory']` (manifest.ts:310). `register-rpc-surface.ts:185` invokes the enabled library handler's register method.
2. **OK — host partition:** `deriveRpcSurface` expands and sorts each manifest entry's methods (register-rpc-surface.ts:58). VS Code expected-absent includes both additions (apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:96,101), and its partition assertions remain present (:189,193). Runtime execution of that spec is outstanding here.
3. **OK — list:** S:123 validates scope, reason and pagination; H:781 resolves read scope, preserving null and defaulting omitted root to current root or null (H:197); Store:857 applies its predicate only when root is not undefined. H:790 maps rows with their own roots. Excerpts are limited in SQL (Store:875).
4. **OK — restore:** S:138 requires string-or-null and S:147 enforces exactly one selector. H:839 preserves null and logs the unscoped target; H:844 authorizes strings. H:851 constructs one selector and forwards the exact root. Store:941 clears only quarantine fields in one exact scope, returning actual affected count.
5. **OK — get:** H:256 calls the SQL-filtered active lookup (Store:355), then returns before getChunks and recordUse if missing. There is no awaited gap inside this synchronous lookup/chunk sequence and no includeQuarantined bypass.
6. **OK — pin/unpin:** Store:562 excludes quarantined rows; H:281,297 use the returned boolean. The unchanged failure envelope no longer reports a rejected mutation as successful.
7. **OK — error exit:** list and restore catches preserve a failure signal with fixed client messages (H:807,864). No new resource needs disposal; test database handles close after each real-store test (HS:1903).

## Requirements fulfilment

| Requirement                                                                            | Status   | Gap                                                                                                           |
| -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| Component 8 shared types, methods and registration                                     | COMPLETE | Types and runtime entries agree; host execution verification remains separate                                 |
| Required restore root; null distinct from omitted; one selector; 500 cap; reason regex | COMPLETE | S:115–152; SS:125–231                                                                                         |
| Named authorization and deliberate explicit-null policy                                | COMPLETE | H:838–849; exact-scope SQL at Store:944                                                                       |
| List via resolveReadScope and root per row                                             | COMPLETE | H:781,792; HS:1944                                                                                            |
| M5 criterion 5, Batch 6 get exclusion/no use                                           | COMPLETE | H:256–260; HS:420,1984                                                                                        |
| M5 criteria 6–7, reachable scoped restore with no destructive RPC work                 | COMPLETE | H:858 delegates to Store:941; overall search/merge round-trip and corpus proof belong to other batches        |
| Batch 3 finding 1, truthful pin/unpin result                                           | COMPLETE | H:281,297; one optional real-store case remains, finding 1                                                    |
| Error codes and no row-content logging                                                 | COMPLETE | H:774,807,833,846,864; logging limitations explained above                                                    |
| Full Batch 6 verification gate                                                         | PARTIAL  | Targeted tests passed; diagnostics unavailable; full static checks and VS Code surface run not performed here |

Implicit requirements not addressed: no additional implementation requirement established. An operator-only permission model is outside the explicitly approved authorization policy.

## Edge cases

| Case                                         | Handled | How                                                            | Concern                                 |
| -------------------------------------------- | ------- | -------------------------------------------------------------- | --------------------------------------- |
| Missing/undefined/null restore root          | YES     | Missing/undefined invalid; null binds exactly NULL             | S:138; Store:944                        |
| Unauthorized named root/no folders           | YES     | Shared helper rejects unowned strings                          | workspace-authorization.ts:17–21; H:844 |
| Zero/two/three selectors, all=false          | YES     | Literal true plus exactly-one refinement                       | S:145–150                               |
| Empty/duplicate/501 IDs                      | YES     | Reject empty/over-cap; store deduplicates                      | S:141; Store:922                        |
| Invalid reason or pagination                 | YES     | Regex and bounded integer fields                               | S:115,127                               |
| All-scope listing/default no-folder listing  | YES     | Only scope=all produces undefined; otherwise null/current root | H:197–199                               |
| Repeated restore/active or foreign-scope IDs | YES     | Active predicate and exact root; actual count                  | Store:943–948                           |
| Quarantined get                              | YES     | Returns null/empty before chunks and usage                     | H:256–258                               |
| Quarantined pin/unpin                        | YES     | False affected-row result becomes failure envelope             | H:281,297; finding 1 is coverage only   |
| SQL failure                                  | YES     | Transaction error propagated and RPC error mapped              | Store:954; H:864                        |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the scoped handler behavior; MEDIUM for complete host/runtime integration pending broader verification.
- Top risk: the remaining verification limits should not be mistaken for a full Batch 6 host/driver/static-check gate pass.
- What a robust implementation would add: the symmetric real-store quarantined-unpin regression in finding 1, followed by the already-planned host partition and scoped static checks. No source correction is required by this review.
