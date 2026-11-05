# AskUserQuestion session routing fix

## Root causes

1. `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1378-1393`: with no routing targets, the card fell back to the active tab without checking the request's session ID.
2. `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:119-149`: selecting a subagent hides the orchestrator transcript and its question card; the selected lane had no card.
3. `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:570-584`: answering removed the local request but left its host sourced attention projection in the sidebar.

## Changes

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`: match unresolved questions by this view's tab or session ID; preserve routed targets and workflow surface ownership.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`: show the owning session's pending question in selected agent lanes.
- `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts`: resolve question attention on answer, cancellation, automatic resolution, and session cleanup.

## Tests added

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`: owning session receives the question; an unrelated session does not.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts`: a subagent lane displays only its session's question, then removes the lane card on return to orchestrator.
- `libs/frontend/chat-streaming/src/lib/permission-handler.service.spec.ts`: answering clears a host sourced question from `needsYou` immediately.

## Verification

- `npm run verify -- -p @ptah-extension/chat,@ptah-extension/canvas,@ptah-extension/chat-streaming` — blocked before project targets: Nx daemon socket denied and Nx plugin child processes failed with `spawn EPERM`.
- `ptah_get_diagnostics` on edited files — initial result identified an incomplete new test fixture, which was fixed. Follow-up diagnostics timed out; a clean result is unavailable. Initial diagnostics also contained existing errors in unrelated spec lines.
- Electron visual inspection was unavailable because the task prohibited build, serve, dev, and e2e targets.

## Decisions

- Use request session ID as the fallback owner while router targets are unavailable. The active tab does not establish ownership. Reversible by changing the filter.
- Render the card in the selected agent lane so the user can answer without leaving that view. Reversible by switching to orchestrator on Answer.
- Resolve local and host attention sources at the request lifecycle boundary so the rail clears immediately. Reversible by coordinating a host projection event instead.

## Manual repro steps

1. Open sessions A and B, focus B, and trigger AskUserQuestion in A. Confirm the card appears only in A, including after switching tabs or canvas tiles.
2. In A, select a subagent or CLI chip, then trigger a question in A or click Answer from its sidebar card. Confirm the card is visible in the selected lane.
3. Answer the question. Confirm the card, Needs you block, Answer and Show in canvas buttons, and Needs input status clear immediately. Repeat with cancellation, automatic resolution, and session cleanup.

## Open issues

- Project verification and rendered Electron confirmation remain unverified because Nx plugin spawning failed with `EPERM` and the task forbids starting the app.

## Revision 1

1. **Late target attachment:** `chat-view.component.ts:1361` reads the routing revision before filtering. `chat.store.ts:559` exposes the handler signal. The shared matching helper at `question-visibility.ts:2` keeps router targets first and id equality as the pre-target owner. The stale active-tile comment was replaced. Regression: `chat-view.component.spec.ts:1242` reads an empty projection, attaches a target, bumps the revision and expects the card.
2. **Canvas lane routing:** `canvas-lane-view.component.ts:290-300` reads the revision and uses the same helper as chat. `chat.store.ts:561` exposes the router's workflow claim verdict, so a claimed workflow prompt stays out of the lane. Regression: `canvas-lane-view.component.spec.ts:202` covers a late router target and workflow exclusion.
3. **Resolved attention snapshot:** `notification.service.ts:29,75,138-144` retains a bounded set of locally resolved question keys and ignores stale host projections for those keys. Question ids are unique request identities; this keeps an in-flight or later `attention:getSnapshot` from restoring Needs you after answer, cancel, drop or cleanup. Regressions: `notification.service.spec.ts:50` replays a host notice after local resolve; `permission-handler.service.spec.ts:905-927` checks cancellation and session cleanup against a host-sourced needsYou row. Answer clearing remains covered at `permission-handler.service.spec.ts:568-584`.
4. **Tests and verification:** `npm run verify -- -p chat,canvas,chat-streaming,core` failed before targets ran because Nx plugin spawning returned `EPERM` (six plugin load failures). `ptah_get_diagnostics` twice returned unavailable after a 45-second TypeScript timeout; no clean typecheck result is claimed. Angular skill loading was unavailable in this lane: no skill-loading tool was listed. Electron rendering was not inspected because build, serve, dev and e2e are forbidden by the task.

The fixes remain reversible: the shared helper can be changed at one point; the bounded question tombstone can be removed if the host snapshot protocol supplies an explicit resolved generation to the renderer. The outstanding issue is verification in an environment that can spawn Nx plugin workers.
