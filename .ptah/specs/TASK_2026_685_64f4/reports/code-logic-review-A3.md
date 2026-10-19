# Code Logic Review A3 — TASK_2026_685

Review family: Claude reviewer, codex implementer.

Score: 6/10. Verdict: REVISE (1 serious, 3 moderate, 3 minor, 0 blocking).

Scope read in full: `execution-header.component.ts`, the diffs of `agent-card.component.ts`,
`turn-disclosure-row.component.ts`, `cli-lane-usage-summary.component.ts`,
`message-summary.utils.ts`, the old `agent-card-header.component.ts`, the batch reports, plan
sections 1, 3, 3a. I ran one Jest case (`agent-monitor-panel.component.spec.ts -t "does not
auto-select session subagents"`, `--coverage=false --maxWorkers=2`). I did not read the new
specs line by line.

## Findings

### Serious

**S1. Failed, timed-out and stopped lanes now read "Worked" with no failure signal.**
`agent-card.component.ts` (laneLabel ~L221, laneMeta ~L240) maps status to a binary
running / not running. The old header (`agent-card-header.component.ts`, status badge) showed
`running | completed | failed | timeout | stopped`, with error and warning tones. In the new
header the only non-success signal is the guard stop reason (`laneGuardStopText`, which covers
only `tool-call-budget` and `repeat-call`). A lane that failed or timed out looks identical to
a success: "Worked for 2m", pulse off, a Resume button. The details dl does not show status
either. This breaks the preserve-list item "status", which the report maps to Working/Worked
only. The plan lists `Interrupted` as an `extraMeta` example, but nothing sets it.
Fix: push a status word into `laneMeta` for `failed`, `timeout` and `stopped`. Use
`metaTone="warning"` for `stopped`. Add a "Status:" row in the details dl. Add a spec for it.

### Moderate

**M1. Failure 4 root cause is an A3 change, not a pre-existing mock gap.** I ran the spec. It
passes, but it still logs `ERROR TypeError: this.agentStore.agentsById is not a function`.
Cause: `AgentCardComponent` now does `inject(AgentMonitorTreeBuilderService)` at field level
(`agent-card.component.ts:191`). That root service has a constructor effect reading
`agentStore.agentsById()` (`agent-monitor-tree-builder.service.ts:140-155`). Before A3 it was
only instantiated by `CliAgentOutputComponent`, and the panel spec's CLI agent has no output.
So every card, including the `card` presentation, now builds the service eagerly. Selecting a
CLI agent in the panel spec therefore starts the effect chain (tree builder, and the follow-up
queue service via `AgentContinueInputComponent`) that the incomplete store mock cannot serve.
The lane's statement "no A3 component adds that dependency" is wrong.
Product behaviour: the real store has both members, so I found no runtime change. The card
presentation gains a needless eager injection only.
Test health: the added `agents: ...` mock line hides one error while `agentsById` still
throws into `console.error`. The error handler swallows it, so a green test conceals an
unmocked dependency.
Fix: add `agentsById: signal(new Map())` to the mock, or stub the tree builder in the spec.
Optionally compute the lane tree only when `presentation() === 'flat'`.

**M2. Zero tokens can render as "0 tokens".** `agent-card.component.ts` laneMeta: if
`usageTotals.totalTokens === 0`, or in/out are present with a sum of 0, then `tokens` is 0 and
`0 tokens` is pushed. The requirement is that token meta is never `0`. Guard with
`tokens > 0`, as `NOT_REPORTED` semantics intend.

**M3. Partial marker only on the segment-fallback path.** If `usageTotals` exists with
`totalTokens` undefined, the fallback sum of input and output is shown without `≥`.
Low likelihood.

### Minor

- `execution-header.component.ts`: the `kind` input is declared and unused.
- `aria-controls` points at an id that does not exist while closed (`@if (open())` removes the
  region). Row `turn-disclosure-row.component.ts` always binds it. The region also has
  `role="region"` with no accessible name; add `aria-label` or `aria-labelledby`. Rendering
  nothing when closed does satisfy "hidden until open".
- The projected `ptah-cli-lane-usage-summary` and the dl are instantiated even while the region
  is closed (content projection into `@if` stays eager). The cost is small.

## Checklist results

1. Preserve list: status is degraded (S1). Stop, Resume, Remove, model, task, parent, CLI
   session, usage values, and elapsed are all present. Actions are sibling buttons with
   agent-named `aria-label`s. Elapsed is now in the label instead of a separate badge.
2. Label rule: OK. Running reads `store.tick()` and recomputes. A finished lane uses
   `agentRunLabel` and does not count up. The guard reason is warning-toned and shown only
   when not running. The token `≥` is OK except M2 and M3.
3. TurnDisclosureRow defaults: OK. `extraMeta` defaults to `[]` and the tone class applies only
   for `'warning'`, so main chat output is identical.
4. Accessibility: the action buttons are siblings of the row button, not nested. The
   `aria-controls` id matches the region id (the dangling-while-closed point is under Minor).
   The region is not rendered until open.
5. Card presentation: template unchanged except the elapsed number. The usage summary
   `duration` input is removed from both paths, and the card header still gets
   `elapsedDisplay`. Acceptable. The card path gains the eager tree-builder injection (M1).
6. Failure 4: see M1.
7. Angular rules: standalone, OnPush, signals, `model()`, no decorators, no `innerHTML`. OK.

Residual uncertainty: the new specs' assertions were not read in detail. The orchestrator ran
the full chat project suite, which passed.

## Re-review

Review family: Claude reviewer, codex implementer. Score: 8/10. Verdict: APPROVED.

Verified in the diff:

- S1: `agent-card.component.ts` `laneStatus` maps failed, timeout and stopped to Failed, Timed out
  and Stopped. They are appended to `laneMeta` and set `metaTone` to warning. A Status fact is
  added to the details dl. The guard stop reason is kept. Fixed.
- M1: `AgentMonitorTreeBuilderService` is resolved through `Injector` inside `laneNodes`, which
  returns `[]` unless the presentation is flat. Card presentation no longer instantiates it. The
  panel spec mock gained `agentsById`. I ran the single case "does not auto-select session
  subagents" (`--coverage=false --maxWorkers=2`). It passes and no `is not a function` line is
  logged. Fixed.
- M2: `tokens > 0` guard. Fixed.
- M3: the `≥` prefix is chosen by `usageTotals?.totalTokens !== undefined`, so a sum without a
  total is marked partial. Fixed.
- Minor: `data-kind` host binding and `aria-label` on the region are present. The dangling
  `aria-controls` while closed and the eager projected content remain. Both are acceptable.

Residual: the specs added in the fix were not read line by line. The orchestrator's full chat
project run passed.
