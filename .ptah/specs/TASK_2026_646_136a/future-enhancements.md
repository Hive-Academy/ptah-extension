# Later tasks - TASK_2026_646_136a

Consolidated by team-leader Mode 3 (2026-10-16, session 11) from the review triage tables in `batches.md` (P2c, P3c,
P4c, P5c, P6c), HANDOFF.md "Open problems" item 4, and the two Minors of `reviews/batch-41h-code-logic-review.md`.
None of these is fixed by this task. Each was classified under lean rule 4: a Moderate is fixed in the task only when it
can break a lane config or lose data; the others become named later tasks, and Minors are recorded.

The one write-path defect found at completion (VS Code decision-model selection, W1) is **not** a later task. It is
Batch 41i in `batches.md` and blocks completion.

Suggested grouping for follow-up tasks: (A) lane-outcomes pipeline hardening = P2c; (B) routing engine = P3c + P4c;
(C) outcome report and MCP surface = P5c (MCP items) + P6c; (D) Agents tab and settings UI = P5c (UI items) + HANDOFF
item 4 UI entries.

## P2c - lane-outcomes (from `reviews/p2-*`; decisions #83, #85, TL-35, TL-44)

P2c was planned as a carry-over batch but never ran (Batch 37 became the P3 fix round). LT-P2-1 and LT-P2-16 were marked
"before Batch 30"; Batch 30 shipped without them. Batches 36, 38b, 38c and 41d changed the pipeline and drain, so each
item below must be re-checked against HEAD before it is scheduled.

| Id | Finding | Severity / note |
| --- | --- | --- |
| LT-P2-1 | Retry timer re-armed after `dispose`, never `unref`'d (CLI exit delay up to 60 s) | Moderate. `disposed` guards exist now (`outcome-write-pipeline.ts:383-399`); no `unref` found - re-check |
| LT-P2-2 | `classificationInputs` unbounded and not replay-safe (`lane-outcome-recorder.service.ts`) | Moderate |
| LT-P2-3 | `agentType: 'unknown'` stored as a role | Moderate, skews signals |
| LT-P2-4 | Reader returns full rows typed as summaries; add `toSummary()`, strip `budgetStopped` | Moderate, privacy shape |
| LT-P2-5 | Read cap never logged | Moderate, observability |
| LT-P2-6 | Failing pre-loop step stalls the pipeline without backoff; no attempt cap for poison ops | Moderate |
| LT-P2-7 | Queue uncapped when a journal exists | Moderate, memory under storage failure |
| LT-P2-8 | Subagent deliverable freshness not enforceable (`startedAt` null) | Moderate, false `delivered` |
| LT-P2-9 | Repeated literals for read cap, one-day hold, window | Moderate, drift |
| LT-P2-10 | Pipeline constructor callback and late `c.resolve`; `LANE_OUTCOME_PIPELINE` outside `LANE_OUTCOME_TOKENS`; unused `LOGGER` token | Moderate, design |
| LT-P2-11 | `LaneOutcomeRowSchema` restates shared enums without `satisfies`; misleading names | Moderate, touches `libs/shared` |
| LT-P2-12 | Three stores, three hand-written specs, no contract runner; spec DDL hand-copied | Moderate, test hygiene |
| LT-P2-13 | `KeyValueLaneOutcomeStore extends InMemoryLaneOutcomeStore` | Moderate, delegate instead |
| LT-P2-14 | `workspaceRoot` contradicts the shared privacy header; optional fields always set | Moderate, touches `libs/shared` |
| LT-P2-15 | Queue order inverts when `drain` and `accept` fail together (ops kept) | Moderate |
| LT-P2-16 | Ops owned by an in-flight `drain` invisible to the `submit` `pending` scan | Moderate; a report can be refused as `not found` in that window |
| LT-P2-17 | Storage-less queue mode: `undefined` head makes `drain` reschedule forever | Moderate, needs a typing violation |
| LT-P2-18 | Entry dropped on journal load keeps no run id and no rejected-ledger row | Moderate |
| ~~LT-P2-19~~ | lane-outcomes esbuild `external` | **Closed** by 8253977e8 (`libs/backend/lane-outcomes/project.json:17`) |

## P3c - routing engine (decisions #93, #94, #96)

| Id | Finding | Severity / note |
| --- | --- | --- |
| LT-P3-1 | `gather.ts` has no overall deadline; a never-settling port keeps the gate pending | Moderate |
| LT-P3-2 | `phase-plan.ts` / `assemble-gate.ts` take seven positional values incl. a bare boolean | Moderate, maintenance |
| LT-P3-3 | `model-refine.ts` exports unused `openSystemOne` | Minor |
| LT-P3-4 | Same-key concurrent route calls can pick the same next lane (lock covers persistence only) | Moderate, concurrency only |
| LT-P3-5 | A failed clear of the unsupported mark is swallowed; after restart `loadMark` can restore a stale mark | Moderate (user: "Accept P3, defer", #96) |

## P4c - decision-model adapters (decision #104)

| Id | Finding | Severity / note |
| --- | --- | --- |
| LT-P4-1 | Abort does not bound every structured-adapter stage (P4 logic M-5) | Moderate |
| LT-P4-2 | A hung shared discovery promise is reused (P4 logic M-6) | Moderate |
| LT-P4-3 | P4 final defect 2: a persisted unsupported mark written by a dev build can hold raw text (not on `main`) | From HANDOFF item 4 |

## P5c - outcome report, signals, auth classifier (decision #102)

| Id | Finding | Severity / note |
| --- | --- | --- |
| LT-P5-1 | Subagent mtime (logic M-1) | Moderate |
| LT-P5-2 | Caller check (logic M-3) | Moderate |
| LT-P5-3 | Revise idempotency (logic M-4) | Moderate |
| LT-P5-4 | Stopped lane class (logic M-5) | Moderate |
| LT-P5-5 | Continuation turns (logic M-7) | Moderate |
| LT-P5-6 | 2,000-row cap marker (logic M-9) | Moderate |
| LT-P5-7 | Redundant catch-log-rethrow (style M1) | Moderate |
| LT-P5-8 | Stale "later batch" comments (style M2) | Moderate |
| LT-P5-9 | Metrics branch duplicated (style M3) | Moderate |
| LT-P5-10 | Notifier thunk (style M5) | Moderate |
| LT-P5-11 | Barrel exports (style M6) | Moderate |
| LT-P5-12 | Client 500-slug chunking (style M7, with logic m-2) | Moderate |
| LT-P5-13 | P5 final review Minors: logic defects 2-4 and style D2-D8, except those fixed in 41c | From HANDOFF item 4; see `reviews/p5-final-code-logic-review.md`, `reviews/p5-final-code-style-review.md` |
| LT-P5-14 | Drawer shows "Outcome data unavailable" twice (`clone-detail-drawer.component.ts:181-188`) | Minor, HANDOFF item 4 |
| LT-P5-15 | `outcomeReadFailures` is never read | Minor, HANDOFF item 4 |
| LT-P5-16 | `route-tools.ts:49` keeps a private copy of the flattener (`flattenOperationUnion` exists since 41b) | Minor, HANDOFF item 4 |

## P6c - MCP and host lifecycle (decisions #100, #105)

| Id | Finding | Severity / note |
| --- | --- | --- |
| LT-P6-1 | stdio `route_decide` invalid-args code is `mcp_tool_failed` | Moderate |
| LT-P6-2 | stdio resolves outcome deps outside `try` -> `-32603` | Moderate; check against 38c (N-2 moved resolution inside `try`) |
| ~~LT-P6-3~~ | `ptah_outcome_report` input schema lacked enums | **Closed**: moved to P5 style S1, fixed by 39a and 41b |
| LT-P6-4 | `let builtAgent` assigned in an object literal (`ptah-api-builder.service.ts`) | Moderate, style |
| LT-P6-5 | `limitKey` duplicates `laneCandidateId`; stale header in `route-namespace.builder.ts` | Moderate, style |
| LT-P6-6 | `typeof ... === 'function'` guards in the HTTP and stdio MCP servers | Moderate, style |
| LT-P6-7 | Smoke tests re-register the aliases themselves | Moderate, style |
| LT-P6-8 | CLI gateway, cron and triggers outlive the agent reap (logic N-3) | Moderate |
| LT-P6-9 | Quit during Electron boot skips the drain (logic N-4) | Moderate |

## UI and visual (HANDOFF item 4)

| Id | Finding | Severity / note |
| --- | --- | --- |
| LT-UI-1 | Visual M1 (`reviews/batch-41-visual-review.md:90`): on cold start the Decision card reads "Status not reachable" and hides the selected model; `agent:getConfig` 5 s timeout (`decision-model-row.component.ts:55`) | Moderate (visual) |
| LT-UI-2 | Visual M2 (`:106`): the unavailable and loading outcome states are not visually verified (cannot be seeded) | Moderate (evidence gap) |
| LT-UI-3 | Visual m1 (`:114`): "Last enhanced" label wraps to 2 lines at 1100 px | Minor |
| LT-UI-4 | Visual m2 (`:115`): cards show the raw error "Models unavailable: RPC timeout: skillSynthesis:getAgentModels" (carried over from P5 m1; not from this task) | Minor |

## Batch 41h review Minors (`reviews/batch-41h-code-logic-review.md`)

| Id | Finding | Severity / note |
| --- | --- | --- |
| LT-41h-1 | No direct regression test for a selection-only save whose read-back is unreadable (`agent-rpc.handlers.decision-model.spec.ts:681-755`); current code correctly rethrows (`agent-rpc.handlers.ts:865-869,927-935`) | Minor, test gap |
| LT-41h-2 | `storedSelectionState` logs "restoring the previous key" on a selection-only save that wrote no key (`agent-rpc.handlers.ts:927-934`) | Minor, operator log text only |

## Out of scope follow-ups named by the requirements

- Calling the routing tool at per-batch executor selection inside team-leader (task-description.md, Out of scope).
- `skill_invocation_events` dependency: TASK_2026_659_cec4 must not drop data this task reads (Risks table).
