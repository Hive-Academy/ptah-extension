# Implementation Plan Review (Revision 1): TASK_2026_580_9f77

VERDICT: REVISE

Reviewed against the worktree at `D:\projects\ptah-extension\.claude-worktrees\task-580`.
Revision 1 resolves all four prior defects. The G1 trace is accurate in code. One
new defect sits inside the new component 13. It needs one sentence in the plan
text. No other new defect was found.

## Prior defects

| #   | Prior defect                                         | Status                                           | Evidence                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | L3 archived exclusion vs "defaults unchanged"        | RESOLVED                                         | Query mode step 0 (plan :560-570); steps 1-3 gated (:571-584); handler bullet (:596); D4 effect (:135); L3/L4 reworded (:1464-1465); AC1 (:1224-1227); spec cases (:649-654); contract (:1618-1619). Code: the guarantee matches today's filter/slice path, which has no status notion (`session-rpc.handlers.ts:353-361`) |
| 2   | A1 rotation assumption contradicted its own citation | RESOLVED (the remedy carries new defect 1 below) | Gate G1 (:149-201); component 13 (:1075-1124); `rekeySession` (:436-447); capture subscription (:473-485); AC5 (:1234-1237); R1 (:1339-1347). The trace itself is correct in code — see Answers                                                                                                                            |
| 3   | Optional injection not pinned                        | RESOLVED                                         | Plan :611-625 pins `@inject(..., { isOptional: true })` and a presence-guarded `onDidChange` subscription; spec :661-665 constructs the handler with no service. Code confirms the need: `requires: []` handlers are constructed on every host (`register-rpc-surface.ts:104-127`)                                         |
| 4   | Tab-id fallback not stated                           | RESOLVED                                         | Component 7 (:737-750) names the fallback, the drop-and-log, and the no-repair rule; spec :768-770 pins the drop; failure table (:1204); R5b (:1361-1366). Code confirms the residual is real (`post-tool-use-hook-handler.ts:77-87`; `sdk-agent-adapter.ts:1150-1154`)                                                    |

## Answers

**2. The G1 trace.** Verified end to end in code.

- Every system `init` message calls `onSessionIdResolved(tabId, realSessionId)`
  (`stream-transformer.ts:472-477`). Verified.
- New-chat path: `bindRefused` accepts `bound`, `already-bound` and `rebound`
  (`sdk-agent-adapter.ts:1197-1203`); `metadataStore.create` makes a new record
  for an unknown id and preserves an existing one
  (`session-metadata-store.ts:1061-1091`). Verified.
- Resume path: `resumeCallback` only calls `metadataStore.touch`
  (`sdk-agent-adapter.ts:1027`), and `touch` is a no-op for an unknown id
  (`session-metadata-store.ts:879-887`). So a resume can never create a record
  under a new id. Verified. One nuance the plan does not state: the resume path
  also passes through `bindRefused` (`sdk-agent-adapter.ts:1017`), so a resume
  with `forkSession: true` would produce `'rebound'` there. The plan's
  no-rekey-on-resume choice is still correct: neither the metadata row nor the
  organization rows move on that path, so they stay consistent under the old id.
  No action needed.
- `'rebound'` is the only same-record id change: the rebind requires the owner
  token (`session-registry.service.ts:310-324`, rebind at :321), and the comment
  at :312-314 names resume + `forkSession` as the cause. `realSessionId` starts
  null (:59-60), so a first `init` on a fresh record is `'bound'`. `/clear` is
  intercepted as a native command and starts no query
  (`chat-session.service.ts:473-483`). Verified.
- No production caller passes `forkSession: true`: a repo-wide grep finds only
  the threading sites (`session-lifecycle-manager.ts:608`;
  `sdk-query-options-builder.ts:1311,1427`). User forks go through the
  `SdkAgentAdapter.forkSession` facade to `SessionForkService`
  (`sdk-agent-adapter.ts:1345-1355`). Verified.
- Component 13 and `rekeySession`: the payload type is additive
  (`session-id-resolved-callback-registry.ts:44-58`); the registry token exists
  (`agent-sdk/src/lib/di/tokens.ts:145`); the "synchronous handler" contract is
  real (`session-id-resolved-callback-registry.ts:26-27`); `rekeySession`
  handles collisions and no-ops (plan :436-447); the capture subscription is
  wired (plan :473-485). Verified.
- The residual in R1 (:1345-1347) is handled by component 13 itself: a second
  `init` inside one process arrives through the same callback with the same
  owner token, so the registry reports `'rebound'` and the rows re-key. Good.

The flaw is in component 13's `bindRefused` change — see New defects.

**3. The `sdk-agent-adapter.ts` merge point with 584.** Compatible in either
merge order. 584 Component 1 (584 plan :231-237) changes the
`createSessionIdCallback` signature (a new `workingDirectory` parameter) and the
`metadataStore.create(...)` argument list. 580 component 13 changes
`bindRefused`'s result shape and the `notifyAll` payload, plus one read of
`find(tabId)` before the bind. The two edits touch different statements in the
same function. The `create` line (`sdk-agent-adapter.ts:1140`) is edited only
by 584; 580 only cites it. Plan :1445-1452 states this correctly.

**4. Sidebar query mode.** Consistent and intended. The guarantee
(plan :1618-1619) is scoped to callers that send no new params — the existing
programmatic callers. `ClaudeRpcService.listSessions` sends only
`workspacePath`, `limit`, `offset` (`claude-rpc.service.ts:254-264`), so it
stays outside query mode. The sidebar is the query-mode consumer by design:
L3's own reason is "Archiving shortens the organized sidebar list, and existing
callers see no change". So in Electron, hidden archived rows and pinned-first
on the sidebar are the feature, not a break of the guarantee. In VS Code the
sidebar also sends `sort` and enters query mode, but the filters apply "only
when the map is present" (plan :571-572) and the default sort reproduces today's
order, so the VS Code result is unchanged (plan :962-968, :1653-1656). The plan
states all three pieces explicitly. No defect.

## New defects

1. **Major — Component 13's `bindRefused` result change breaks the resume call
   site that the plan says is "unchanged".**

   - Plan: component 13 (:1085-1088) changes `bindRefused` to "return the bind
     outcome instead of a boolean, e.g. `{ refused: boolean; outcome:
BindRealSessionIdOutcome }`", and :1096-1098 says "`resumeCallback`
     (:1002-1039) is unchanged".
   - Code: `bindRefused` has exactly two call sites. The resume path checks the
     result for truthiness and returns early:
     `if (tabId && this.bindRefused(tabId, realSessionId, sessionToken))`
     (`sdk-agent-adapter.ts:1017-1019`). An object result is always truthy, and
     TypeScript raises no error for this check.
   - Scenario: the executor follows the plan. `resumeCallback` stays as it is.
     Then every resume with a tabId returns early at :1017. The code skips
     `metadataStore.touch` (:1027), `emitSessionIdResolved` (:1029) and
     `sessionIdResolvedRegistry.notifyAll` (:1034-1038). The webview stops
     learning the resolved id on resume. Memory and skill reconciliation stops.
     `lastActiveAt` stops updating. The failure is silent: the stream itself
     continues.
   - Impact: every resumed session in every host. Existing adapter specs may
     catch it, but the plan text must not depend on that.
   - Fix: component 13 must state that BOTH call sites adopt the new result
     shape — `:1017` becomes `if (tabId && this.bindRefused(...).refused)` — or
     keep `bindRefused` boolean and add a separate outcome-returning method used
     only by the new-chat path. Add one spec line: a successful resume still
     notifies.

## Notes

- The G1 trace citations are accurate. One path prefix is imprecise: the plan
  cites `session-lifecycle/session-registry.service.ts`; the file lives at
  `agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts`. An
  executor can find it by name. Not counted as a defect.
- Verified beyond the checks: D4 effect column reworded (:135); the AC8
  data-flow row for the re-key path (:1162); the R1 residual that the old
  metadata record stays as a second sidebar row (:1342-1344) matches existing
  `SessionMetadataStore` behaviour, because `create` for a new id never removes
  the old record (`session-metadata-store.ts:1061-1091`); batch A2 carries
  component 13 and stays file-disjoint from B1 (:1520, :1541-1543).
- Suggested disposition: REVISE, one edit. Fix new defect 1 in component 13.
  Everything else in Revision 1 is ready.
