# Batch 18 report: host routing coordinator

## Tasks and evidence

- **18.1 Coordinator and state machine.** `HostRoutingCoordinator.admitUserTurn({ tabId, sessionId, prompt })` is synchronous. It returns `void` and runs the scope check as `void assess(...).then(applyAssessment).catch(report)`.
  - **Admission gate.** Blank prompts and `/` commands are skipped. With the setting off, or with no decision model configured, it calls `cache.clear()` and applies a Disable reset to a known tab. It makes zero calls. Otherwise it calls `cache.beginTurn(tabId)`.
  - **Assessment order (r3 N2).** The admission bumps `generation` and captures `epoch`. It builds an immutable `ScopeConversation` snapshot, then sets `previousUserTurn`.
  - **`applyAssessment` guards.** Each runs before any mutation, in this order:
    1. tab state identity (an evicted tab is never recreated);
    2. `epoch`;
    3. `generation` (superseded);
    4. a settle-time `setting.isEnabled()`.
  - **Rules 1-6.** Implemented as the Component 16 table.
  - **Act on revision.** Nothing is done for an already routed revision. A settled scope gets a pre-flight. Otherwise one nudge is queued per revision.
  - **Pre-flight.** At most one per revision: an `inFlight` request for the same revision is reused, and a revision already attempted gets no new call. `route_decide` runs at `stage: 'pre-flight'` on `buildPreflightScopeSummary` of the newest snapshot, with the updated `pendingScope`.
  - **Pre-flight on success.** The coordinator sets `routedRevision` and `routedScope` (1200 chars). It stores `cache.put(tabId, { revision, modelFingerprint: JSON.stringify(config.getSelection()), result })`. Then it calls `queue.put(latestSessionKey, reminder)`.
  - **Cache key.** The B13 cache is keyed by tab id. That matches the B15 MCP key `getSessionTabId(trimmedCallerId) ?? trimmedCallerId`, which resolves to the tab id.
  - **Candidates.** Built with `buildRouteCandidateSource(api.agent)`. The API is built once, and a failed build is not kept.
    - The lane list and the subagent list each have their own 2000 ms budget, and each timer is cleared in `finally`.
    - Lanes must be installed, not disabled and not `at-limit`. They are ordered by `preferredRank` (unranked last), then by id. At most 4 are listed.
    - Subagent roles are intersected with `BUILTIN_SUBAGENT_ROLES`, at most 4.
  - **Bounds.** Tab state is an LRU of 200 and the session-to-tab alias map is an LRU of 200.
  - **Subscriptions.** `onTurnEnded` stores up to 1500 characters of the assistant reply. `SessionIdResolvedCallbackRegistry` supplies aliases for start turns. Both are released in `dispose()`.
  - **Fail-open.** Each stage logs `warn('Host routing step failed', { tabId, stage, code })`, where `code` is `loggableErrorName` or a fixed code. Discards log `debug('Host routing result discarded', { tabId, stage, reason })`. No text is logged.
  - **gate-0.1.** Never called: only the `pre-flight` stage is sent.
  - **Reminder format** (`routing-reminder.format.ts`).
    - The reminder follows the plan format exactly. Absent or empty candidate lists are left out. Each label is capped at 48 characters and the whole text at 600.
    - It returns `null`, so no reminder is queued, when both answers are `skill-table` with a non-null `fallbackCause`.
    - The nudge text matches the plan.
    - Neither text mentions `route_decide`.
- **18.2 Gate 2 carry-forward (binding).**
  - `disableReset` bumps `state.epoch`. It also runs `cache.markUnknown`, discards queued text (the latest session key and the tab key), and clears `inFlight`, `attemptedRevision`, `routedRevision` and `nudgedRevision`.
  - The epoch is captured when each assessment starts (`admitUserTurn`) and when each pre-flight starts (`startPreflight`).
  - `settlePreflight` checks tab identity and the epoch first and returns before any state, cache or queue change. Only after that does it clear `inFlight`, and only `if (state.inFlight?.promise === own)`: the promise-identity guard.
- **18.3 Specs.** `host-routing.coordinator.spec.ts` drives the real coordinator. It uses a real `PreflightReuseCache`, a real `HostRoutingSetting`, a real `DecisionModelConfig` and a real `NextTurnReminderQueue`, with fake assess and decide. It covers:
  - Enablement: setting off, model unset, slash and blank prompts.
  - Rules: no repeated nudge (F2); settled new task; non-engineering and unchanged continuation; material change; unknown continuity (F6); unavailable answer with the privacy assertion.
  - Pre-flight: deferred pre-flight reuse (F3); deferred pre-flight then material change; failure with no retry; candidate listing failure.
  - Reverse-order scope answers, with both variants.
  - N3: disable during a pre-flight and during a pending scope answer.
  - Gate 2: off then on before an old assessment settles; off then on before an old pre-flight settles, including a new same-revision pre-flight; an old pre-flight failure that does not clear the new `inFlight`.
  - Window and lifecycle: the assistant reply is kept after start-turn aliasing; dispose releases both subscriptions.

  `host-routing.multi-turn.spec.ts` covers the acceptance flow:
  - vague → one nudge → assistant proposal → agreed → one pre-flight whose request has the pending scope and the proposal and is ≤ 8000 chars → one reminder on the next turn → no second nudge or pre-flight;
  - with the setting off, the same conversation makes zero assess and zero decide calls.

  `routing-reminder.format.spec.ts` covers the format, omissions, null confidence and undetermined values, fallback-only → `null`, the 600 cap, and the absence of `route_decide`.

## Absolute paths touched

- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.spec.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.multi-turn.spec.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/host-routing/routing-reminder.format.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/host-routing/routing-reminder.format.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/tokens.ts`: added `HOST_ROUTING_COORDINATOR: Symbol.for('ChatHostRoutingCoordinator')`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/batch-18-report.md`

`npx prettier --write` was run on every touched source file. All files are UTF-8 with LF line endings.

## Verification

1. `npm run verify -- -p @ptah-extension/rpc-handlers 2>&1 | tail -40`, first run: 2 of 3 tasks passed, and the test task failed on my own suites. There were three causes, all fixed:
   - a `'gemini'` value that is not a valid `CliType`;
   - a missing `reflect-metadata` import in the format spec;
   - the `@ptah-extension/vscode-lm-tools` barrel pulling ESM-only workspace-intelligence modules into Jest. Fixed with `jest.mock`, following `web-search-rpc.handlers.spec.ts:54`.
2. Same command after the fix: `NX 3 tasks: 2 succeeded, 1 failed`, so lint and typecheck pass. The test totals were `Test Suites: 10 failed, 182 passed, 192 total` and `Tests: 7 skipped, 4989 passed, 4996 total`.
   - **The 10 failing suites are foreign.** Each fails to compile with `../lane-outcomes/src/lib/lane-outcome-recorder.service.ts:24:10 - error TS2305: Module '"./task-kind-mapping"' has no exported member 'resolveTaskKind'.` The log has 20 matches: 10 suites, each printed twice. No other error appears. That file belongs to the parallel Phase A lane-outcomes fix round. I did not touch it, as instructed.
   - The three host-routing suites are not in the FAIL list. The first run had 189 + 3 failing (mine) = 192 suites. This run has 182 passing + 10 foreign = 192. So all three of my suites now pass.
   - The team-leader should re-run this command after the lane-outcomes executor lands `resolveTaskKind` (risk R1).
3. `npm run verify -- -t lint -p degradation-audit`: `NX 1 task: 1 succeeded`, exit code 0. The one deliberate swallow is the candidate-listing `catch` that returns `null`. It carries a leading `// degradation-audit: reported - ...` marker.

## R5 and Gate 2 carry-forward

| Requirement                                                                           | Code                                                                  | Spec                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Epoch incremented on Disable reset                                                    | `disableReset` (`state.epoch += 1`)                                   | all Gate 2 cases                                                                                                                                                         |
| Epoch captured at assessment start, discard before mutation                           | `admitUserTurn` captures it; first guards in `applyAssessment`        | `off then on before an old assessment settles: the old answer changes nothing`                                                                                           |
| Epoch captured at pre-flight start, discard before any state, cache or queue mutation | `startPreflight` passes `epoch`; the first check in `settlePreflight` | `off then on before an old pre-flight settles, with a new same-revision pre-flight` (no BUGFIX reminder, cache miss, then only the FEATURE result lands)                 |
| `inFlight` cleanup by promise identity                                                | `if (state.inFlight?.promise === own)`                                | the same spec (a 4th turn reuses the new request: decide is called 2 times, not 3) and `an old pre-flight failure after off→on does not clear the new in-flight request` |
| Toggle off during an assessment and during a pre-flight                               | settle-time `isEnabled()` → `disableReset`                            | `toggle off while a scope answer is pending...` and `toggle off while a pre-flight is in flight...`                                                                      |

## Decisions

| Decision                                                                                                                                           | Options                                                                | Evidence                                                                                                                                                            | Reversible |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| On a revision bump (rule 4), discard any queued reminder or nudge for the key                                                                      | Leave it until the next `put` replaces it                              | Req 5: "discard the stale reminder and use only the latest scope revision"; without this, a stale reminder could be delivered while the new pre-flight is in flight | yes        |
| The pre-flight summary uses the updated `pendingScope` (`{ ...snapshot, pendingScope: state.pendingScope }`)                                       | Raw snapshot (`pendingScope` is null on a first scope)                 | The plan's reverse-order case requires "its `request` has turn 2's text as pending scope"; the multi-turn case requires the pending scope in the request            | yes        |
| Fetch the candidate lists in parallel with `decide` and settle synchronously                                                                       | List after `decide` (adds an await between the guards and `queue.put`) | Keeps the epoch, revision and setting checks atomic with the mutations                                                                                              | yes        |
| Disable reset discards both `latestSessionKey` and the tab key                                                                                     | Only `latestSessionKey` (plan text)                                    | A reminder put under the tab key before any rekey would otherwise survive the reset                                                                                 | yes        |
| Narrow constructor types (`Pick<Logger,'warn'\|'debug'>`, `CandidateApiBuilder` for `build().agent`)                                               | Full class types                                                       | Specs need no `as unknown as` casts; `PtahAPIBuilder` and `Logger` still satisfy these types structurally                                                           | yes        |
| Cache, turn events and session-id registry injected as optional; logger, setting, scope, route, config, queue and API builder required             | All required                                                           | Plan failure behaviour: missing cache or event bus fails open; without a queue nothing can be delivered                                                             | yes        |
| Local `CANDIDATE_LISTING_BUDGET_MS = 2000`                                                                                                         | Export `MODEL_LISTING_BUDGET_MS` from lane-routing                     | The lane-routing barrel is outside my file list                                                                                                                     | yes        |
| A fallback-only result (both answers from the skill table with a cause) sets no `routedRevision`, but the attempt mark stays, so it is not retried | Retry later                                                            | D-15: no retry for the same revision                                                                                                                                | yes        |
| Log meta is `{ tabId, stage, code }`                                                                                                               | Stage only                                                             | Plan Failure behaviour names exactly these fields; the tab id is an opaque UUID, not text                                                                           | yes        |

## Hand-off for B19 and B21

- **B19 (`register-host-routing.ts`).** Register `CHAT_TOKENS.HOST_ROUTING_COORDINATOR` as a singleton of `HostRoutingCoordinator`. The coordinator resolves these tokens:
  - required: `TOKENS.LOGGER`, `LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING`, `SCOPE_CHECK_SERVICE`, `ROUTE_DECIDE_SERVICE`, `DECISION_MODEL_CONFIG`, `SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE` and `TOKENS.PTAH_API_BUILDER`;
  - optional: `LANE_ROUTING_TOKENS.PREFLIGHT_REUSE_CACHE`, `SDK_TOKENS.SDK_ADAPTER_EVENTS` and `SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY`.
- **B19 (barrel).** Export `HostRoutingCoordinator`, `AdmitUserTurnInput` and the register function from the rpc-handlers barrel.
- **B19 (`ChatSessionService`).** Inject the coordinator as optional. Call `admitUserTurn({ tabId, sessionId: null, prompt })` after `launchSdkSession` resolves, and `admitUserTurn({ tabId, sessionId: realSessionId, prompt })` after `sendMessageToSession` returns. Do not await either call (both are synchronous) and do not wrap them. Exclude Ptah-CLI and slash branches. The coordinator also skips prompts that start with `/`.
- **B19 or B21.** Call `dispose()` on shutdown, or rely on process exit; the two subscriptions are released there.
- **B19 (specs).** Any spec that imports the coordinator module needs `jest.mock('@ptah-extension/vscode-lm-tools', ...)` like these specs, or the lm-tools barrel will pull ESM-only workspace-intelligence modules into Jest.
- **B21.** Electron must call `registerLaneRoutingServices`, which provides the scope, cache, setting and route tokens. It must also call agent-sdk registration (queue, events, registry) before the coordinator resolves. Add `CHAT_TOKENS.HOST_ROUTING_COORDINATOR` to Electron's `expected-resolvable.ts` only.

## Issues outside scope

- R1: `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:24` imports a `resolveTaskKind` that `./task-kind-mapping` does not export (yet). This breaks 10 unrelated rpc-handlers suites at compile time. It belongs to the parallel Phase A fix round and was not touched.
