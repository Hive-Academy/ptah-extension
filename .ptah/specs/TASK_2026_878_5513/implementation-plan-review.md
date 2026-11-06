# Implementation plan review

- Author: software-architect subagent (claude family)
- Reviewer: codex lane
- Revision: 3
- Round: re-review 2

## Verdict

**REVISE.** The asymmetric join is resolved, but an all-abort census can leave a stale registry entry.

## Findings

1. **Resolved (Serious) — Unsupported-provider classification was too broad.** Round 1 found that every `AuthRequiredError` was classified as unsupported. Revision 2 §1/P8 (plan lines 112, 119-135) requires the exact refusal message, Codex provider id and error class at pinned, inherited and runner paths. `workspace-provider-profile-resolver.ts:410-425,546-553` confirms Codex-id errors can have different messages; `codex-native-runtime-refusal.ts:4-5,18-25` and `sdk-query-runner.service.ts:352-360` confirm the refusal text. B1 tests cover both kinds on each path. No further change required.

2. **Resolved (Serious) — Raw provider causes would reach the UI.** Round 1 found cause text in the proposed run result, diagnostics and events; the existing thrown branch returned `err.message` (`memory-rpc.handlers.ts:731-740`). Revision 2 §2/P9 (plan lines 140-159) specifies fixed sentences in the activity log, three other event producers, runNow's thrown branch and diagnostics. B1 sentinel tests (lines 349-352) cover wire results and snapshots. No further change required.

3. **Resolved (Serious) — Marker re-harvest could overwrite another workspace's grades.** Round 1 found that grade identity omits workspace root (`0056_skill_nullable_grades.ts:50-64`; `skill-task-grade.store.ts:112-129`). Revision 2 §8/P10 (plan lines 252-260) guards conflicting upserts by root, scopes `hasGradeForTask`, and guards reconciliation updates. B3 adds a two-workspace marker-upgrade test (lines 360-363). A colliding key is refused and logged instead of moving another workspace's grade. No further change required.

4. **Resolved (Moderate) — Evidence overstated the error taxonomy.** Round 1 called `AuthRequiredError` the refusal signal. Revision 2's evidence table (plan lines 35-36) correctly describes general auth failure and the provider-specific Codex instance. No further change required.

5. **Resolved (Serious) — Background run joining was asymmetric.** Revision 3 §5/P12 (plan lines 211-225) makes manual and background callers join one record keyed by root in either order. The first participant fixes `origin`, and the last release writes `lastRun` once and pushes at most one settle event. The indexer registers its census synchronously and shares the active promise (`code-symbol-indexer.service.ts:565-570,703-722,746-755`); the lifecycle can start a watcher run during a manual run (`workspace-index-lifecycle.ts:365-394`). B2 now specifies manual-first success and failure, background-first success, and background/background success and failure (plan lines 379-384). The original reverse-order duplicate outcome is addressed, subject to finding 6.

6. **Serious, Open — An all-abort census has no specified map removal.** P12 says only a *non-abort* symbols settlement closes a record and removes it from the open map (plan line 214). Its settle rule records `cancelled` or nothing when all participants abort, but does not say that settling also removes the still-open record (lines 215-222). A manual-first census cancelled while a watcher is joined makes both participants abort: the starter's signal aborts the underlying census, while joiners receive its rejection (`code-symbol-indexer.service.ts:746-785`); the lifecycle suppresses that expected abort (`workspace-index-lifecycle.ts:381-394`). After both releases, the registry can retain an open record even though the indexer has removed its census (`code-symbol-indexer.service.ts:725-737`). A later start would join stale control state while the indexer starts a new census, giving the wrong origin and possibly duplicate or missing settlement. Require an explicit, identity-checked removal when the final participant releases, including all-abort/pause/cancel paths. Extend the B2 cancel test with a fresh run after the abort and assert a new record, its origin, one `lastRun` write and one settle push.

7. **Moderate, Open — The seven new tests omit one failure order.** The B2 list (plan lines 379-386) covers manual→background success/failure, background→background success/failure, and background→manual success, but not background→manual failure. Add that case and count one failed `lastRun` write and one `INDEXING_FAILED` push with `origin:'background'`. The record-close and joiner-cancel tests are the other two listed cases.

## Spot-checks

| Plan claim | Actual source | Result |
| --- | --- | --- |
| Exact Codex refusal message and provider id (lines 35, 112, 123-125) | `codex-native-runtime-refusal.ts:4-5,18-25`; `sdk-query-runner.service.ts:352-360` | Verified; constant move/re-export is executable |
| Codex-id auth errors can mean something else (line 36) | `workspace-provider-profile-resolver.ts:410-425,546-553` | Verified |
| Pinned and inherited refusal paths (lines 37-38, 128-129) | `provider-auth-resolver.ts:157-167`; `workspace-llm-resolver.ts:95-103` | Verified |
| Runner refusal path (lines 39, 130) | `sdk-query-runner.service.ts:352-360`; `sdk-internal-query.curator-llm.ts:597-615` | Verified |
| Existing runNow thrown branch exposes raw text (line 154) | `memory-rpc.handlers.ts:731-740` | Verified; revision sanitizes it |
| Other event producers need sanitizing (line 150) | `memory-trigger.service.ts:1026-1031,1204-1208`; `memory-curator.service.ts:325-329` | Verified |
| Grade conflict currently overwrites root (lines 68, 252-254) | `skill-task-grade.store.ts:112-131`; `0056_skill_nullable_grades.ts:50-64` | Verified; guard addresses it |
| Manual and background calls can share a census (P12, lines 211-223) | `code-symbol-indexer.service.ts:554-575,745-755` | Verified; registry covers both join orders |
| Lifecycle can initiate a watcher full run (line 115) | `workspace-index-lifecycle.ts:365-394` | Verified |
| An aborted joiner does not close the underlying census (P12, line 214) | `code-symbol-indexer.service.ts:746-785` | Verified; final-release map cleanup remains unspecified |
| Migration 0066 follows 0065 and is additive (lines 109, 194) | `migrations/index.ts:92-93,456-464`; `indexing-control.service.ts:84-94,601-669` | Verified; nullable column and existing-row test specified |

The Revision 3 change is confined to the B2 control service and its existing spec file. This final re-review checked P12 and the seven new B2 cases only. No tests or checks were run for this document review.

## Lane-introduced constraints

- **lane-proposed, orchestrator-accepted (decision 15):** P3 selects the latest work review by mtime and excludes document reviews; P4 requires the same normalized workspace root and drops the null-task time-window fallback (plan lines 107-108).
- **lane-proposed, superseded:** Round 1 identified in-memory-only indexing results (P5) and excluded boot/watcher censuses. Decision 14 requires boot/watcher visibility; Revision 2 persists the last run in migration 0066 (plan lines 18-19, 109, 115).

## Decisions

- Binding decisions 7-11 remain reflected: no lane-routing/outcomes edits, census performance and carrier-less folders outside scope, native Codex one-shot separate, no provider fallback, Codex picker exclusion, task-id skill reconciliation and marker bump.
- Orchestrator rulings 14-15 are accepted. Finding 5 concerns correct implementation of ruling 14.
- Gate 2 outcome: **REVISE** for finding 6. Finding 5 is resolved; the registry needs explicit final-release cleanup and the missing failure-order test in finding 7.
