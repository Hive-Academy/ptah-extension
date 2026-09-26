# Code Logic Review — TASK_2026_494, Batch 15, round 1

## Summary

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Verdict | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 2 |
| Moderate issues | 1 |
| Failure modes | 5 (finding 1 has two distinct triggers) |

The core renderer integration works, but resetting a conversation can discard the wrong workspace or conceal a failed abort. Submit chronology, manual surface selection, and timestamp validation also need correction. This is above the 3–4 band because the main state, fallback, trust and restoration paths are implemented and exercised; below 6–7 because a user action can erase another workspace's state and two requested behaviors are incorrect.

Paths below are relative to the worktree root. For compact citations, **A/** means `libs/frontend/mcp-apps-page/src/lib/`, and **D/** means `libs/frontend/declarative-dashboard/src/lib/`. All line numbers are one-based.

## Scope and verification

Read the complete new components and their specs, session service, reducer, public barrel, chart/layout components and their specs; traced the supporting renderer, operations, lanes, submit, sync, focus and transcript paths. Read Batch 15 including carry-overs and coordinator rulings, the requested plan section, context, requirements, executor report, existing style review, and prototype guidance/markup. The existing style review concerns scaffolding, not these component changes. Read-only `git status --short` and `git diff` were used. No source/spec file was changed.

`ptah_search_files` returned no `AGENTS.md`; the root file was also absent. No Ptah file-content reader or native tool named `Write` was exposed, so native reads and the native patch writer were used.

Executed once per configuration:

- `npx jest -c libs/frontend/mcp-apps-page/jest.config.ts --runInBand apps-page.component.spec.ts apps-surface-panel.component.spec.ts`: **2 suites, 22 tests passed**.
- `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts --runInBand dashboard-chart.component.spec.ts surface-layout.component.spec.ts trust-boundary.spec.ts`: **3 suites, 37 tests passed**.
- Scoped `ptah_get_diagnostics`: **12 errors**, matching the eight accepted external baseline errors and four already-known task-spec errors. The tool reports zero-based locations; these correspond to the coordinator's one-based locations. They are not new findings here, but the four task-spec errors remain a pre-commit gate.
- Read-only runtime probe using the installed Angular `DatePipe`: `Number.MAX_VALUE` and `8640000000000001` with `shortTime` both produced **`NaN:NaN PM`** (with locale spacing), rather than a valid time. See finding 4.

The executor/coordinator's broader lint/typecheck/test results were read, not rerun. No browser/layout assessment or real-host end-to-end run was performed. Component tests replace the execution-tree builder and execution node (`A/components/apps-page.component.spec.ts:193`, `:242`, `:248`), so passing them does not prove the real submit transcript sequence.

## Focus table

| # | Ruling | Evidence and limits |
| --- | --- | --- |
| 1 | PASS: synchronous, verbatim write-back is pinned. | `A/components/apps-surface-panel.component.ts:232`, `:366` → `A/services/apps-session.service.ts:409`, `:642` → `A/state/apps-surface-reducer.ts:455`. No await or cloned view-state object; identical writes are no-ops. `A/components/apps-page.component.spec.ts:550` checks identity before change detection and the same drafts object downstream. `A/components/apps-surface-panel.component.spec.ts:320` adds a second pin. Reads apply against current state after awaiting (`A/services/apps-surface-sync.ts:205`), and read replacement preserves the current view state (`A/state/apps-surface-reducer.ts:353`). An agent snapshot intentionally resets it (`:206`). |
| 2 | PASS by tracing, with a missing stress pin. | Every view-state write invalidates `surfaces`; the operations effect calls reconciliation untracked (`A/services/apps-surface-operations.service.ts:124`). It does not enqueue work: only `change`, `select`, `submit` do so (`:174`, `:205`, `:231`). Existing lanes guard in-flight/empty queues and expected revisions (`A/services/apps-surface-lanes.ts:354`, `:377`); the wait timer is not reset on repeated pump (`:402`). Submit advancement ignores sending/polling phases and retains its existing timer (`A/services/apps-submit-flow.ts:380`). Reconciliation leaves uncovered selections alone (`A/services/apps-surface-operations.service.ts:294`); view-state writes preserve overlays/revisions (`A/state/apps-surface-reducer.ts:463`). No draft-created mutation, feedback loop, or view-model rebuild was found: model building depends only on content (`D/components/surface-renderer.component.ts:217`), and pruning emits only when stale drafts exist (`:342`). Work still includes scans of held routing records, UI entries and lanes (`A/services/apps-surface-operations.service.ts:264`, `:289`; `A/services/apps-surface-lanes.ts:294`), rather than O(1) work. The zero-RPC pin at page spec `:634` exercises idle presentation changes, not typing while a lane/submit awaits an echo. A pre-existing eligible queued operation may legitimately progress during reconciliation; that is not a new mutation caused by the keystroke. |
| 3 | PASS. | The binding calls a computed (`A/components/apps-surface-panel.component.ts:231`, `:325`), not an allocation-producing template method. Rejection text goes from lane `setIssue` (`A/services/apps-surface-lanes.ts:601`) through the facade's `issues` (`A/services/apps-surface-operations.service.ts:160`, `:417`) into renderer interaction. The computed tracks both service signals and the current entry. |
| 4 | PASS, with the exact markdown path clarified. | New transcript user/submitted text is interpolation (`A/components/apps-transcript.component.ts:97`); surface titles/fallbacks/notices are also interpolation (`A/components/apps-surface-panel.component.ts:182`, `:206`, `:223`). Assistant text is rendered by **`ExecutionNodeComponent`**, whose message nodes recurse into children (`libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:234`) and whose text branch uses **ngx-markdown's `MarkdownComponent` (`<markdown>`) with `SurfaceMarkdownPipe` from `@ptah-extension/markdown`** (`:136`). It does not use `MarkdownBlockComponent`. The existing app installs `provideMarkdownRendering({ extensions: 'full' })` (`apps/ptah-extension-webview/src/app/app.config.ts:288`), backed by the shared sanitizer (`libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:490`). Agent-supplied surface fields render literally; assistant conversation content intentionally renders sanitized markdown. No new HTML/security-bypass sink was found. The requested Apps source scan passed (`D/trust-boundary.spec.ts:329`). |
| 5 | PARTIAL: included and user echoes do not duplicate it, but ordering is wrong. | Submitted bubbles are merged at `A/components/apps-transcript.component.ts:164` and sorted at `:178`. The real tree skips SDK user-message echoes (`libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:340`), so those echoes do not add a second bubble. However, the bubble uses acknowledgement-time `Date.now()` (`A/services/apps-surface-operations.service.ts:410`), which can be later than the assistant response; finding 2. No page spec exercises submitted-bubble order or the real echo path. |
| 6 | PASS. | Host directive at `A/components/apps-page.component.ts:46`; directive installs tabindex, restores after render and disposes its listener (`A/components/apps-focus-memory.directive.ts:14`, `:38`, `:40`). Page spec `:579` pins recreate and composer focus at `:618`. |
| 7 | PARTIAL. | Status/type/finite/nonnegative checks exist (`A/components/apps-surface-panel.component.ts:67`), with malformed-record tests (`A/components/apps-surface-panel.component.spec.ts:339`). They do not establish a valid Date; finding 4. |
| 8 | PASS. | Both throwing and failed builders flow through renderer `attemptBuild` (`D/components/surface-renderer.component.ts:109`, `:120`, `:265`) to the panel failure identity (`A/components/apps-surface-panel.component.ts:316`, `:381`). The fallback branch excludes the renderer (`:211`). Page spec `:507` tests both paths with the transcript/composer intact; panel spec `:305` pins v1 text, page spec `:535` pins v2 text. |
| 9 | PARTIAL. | Own permission/question filters: `A/components/apps-transcript.component.ts:184`, `:196`, page spec `:431`. Tablist: panel `:164`, spec `:166`. Sort/filter/page/Expand zero transports: page spec `:634`. Chart Escape/focus: `D/components/dashboard-chart.component.ts:160`, spec `:47`. Recreate state/overlays: page spec `:579`. Agent snapshots activate at reducer `:210`, but overwrite a user's explicit selection; panel spec `:195` currently endorses that behavior, contrary to this review's requested preservation of the user-picked surface. See finding 3. |

## Five logic questions

### 1. How does this fail silently?

An abort rejection sets an error, then New conversation immediately discards the slice and its error (`A/components/apps-page.component.ts:251`; `A/services/apps-session.service.ts:338`, `:375`). The empty page conceals that the old agent may still be running. See finding 1.

### 2. What user action produces unexpected behaviour?

Click New conversation in workspace A and switch to B while abort is pending: B is discarded when A's abort resolves (`A/components/apps-page.component.ts:250`; `A/services/apps-session.service.ts:372`). Manually pick surface A while the agent replaces B: the UI switches to B and destroys A's renderer subtree (`A/state/apps-surface-reducer.ts:210`; `A/components/apps-surface-panel.component.ts:227`).

### 3. What input data produces a wrong answer?

A delayed submit result makes the causal user bubble sort after its response (`A/services/apps-surface-operations.service.ts:410`; `A/components/apps-transcript.component.ts:178`). `{ status: 'applied', submittedAt: Number.MAX_VALUE }` passes the guard and renders an invalid time (`A/components/apps-surface-panel.component.ts:72`, `:246`).

### 4. What happens when a dependency fails?

Builder failure is contained and tested (`A/components/apps-page.component.spec.ts:507`). Failed sends restore the composer draft in the tested same-workspace path (`A/components/apps-page.component.ts:235`, spec `:394`, `:411`). Failed abort is not respected by the reset caller (finding 1). Lanes do not bypass the echo wait merely because another view-state write arrives (`A/services/apps-surface-lanes.ts:377`).

### 5. What is missing that the requirements never mentioned?

Reset needs an ownership-bound, success-bearing async contract, rather than composing active-slice methods across an await (`A/components/apps-page.component.ts:251`; `A/services/apps-session.service.ts:330`, `:370`). Transcript chronology needs operation/turn timing, rather than acknowledgement timing (`A/services/apps-submit-flow.ts:470`, `:587`). Finite timestamps need a renderable date range (`A/components/apps-surface-panel.component.ts:74`).

## Numbered findings and failure modes

### 1. Blocking — New conversation can discard the wrong workspace and conceal abort failure

- **File:** `A/components/apps-page.component.ts:250`.
- **Trigger A:** In A, click New conversation while processing; before `abort()` resolves, select workspace B (or replace the active conversation through another caller). `abort()` captures A at `A/services/apps-session.service.ts:331`, but `discard()` obtains the active workspace afresh at `:372`.
- **Symptom/impact A:** B's transcript, surfaces and routing claims are discarded despite the action having targeted A. This is unintended loss of another workspace's in-memory conversation. A is not reset.
- **Trigger B:** The abort RPC rejects, returns failure, or throws. The service records an error and resolves normally (`A/services/apps-session.service.ts:338`, `:355`).
- **Symptom/impact B:** The page still discards, clearing both state and the error (`A/services/apps-session.service.ts:375`; `A/services/apps-workspace-slice.ts:62`). The agent can remain running after the page removes its controls/claims, and the user sees an apparently completed reset.
- **Current handling:** An unconditional `discard()` after `await abort()`, with no success result or ownership check. There is no reset-path test in the complete page spec.
- **Exact fix:** Implement a service-level reset operation that captures workspace key and routing/conversation identity before awaiting. Return/check abort success, leave the original state and visible error intact on failure, and discard only the captured still-owned conversation on success. Never resolve the reset target from the active workspace after the await. Cover delayed abort + workspace switch, failed abort, and replacement conversation during abort.

### 2. Serious — Submitted bubbles use result time and can appear after their own response

- **Files:** `A/components/apps-transcript.component.ts:164`, `:178`; `A/services/apps-surface-operations.service.ts:406`.
- **Trigger:** A submitted turn starts streaming before `surface:action` returns, or a pending/transport result is resolved through later polling. `AppsSubmitFlow` only publishes the bubble when it settles applied/indeterminate (`A/services/apps-submit-flow.ts:579`, `:587`); pending results enter polling (`:504`).
- **Symptom/impact:** The assistant node can have `startTime = 200`, while a bubble acknowledged at `300` receives `at = 300`. The transcript sort puts the assistant reply before “Submitted: …”. The effect is especially visible after polling, and misrepresents which user action caused the reply.
- **Current handling:** Correct numerical sorting of the wrong timestamp; tie-breaking cannot fix it. The page uses a builder stub and never exercises submitted bubbles (`A/components/apps-page.component.spec.ts:193`, `:242`). SDK user echoes are already filtered by the real builder, so there is no evidence of an echo duplicate; the defect is chronology.
- **Exact fix:** Carry the original action-send/turn timestamp and stable operation identity through `AppsSubmitHost.submitted` into the bubble. `active.sentAt` already exists (`A/services/apps-submit-flow.ts:470`). Publish once at the terminal outcome with that original time, rather than `Date.now()` at receipt. Pin delayed result/polling with a reply already present, plus a real user echo, asserting bubble-before-response and one bubble.

### 3. Serious — Agent snapshots override an explicit user surface choice

- **Files:** `A/state/apps-surface-reducer.ts:210`, `:472`; `A/components/apps-surface-panel.component.ts:227`.
- **Trigger:** Agent creates A then B; user selects A and focuses an input there; another agent snapshot creates/replaces B.
- **Symptom/impact:** `applySnapshot` unconditionally makes B active. A's renderer is removed by the keyed view, so the user loses the surface/control they chose. No explicit `.focus()` call is necessary for focus to be lost when its DOM is destroyed.
- **Current handling:** `activateSurface` records only the active id, with no distinction between an automatic choice and a user choice. The spec at `A/components/apps-surface-panel.component.spec.ts:195` explicitly expects the next agent snapshot to override the user.
- **Requirement conflict:** The reducer plan at `implementation-plan.md:429` supports unconditional activation, whereas the page contract at `:665` says “unless the user picked another”; the current review request explicitly asks not to steal focus from the user-picked surface. This is a behavioral/spec gap, not an objection to the accepted out-of-scope reducer edit.
- **Exact fix:** Record manual selection in session/reducer state. Auto-activate snapshots until a user choice exists; preserve that live choice on unrelated snapshots. Clear/rebase the preference when its surface is removed or the conversation is reset. Replace the contrary spec expectation and assert that focus inside the chosen surface survives an unrelated agent snapshot. Align the conflicting plan sentence with this rule.

### 4. Moderate — A finite timestamp is not necessarily renderable by DatePipe

- **File:** `A/components/apps-surface-panel.component.ts:72`, `:246`.
- **Trigger:** A host record contains a recognized status and a finite nonnegative timestamp above `8640000000000000`, for example `Number.MAX_VALUE`.
- **Symptom/impact:** The line presents `Last submitted at NaN:NaN PM.` rather than hiding the malformed record. The installed Angular DatePipe runtime probe reproduced this output. This is a wrong displayed value, not a claimed renderer exception.
- **Current handling:** Intake accepts an arbitrary record (`A/state/apps-surface-intake.ts:236`); the page checks number/finite/nonnegative only. Existing tests cover NaN, negative and string values, not an invalid Date range (`A/components/apps-surface-panel.component.spec.ts:345`).
- **Exact fix:** Also require `Number.isFinite(new Date(submittedAt).getTime())` (or enforce the equivalent supported epoch range). Add guard and rendered-DOM cases for the upper boundary and boundary + 1/Number.MAX_VALUE; malformed values must omit the line.

## Blocking issues

Finding 1: cross-workspace data loss and abort failure hidden by unconditional discard.

## Serious issues

Findings 2–3: incorrect submitted-turn chronology and loss of the explicitly selected surface/focus.

## Moderate and minor issues

- Finding 4: date-range validation.
- Minor verification recommendation, not a separate observed failure: extend the page write-back pin (`A/components/apps-page.component.spec.ts:550`) with repeated input events while a change is in flight and another change/submit waits for an echo. Assert exact draft identity, unchanged expected/materialized revisions, stable pending overlays, no extra mutation RPC, and no additional wait timer. The current zero-RPC test (`:634`) has no outstanding lane.
- The four known task-spec type errors remain the coordinator's existing gate; do not count them again as newly discovered logic defects.

## Data flow

1. **GAP:** Composer/reset events enter the page. Send awaits the session and restores a failed draft (`A/components/apps-page.component.ts:235`); reset crosses an unbound await (`:250`, finding 1).
2. **OK:** Conversation ownership and streaming state live in root workspace slices (`A/services/apps-session.service.ts:109`, `:484`), rather than being destroyed with the page.
3. **OK / selection gap:** Inbox pushes enter reducer validation; snapshots atomically replace content and reads reconcile against current state (`A/state/apps-surface-reducer.ts:319`; `A/services/apps-surface-sync.ts:205`). Snapshot activation disregards a manual choice (finding 3).
4. **OK:** Accepted content goes to one keyed renderer; rejected/failed content goes to a mono fallback (`A/components/apps-surface-panel.component.ts:210`, `:227`).
5. **OK:** Draft/presentation outputs synchronously update the stored view state; input commits/selections/actions use distinct operations methods (`A/components/apps-surface-panel.component.ts:361`, `:369`, `:373`, `:377`). There is no new transport in the renderer.
6. **OK:** Lane revision gates retain pending overlays until their echo; reconciliation does not synthesize mutations (`A/services/apps-surface-lanes.ts:377`, `:571`).
7. **GAP:** Terminal submits append a timestamped bubble, then the transcript merges by time (`A/services/apps-surface-operations.service.ts:406`; `A/components/apps-transcript.component.ts:178`); acknowledgement timing breaks causal ordering (finding 2).
8. **OK / validation gap:** Assistant nodes use existing sanitized markdown; declarative fields remain literal. Submit metadata has incomplete date validation (finding 4).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| B8 synchronous write-back and computed interaction | COMPLETE | Passing identity pin; add queued-state stress coverage. |
| Local sort/filter/page/Expand, no transport | COMPLETE | Passing transport spies in the idle case; Escape/focus is covered. |
| Own prompts, host focus directive, recreate state/overlays | COMPLETE | Passing page pins; runtime navigation remains outside this unit review. |
| Rejected/build-failure mono fallback with transcript | COMPLETE | v1/v2 and throw/failed-result paths exercised. |
| Submitted bubble display/order/no echo duplicate | PARTIAL | Display and echo suppression trace correctly; ordering fails and page integration pin is missing. |
| Automatic activation with user-choice preservation | PARTIAL | Automatic activation works; manual preference is not preserved. |
| Validate lastSubmit before rendering | PARTIAL | Missing valid-Date range. |
| Safe New conversation behavior | PARTIAL | Missing abort-success and ownership-bound reset. |
| Public API | COMPLETE | `libs/frontend/mcp-apps-page/src/index.ts:1` exports both requested symbols. |

Implicit requirements not addressed: async reset ownership, visible abort failure after reset, causal submit timestamps, and safe date formatting.

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Empty page and malformed surface contract | YES | Page specs `:359`, `:485`. |
| Repeated draft writes / same view-state object | YES by trace | Reducer identity guard `:461`; renderer publishes synchronously `D/components/surface-renderer.component.ts:336`. |
| Echo wait plus a draft keystroke | YES by trace; pin missing | Lane guards `A/services/apps-surface-lanes.ts:354`, `:377`, `:402`; no new mutation queued. |
| Throwing builder / returned renderFailed | YES | Page spec `:507`. |
| Destroy/recreate | YES for exercised state | Page spec `:579` restores transcript/filter/overlay/focus. |
| SDK user echo after a submit | YES by trace; pin missing | Execution-tree builder skips user roots at `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:344`. |
| Reply before delayed submit result | NO | Finding 2. |
| Abort failure or workspace switch during reset | NO | Finding 1. |
| New agent snapshot after manual surface selection | NO | Finding 3. |
| Finite timestamp outside Date range | NO | Finding 4. |

## Exact fix list

1. Make New conversation a success-bearing, ownership-bound service operation; add failed-abort and delayed-abort/workspace/conversation race tests.
2. Preserve submit operation identity and original send time in submitted bubbles; add causal ordering and real user-echo integration tests.
3. Persist explicit surface selection until it is removed/reset, retain focus on unrelated agent snapshots, and correct the contrary test/plan sentence.
4. Validate the Date range before invoking the pipe; test invalid finite timestamps in the DOM.
5. Add the repeated-keystroke/queued-lane/echo-wait regression pin, and complete the already-agreed four spec type fixes before commit.

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for the concrete code paths; runtime layout and real-host scheduling were not exercised. Finding 3 explicitly resolves conflicting plan wording in favor of the current review request.
- Top risk: New conversation can erase a different workspace's in-memory state after an async abort.
- What a robust implementation would add: captured reset ownership and result status, operation-based transcript timing, persistent manual surface choice, valid-date checks, and the targeted race/echo tests listed above.

One-line summary: **NEEDS_REVISION, 5/10 — 59 targeted tests pass, but reset ownership, submit chronology, manual surface choice and date validation need fixes.**
