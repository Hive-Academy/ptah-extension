# Code Logic Review — `TASK_2026_540_0940`

## Batch 1 - outside review (codex)

Verdict: ACCEPT WITH FIXES

Score: 8/10

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Minor issues | 1 |
| Failure modes found | 1 test false-positive; 0 supported production defects |

The inspected implementation satisfies the binding Batch 1 state-transition design. One required regression assertion needs strengthening before Task 1.2 is fully evidenced. The score is in the sound-implementation band because the state funnel, ownership checks, bootstrap migration and real-Router tests support the design; it does not reach the exemplary band because the closed-slice test cannot distinguish the states it claims to distinguish, and baseline/integration verification has the limits below.

Paths below are relative to the worktree. `service` means `libs/frontend/core/src/lib/services/app-state.service.ts`; `spec` means `libs/frontend/core/src/lib/services/app-state.service.spec.ts`. Line numbers refer to the files read during this review.

### Scope and verification

- Read both Batch 1 files in full: service lines 1–1271 and spec lines 1–1611. Read `context.md`, `task-description.md`, the binding revision-3 overrides and Decision 1, Batch 1 and its plan-validation edge cases, implementer instructions 1–3, and `batch-1-report.md`. Did not read `batch-1-internal-review.md`. No existing `code-style-review.md` was present.
- Inspected the navigation dependency and test harness, plus the workspace coordinator/layout call sites. Routing changes belong to Batch 2 and receive no verdict here.
- The orchestrator and `batch-1-report.md` report passing scoped core typecheck/test/lint. Those commands were not rerun. The scoped `ptah_get_diagnostics` request did return diagnostics, including errors in sibling test files such as `electron-layout.service.spec.ts:1667` and `message-router.service.spec.ts:776`; this is not an independent clean diagnostics result. Without a comparable baseline/configuration, these are not attributed to Batch 1.
- `ptah_search_files` found no AGENTS.md or CLAUDE.md. Native checks of the root and applicable ancestor directories likewise found no instruction file. The supplied project guidance was used. The Ptah file-read attempt failed; native reads were used afterward.
- The reviewer's higher-priority role prohibits Git operations. Consequently no Git command, including the requested diff/HEAD read, was run. The code was compared with the binding plan and current normal branch; byte identity against HEAD, absence of deleted tests, and exact diff attribution remain unverified. The implementer report's byte-identity claims are not independently certified.
- No source edits, new tests, application launches or Git mutations were performed. Only this deliverable was written. No callable `Write` tool was available; the native patch tool created it.

## Five logic questions

### 1. How does this fail silently?

The supported silent failure is in verification: the closed-workspace regression can pass when a default slice has been recreated, because a missing slice and a stored default slice both expose `['chat']` (`service:273`, `service:333`, `service:588`; `spec:1128`). Finding 1 details it.

No lasting Router/global-state disagreement was found in the examined paths: the constructor effect derives the global value from the settled Router surface before checking ownership (`service:481`, `service:488`, `service:500`). Its asynchronous propagation is explicitly flushed by the service test harness (`libs/frontend/core/src/testing/surface-router-testing.ts:91`); this review does not claim synchronous equality before an effect flush.

### 2. What user action produces unexpected behaviour?

Starting Tasks while Settings is displayed, then switching workspace before Tasks settles, lands Tasks in the incoming workspace. This is explicitly accepted risk RC, not a new defect: the stay-branch transfers ownership at `service:821`; the effect stamps the resulting surface at `service:501`; `spec:1077` pins the scenario. Returning to Chat after closing the last workspace also re-grants ownership by design (`service:555`; revision-3 override 5). Its exact slice-creation assertion is incomplete (finding 1).

### 3. What input data produces a wrong answer?

No configuration identifier was found to enter workspace surface memory: the four identifiers are enumerated at `service:62`, recognized at `service:69`, and rejected before any slice update at `service:761`. The bootstrap empty-string key is distinct from a real workspace path and is migrated before the stay-branch returns (`service:824`). Invalid host view identifiers are rejected at `service:310`; normalization remains at `service:724`. No new malformed-input defect was established in this batch.

### 4. What happens when a dependency fails?

Router rejection is caught and represented as `failed` by `libs/frontend/core/src/lib/routing/surface-router.service.ts:130`. The service refuses unsuccessful settlements at `service:547`, and global state continues to follow NavigationEnd-derived `currentSurface` (`surface-router.service.ts:77`; `service:482`). `spec:1054` exercises rejection through the real facade by mocking `Router.navigateByUrl`, rather than merely returning success from a navigation mock. Normal restore failure retains the ownership barrier, covered by `spec:821`. A navigation that never settles retains the previous global surface; this batch introduces no timeout or loading outcome. Render failures and outlet remount failures are outside Batch 1's implementation boundary.

### 5. What is missing that the requirements never mentioned?

Distinguishing absence of a slice from a stored default slice requires an explicit test observation; the public getters intentionally hide that distinction (`service:333`). The requirement mentions non-recreation but does not specify how to prove it. Also, emitting the remount tick alone does not establish fresh service-level data in the remounted panes: `service:848` only emits intent. That integration/cache risk is already allocated to later batches in `batches.md:73`, and is not a Batch 1 defect.

## Failure modes

### 1. MINOR — Closed-workspace regression cannot prove slice deletion or immediate reseeding

- Trigger: the configuration-settlement path accidentally recreates the removed workspace with a default slice, or the Chat path re-grants ownership without immediately creating its slice.
- Symptom: the test still passes, allowing the required closed-workspace behavior to regress unnoticed.
- Evidence: `libs/frontend/core/src/lib/services/app-state.service.spec.ts:1112` navigates to Chat but checks only the live surface before navigating externally to Analytics at line 1115. Analytics can itself create the slice. The configuration half at lines 1122–1129 checks only public view values. `service:333` falls back to `DEFAULT_VIEW_SLICE`; `service:275` makes both absent and stored-default slices expose `['chat']`.
- Current handling: the production guard at `service:761` correctly returns before slice mutation; no production resurrection defect is alleged. The test proves ownership re-grant through the later external navigation, but not when the map entry was created, and does not prove absence after the configuration settlement.
- Recommendation: add a test-only, typed read of the private slice map. Assert `/ws/a` is absent immediately after removal, present immediately after the settled Chat request and before Analytics, then absent immediately after the second removal and still absent after Settings settles. Keep the existing external-navigation assertion because it independently proves ownership. Do not add a production API just to expose this internal state.

## Blocking issues

None supported by the inspected Batch 1 paths.

## Serious issues

None supported by the inspected Batch 1 paths. The deliberately accepted RC race and closed-workspace owner re-grant are not reclassified as bugs.

## Moderate and minor issues

- **MINOR, finding 1:** `libs/frontend/core/src/lib/services/app-state.service.spec.ts:1114` and `:1128` do not distinguish map membership from fallback content. This is a missing proof for `batches.md:138`, not a request to alter service behavior.

## Data flow

1. **OK — entry points:** host messages validate the id (`service:307`); `setCurrentView` applies `canSwitchViews` and normalization (`service:902`); Settings and Skills helpers keep their pending-intent behavior (`service:983`, `service:1258`).
2. **OK — requested navigation:** `requestSurface` captures a generation and workspace path before awaiting the facade (`service:513`). The facade reports rejection as failure and publishes only successful Router settlements (`surface-router.service.ts:77`, `:130`).
3. **OK — global truth:** the constructor tracks only `currentSurface`; the state update and workspace read are inside `untracked` (`service:481`). Global state is written before the owner check. The unchanged-value optimization preserves the same answer and per-surface slots (`service:489`).
4. **OK — slice settlement:** unsuccessful, superseded and wrong-workspace completions are dropped (`service:547`). Successful current requests re-grant ownership (`service:555`), then all slice callers pass through the configuration refusal (`service:761`). The intentional post-removal re-grant remains intact.
5. **OK — outgoing workspace:** the same-path guard runs before any work (`service:791`). Stay is derived from Router truth (`service:794`), not the potentially unflushed global mirror. The outgoing write remains ownership-gated (`service:813`).
6. **OK — incoming workspace:** ownership/path transfer (`service:821`) and sentinel migration (`service:824`) precede both branches. The stay-branch therefore does not skip migration, transfer or outgoing-stamp gating.
7. **OK, later-batch dependency — stay branch:** one tick is emitted, followed by return (`service:848`). It deliberately skips the normal branch's restore request (`service:862`), hence also skips that request's generation increment and Router supersession. The old request's workspace check prevents its callback from recording in a different workspace (`service:549`); the constructor effect intentionally records a late landing under the new owner (RC, `spec:1077`). No extra cancellation guard is required by the contract.
8. **OK in source; test gap — removal:** removal deletes the map entry and revokes active ownership (`service:873`, `service:889`), leaving global configuration state untouched. Subsequent external navigation updates global state independently of that revoked ownership (`spec:1029`). Finding 1 limits the non-recreation proof for service-started navigation.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Typed configuration ids/slots, global signal and read-only exports | COMPLETE | `service:57`, `:83`, `:362`, `:594`; no slot writer introduced |
| Global write before owner gate, inside untracked | COMPLETE | `service:481`; owner-null external path exercised at `spec:1029` |
| Configuration ids excluded through the common slice funnel | COMPLETE | `service:761`; internal/external navigation covered at `spec:872` |
| recordSettledSurface guards and owner re-grant match the binding contract | COMPLETE | `service:547`; exact HEAD identity unverified |
| Stay uses Router truth; new owner; migration; one tick; no restore request | COMPLETE | `service:794`, `:821`, `:824`, `:848`; tests at `spec:927`, `:963` |
| setCurrentView behavior preserved | COMPLETE | `service:902` matches the required gate/delegation shape; byte identity unverified |
| Task 1.2 cases 1–8 | COMPLETE | Tests at `spec:872` through `:1095` cover the named paths |
| Task 1.2 case 9: exact removed-slice membership | PARTIAL | Finding 1: public fallback content cannot prove presence/absence |
| Task 1.2 case 10: retained partition regression meaning | COMPLETE | Re-pinned tests still exercise ownership and supersession (`spec:735`, `:806`) and pointer preservation (`spec:1177`); deletion history unverified |
| VS Code visible behavior unchanged within Batch 1 | COMPLETE | Live view remains Router-derived (`service:580`); entry points remain reachable. Search found no production consumer of openViews; only production appState.switchWorkspace caller is `workspace-coordinator.service.ts:172`. No VS Code UI run was performed |

Implicit requirements not addressed: no additional Batch 1 requirement identified beyond the precise state observation in finding 1. Later shell remount/fresh-data and pre-workspace outlet behavior remain later-batch responsibilities.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| No workspace / bootstrap sentinel | YES | Default slice and migration before return (`service:824`; `spec:963`) | No rendered outlet claim in this review |
| Owner-null external configuration/non-configuration navigation | YES | Global update before owner guard (`service:488`; `spec:1029`) | No slice ownership fabricated by external navigation |
| Failed navigation | YES | Failed result dropped, Router surface unchanged (`service:547`; `spec:1054`) | Error presentation belongs to existing facade |
| Same workspace selected repeatedly | YES | Early return before stay calculation (`service:791`) | New configuration-specific same-path assertion is absent; source guard is direct |
| A→B→A with normal restore in flight | YES | Ownership and generation guards; `spec:735` | Byte comparison to baseline not performed |
| Configuration stay while Tasks is in flight | YES | Accepted incoming-slice stamp; `spec:1077` | Explicit RC behavior, not a finding |
| Remove active workspace, then navigate to Chat/Settings | YES in source | Owner re-grant plus configuration refusal (`service:555`, `:761`) | Map-membership assertions incomplete; finding 1 |
| External navigation and effect coalescing | YES | Router-tracked, workspace-untracked effect (`service:481`) | Equality guaranteed after effect processing, not every synchronous read |
| Many workspace switches | YES | Existing per-workspace map plus scalar global state (`service:326`, `:362`) | Removal is the map cleanup path; no new per-switch listener/timer |

## Verdict

- Recommendation: REVISE — ACCEPT WITH FIXES for the single minor test gap; no service change requested.
- Confidence: MEDIUM. Both named files were read in full and the boundary behavior was traced, but the Git baseline comparison and application integration were not performed.
- Top risk: Task 1.2 case 9 can report success without proving whether a closed workspace's slice actually exists (`spec:1114`, `:1128`).
- What a robust implementation would add: exact map-membership assertions before and after the two settlements, retaining the existing ownership proof. Later-batch review should separately verify that the tick's consumer remounts against updated workspace data.
