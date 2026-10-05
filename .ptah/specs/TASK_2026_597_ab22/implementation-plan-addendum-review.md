# Review - implementation-plan-addendum-n7-n8.md (TASK_2026_597_ab22)

| Field             | Value                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Artifact          | `implementation-plan-addendum-n7-n8.md`                                                                       |
| Author            | software-architect subagent                                                                                   |
| Reviewer          | independent document reviewer (Claude subagent, same-side; reason: the user disabled CLI lanes for this task) |
| Artifact revision | 1                                                                                                             |
| Round             | 1                                                                                                             |
| Base              | current HEAD `30108c20c`                                                                                      |
| Verdict           | **REVISE** (4 Serious, 8 Moderate, 3 Minor; no Blocking)                                                      |

The central design is sound and matches the user's instruction. The budget reads the same frozen `SessionStatsEntry`
the chat installs, so it adds no second counter. Provider-reported cost is used where it exists, and weighted tokens
are only a fallback. Four Serious defects stop the guarantee that "the limit and the chat display can never disagree"
from holding in practice:

- the session key (F1);
- the resume/reload path (F2);
- the `/compact` exemption (F3);
- the RPC manifest in the batch split (F4).

## Evidence spot-check (verified on HEAD)

| Claim                                                                                                                             | Result                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The summary renders only `snapshot().tokenCount` / `totalCost`, with a `knownCost` subtotal                                       | Holds: `session-stats-summary.component.ts:669, 761, 768-776, 790-794`                                                                                                                                                                                                                |
| `tokenCount` counts all four classes                                                                                              | Holds: `session-usage-aggregator.ts:432, 461` (`tokenSum`); owner run contribution `session-stats-owner.service.ts:837-838`                                                                                                                                                           |
| TOKENS and COST include subagents, live and from history                                                                          | Holds. Live: `modelUsage` is cumulative per query with subagents (`stream-transformer.ts:653-655, 684-689`). History: parent and every subagent ledger (`session-usage-aggregator.ts:243-250`)                                                                                        |
| COST source: `'reported'` only on direct Anthropic; every other route is rate-card priced; the history prefix is always rate-card | Holds: `session-query-executor.service.ts:65-80`; `session-stats-owner.service.ts:239-259`; `session-usage-aggregator.ts:252-292`                                                                                                                                                     |
| `totalCost` is `null` unless pricing is `full`, or when a run is incomplete                                                       | Holds: `session-usage-aggregator.ts:279-292`; `session-stats-owner.service.ts:680-692`                                                                                                                                                                                                |
| The snapshot object the backend would read is the one the webview gets                                                            | Holds for the live path only. `publish()` returns a frozen object (`session-stats-owner.service.ts:675-698`), passed into `onResultStats` (`stream-transformer.ts:788-791`) and broadcast unchanged (`sdk-callbacks.ts:409-418`). It does **not** hold for the load/resume path (F2). |
| `snapshot()` returns `null` while the prefix is in flight                                                                         | Holds: `session-stats-owner.service.ts:562-572`                                                                                                                                                                                                                                       |
| `applyFlagSettings({effortLevel})` only; SDK `autoCompactWindow` exists                                                           | Holds: `session-lifecycle-manager.ts:86`, `session-control.service.ts:499`. The pinned SDK is 0.3.278 and `sdk.d.ts:8578` has `autoCompactWindow?: number`. E2 says the source honours it (`research-report.md:96`). AS-B1 is feasible.                                               |
| `emitCompactionComplete` carries `compactSummary`                                                                                 | Holds: `compaction-hook-handler.ts:463-469`; `sdk-adapter-events.service.ts:131, 181`                                                                                                                                                                                                 |
| `ChatContinueResult.errorCode`, `ChatStartParams.prompt`, `stopSubagent`, `.gitignore` `.ptah/**`, `~/.ptah` root                 | All hold (`rpc-chat.types.ts:44-46, 162-170`; `subagent-message-dispatcher.ts:258`; `.gitignore:135`; `content-download.service.ts:98`)                                                                                                                                               |
| `/compact` is a native command that bypasses the SDK                                                                              | **Wrong.** `NATIVE_COMMANDS = new Set(['clear'])` (`slash-command-interceptor.ts:37`). See F3.                                                                                                                                                                                        |
| Calibration arithmetic (32.8M weighted; $0.64/M; 50M ≈ 8.8M weighted ≈ $32)                                                       | Correct                                                                                                                                                                                                                                                                               |

## Findings

### F1 - Serious - Budget state is keyed by the wrapper id, which is the tracking id for new sessions

The addendum calls `sessionBudget.observe(sessionId, stats.sessionStats)` from `wrapResultStatsForActivity`, and calls
`release` from the session end (component 5). For a new session the wrapper is created with `trackingId`
(`sdk-agent-adapter.ts:796-798`), not with the SDK session id. `chat:continue` checks `canSend(params.sessionId)`, which is
the real id. A brand-new session would then never be blocked, and `session:getBudgetState` would return `null` for it.

Fix: key all state by `stats.sessionId` / `snapshot.sessionId` (the transformer's `effectiveSessionId`). The parity spec
must cover the new-session path with a tracking id different from the resolved id.

### F2 - Serious - The load/resume path shows TOKENS but the budget is `unknown` and sending is allowed

On reload or resume the chat installs a snapshot with no SDK result at all:

- `session-loader.service.ts:1033` calls `tabManager.applyLoadedSessionStats` (`tab-manager.service.ts:2216`);
- that snapshot comes from `session:stats-batch` / `statsReader.readStats` (`session-rpc.handlers.ts:1154`).

`SessionBudgetService` only learns a figure from `onResultStats`. After a restart, a session the chip shows at 120 M
TOKENS therefore has no stage, no banner and no chip budget, and `canSend` is ok. Its first `chat:continue` sends a
full turn at the largest context. Integration § State calls this "recomputed on the next result", but that is one
full over-limit turn plus a display that disagrees.

Fix: `canSend`, `getBudgetState` and the stage evaluation must fall back to the same figure the chat installed when no
live state exists:

- `statsOwner.snapshot(sessionId)` when an owner exists;
- else the stats reader's `session` scope aggregate (the object `applyLoadedSessionStats` received).

Specify this and add it to the parity spec.

### F3 - Serious - `/compact` is not native; the gate exemption as written is wrong

Component 8 says "native slash commands (`/compact`, `/clear`, … `NATIVE_COMMANDS`) pass". `NATIVE_COMMANDS` is only
`clear` (`slash-command-interceptor.ts:37`). `/compact` goes to the SDK through `routeFollowUpSlashCommand`
(`chat-session.service.ts:864`), and the resume decision is classified before it (`:836-842`).

The plan therefore fails one of two ways:

- If the exemption is keyed on `NATIVE_COMMANDS`, it blocks `/compact`, which breaks the promise in the limit text.
- If it is keyed on `isSlashCommand`, every custom slash command passes. Custom commands expand into full model turns.

Fix: an explicit allowlist (`/compact`, `/clear`), checked before the resume/slash branch. Spec both cases, plus a
custom command that is blocked.

### F4 - Serious - The batch split breaks the RPC manifest "Total" invariant and omits `manifest.ts`

Batch 51 adds `session:getBudgetState`, `session:budgetAction` and `session:getHandoff` to `RPC_METHOD_ENTRIES`
(shared). The handler class lands only in Batch 55.

`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:14-18` requires the union of the manifest entries to equal
`RPC_METHOD_NAMES` exactly. Other specs enumerate the methods too:

- `rpc-allowlist.spec.ts`;
- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` and `apps/ptah-electron/src/di/rpc-surface.spec.ts`;
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`.

The effect on the batches:

- Batch 56 runs `-p @ptah-extension/rpc-handlers` in parallel with 55, so it fails on a defect it did not cause.
- Batch 55's file list has no `manifest.ts` entry and no allowlist or surface spec updates.

Fix: move the method-map additions into Batch 55, or keep only the type files in 51. Add `host-profile/manifest.ts` and
the allowlist and surface specs to Batch 55. Add `@ptah-extension/cli-engine` and the app specs to its verify step.

### F5 - Moderate - The meaning of an absent snapshot is underspecified and could unblock a session

`sdk-callbacks.ts:416` says "Absent → the panel keeps its last one". Component 3 says "no snapshot → stage `unknown`;
no action; never blocks". A later result with no `sessionStats` can be a duplicate, a stale owner, or a turn with no
usage (`stream-transformer.ts:697-746, 778-781`). Read literally, such a result would reset a `limit` state to
`unknown`.

Fix: an absent snapshot keeps the last state. `unknown` applies only before the first figure (see F2). The stage
function must ignore a lower `revision`, as `installSessionStats` does (`tab-manager.service.ts:2196-2209`).

### F6 - Moderate - The cost-unit fallback replaces a figure the chat does show, and its label can be false

When `totalCost` is `null` but `pricingCoverage === 'partial'`, the chat shows "cost unavailable" with a labelled
`knownCost` subtotal (`session-stats-summary.component.ts:768-776`). The addendum then switches to weighted tokens
against a different limit (9M). Three problems follow:

- **Second figure:** a figure the chat does not display, when a displayed lower bound already exists.
- **False label:** "this provider reports no cost" is untrue when `null` comes from an unpriced model or an incomplete
  run on the direct route (`session-stats-owner.service.ts:680-692`).
- **Measure flapping:** the measure can flip between cost and weighted from turn to turn.

There is also a gap in the contract. The chip's `budget` input (`{unit, limit, stage, lowerBound}`) has no `used` or
`measure` field, so the chip would have to recompute weighted tokens itself.

Fix:

- use `knownCost` as a labelled lower bound (`≥`) when coverage is `partial`;
- use weighted tokens only when `pricingCoverage === 'none'`;
- pass `used` and `measure` in the chip input;
- make the label text depend on the reason;
- once a session uses the fallback, keep the measure for it until a settings change.

### F7 - Moderate - A held mid-turn follow-up is always sent on the turn that crosses 100% (AS-B4 is under-specified)

`onTurnEnd` fires before stats are computed (`stream-transformer.ts:514-516`). `onResultStats` runs later, after the
pricing awaits (`:788`). `releaseTurnOnResult` (`sdk-agent-adapter.ts:~1597`) sends a held follow-up straight to the SDK
and bypasses `chat:continue`. So `observe` always sees the crossing result after the follow-up has already been sent.

AS-B4 only says "grep `surface-submit-turn.service.ts`". Fix: name this path. Either check `canSend` against the
pending snapshot before the release, or accept and document a two-turn overshoot. Spec the chosen behaviour.

### F8 - Moderate - The compaction trigger uses PostCompact, an in-memory count, and interacts with the tighten stage

There are four problems with how compactions are counted:

- **Event source:** the count comes from `onCompactionComplete` (PostCompact). `research-report.md:100` records PostCompact
  missing in four August auto events and recommends `compact_boundary`.
- **Subagent compactions:** they may arrive under the same session id. The addendum does not say whether they count.
- **Restart reset:** the count resets on restart, so it can differ from the chat's `compactionCount`
  (`chat-view.component.html:30`). That is a second "compactions" figure.
- **Tighten interaction:** lowering the window at 50% causes more compactions, so the third compaction (handoff) comes
  sooner. That may be intended, but it is not stated.

Fix:

- count from `compact_boundary`, main loop only;
- state whether the count survives a restart (it could be derived from the transcript's boundaries, as the chat does);
- state the tighten → handoff interaction in the user text.

### F9 - Moderate - The item-10 "session + subagents total for information" is dropped silently; Decision 2 overstates "cannot separate"

Item 10 (`context.md:134-135`) says two things:

- subagents are not in the main limit by default;
- a "session + subagents" total is shown for information.

The coordinator's later instruction (same figure as the chat) reasonably wins on the limit, and Decision 2 is a real
conflict. But the addendum says "live data cannot separate them". Component 6 itself keeps per-subagent usage in the
monitor, and the history ledgers are already separate. A subagent share is available. It would be approximate and
would not be a limit figure.

Fix:

- record that the information total is already what TOKENS shows;
- add the option "count the displayed figure and show the subagent share (from the monitor) for information";
- reword "cannot separate" to "separating needs a second, approximate figure".

The recommendation itself is justified.

### F10 - Moderate - Missing batch dependencies and a scoped-check gap

| Batch   | Gap                                                                                                                                                                                                                                                                                        | Fix                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 57 / 58 | Modify `providers-settings-state.service.ts` and `orchestration-settings.component.ts`, which Batch 39 also changes. Neither batch depends on 39.                                                                                                                                          | Add 39 to both.                                                                                                                                        |
| 53      | Modifies `session-query-executor.service.ts`, which Batches 27, 28 and 35 also change. 53 depends on 27 and 28 only.                                                                                                                                                                       | Add 35.                                                                                                                                                |
| 51      | Widens the A6 payload union in `sdk-hook.types.ts` (Task 29.1). The consumers are 29.2 (agent-sdk), 30.1 (rpc-handlers) and 31.2 (chat). Narrowing on `kind` can break them. 51 verifies only shared and platform-core plus the three apps, and none of those apps is the Angular webview. | Add `@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers` and `@ptah-extension/chat` typecheck to 51, or update the consumers in the same batch. |

### F11 - Moderate - The agent card would show two context figures, and the delivery path for running subagents is undefined

Batch 46.2 computes `contextTokens` in the frontend store (`batches.md:2431-2438`). Component 9 adds the backend
`budget.contextTokens` to the same card, and the header shows "context 82k/150k". One figure must be named as the
source; the backend one is preferable, so drop or alias the 46.2 field.

The second gap is delivery. The Batch 41.2 RPC returns the resumable-subagent list. The addendum does not say how a
running subagent's `budget` and `resumeAdvice` reach `MonitoredAgent` (event, poll or RPC).

### F12 - Moderate - Session id used in a file path without format validation

`~/.ptah/handoffs/<sessionId>.md`, with `session:getHandoff` validated only as a "session id string". Fix: validate the
id as a UUID (zod `.uuid()` or the repo's existing session-id guard) before any path join or read, and resolve the
path and assert it stays under the handoffs directory.

### F13 - Minor - Decision 1 should address "provider-reported cost preferred" directly

The user said provider-reported figures are preferred, yet the recommendation is TOKENS. The rationale is in the
option text (COST is reported only on direct Anthropic; the history prefix is always estimated), but it should be
stated as the reason for departing from the stated preference. Also note that on the direct route with subscription
auth, the "reported" dollars are API-equivalent, not billed.

### F14 - Minor - Tighten and restore details

- **Tighten text:** lowering the window to 120k while the context is above 120k compacts on the next request. Say so
  in the tighten text.
- **Restore:** `restore-window` re-applies `compaction.threshold` or "the class default". With A1 defaults `null`,
  the pre-tighten effective value was the SDK default, which may not be 200k on 1M-context models. Capture the
  pre-tighten value, or send "unset" if the SDK accepts it.

### F15 - Minor - Handoff files have no retention, and the location is a silent choice

`~/.ptah/handoffs/` grows forever. Fix: add a cap, for example the newest 50 files or 30 days, or document it. Item 10
says only "Ptah writes `handoff.md`". Placing it beside the task folder, when one is detected, is a plausible user
expectation in this repo. Mention it in Decision 3, or justify the home-dir choice in the user text.

## Repo rules

All four hold:

- **Placement:** settings live in the platform-core file store, contracts in shared, services in agent-sdk, and RPC in
  rpc-handlers.
- **No vscode-core deepening:** component 7 reads the Batch 40 registry state through the existing path and adds
  nothing to vscode-core.
- **Frontend:** OnPush and signals are stated.
- **File access:** `fs/promises` in agent-sdk has precedent (`attachment-processor.service.ts`,
  `session-stats-reader.service.ts`).

## Decisions for the user

All four are real decisions.

| Decision | Assessment                                                     |
| -------- | -------------------------------------------------------------- |
| 1        | Justified; tighten the rationale (F13).                        |
| 2        | Justified; reframe per F9.                                     |
| 3        | Fine. Optionally add the handoff location (F15).               |
| 4        | Fine. It depends on F2 and F3, without which "pause" is leaky. |

## Required for round 2

- Resolve F1-F4.
- Address F5-F12, or record each as an accepted risk with its reason.

## Review round 2

Artifact revision 2 (`implementation-plan-addendum-n7-n8.md`). Re-review of the plan only; scope limited to F1-F15 plus
the five checks the coordinator listed. Verdict: **APPROVED** (0 Blocking, 0 Serious new; 2 Moderate residuals noted).

### F1-F15

| Finding                      | Status   | Note                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 key by wrapper id         | RESOLVED | Keyed by `snapshot.sessionId`; AS-1 plus an adapter parity spec with tracking id different from the real id (Comp. 3, 6).                                                                                                                                                                                                                     |
| F2 resume path               | RESOLVED | `observeLoaded` at the resume read (Comp. 8) and `canSend` falls back to `statsOwner.snapshot` (Comp. 3). The fallback does not name the stats reader aggregate for a session with no owner and no resume call, but `chat:resume` always runs `observeLoaded` first, so the gap is theoretical.                                               |
| F3 `/compact` not native     | RESOLVED | Explicit `/compact` and `/clear` allowlist, checked before the slash/resume branch; custom commands blocked and specced (Comp. 8).                                                                                                                                                                                                            |
| F4 RPC manifest              | RESOLVED | Cut to one new method; the method map and the handler, manifest, allowlist and three surface specs are one unit; settings use existing `settings:get/set` (Comp. 1, 8, handoff).                                                                                                                                                              |
| F5 absent snapshot           | RESOLVED | Absent keeps state; lower revision ignored; `unknown` only before the first figure (Comp. 3).                                                                                                                                                                                                                                                 |
| F6 cost fallback             | RESOLVED | `knownCost` lower bound at `partial`; weighted only at `none`; sticky measure; `used` and `measure` in the state and chip input; label by measure (Comp. 3, 9).                                                                                                                                                                               |
| F7 held follow-up            | RESOLVED | Accepted and specced as a bounded overshoot (crossing turn plus one held follow-up) and stated in the limit text.                                                                                                                                                                                                                             |
| F8 compaction source         | RESOLVED | `compact_boundary`, main loop, reset on restart documented, tighten-to-handoff interaction in the text; AS-2 carries the subagent check.                                                                                                                                                                                                      |
| F9 info total                | RESOLVED | Decision 2 reworded ("second, approximate figure"), optional labelled share offered, TOKENS recorded as the information total.                                                                                                                                                                                                                |
| F10 batch dependencies       | PARTIAL  | Replaced by component-level ordering and a same-unit typecheck rule, which covers the A6 payload widening. The shared-file overlap with the deferred Batch 39 (`orchestration-settings.component.ts`, `providers-settings-state`) is not named; the team-leader must add it when building the batch table. Moderate, not blocking for Gate 2. |
| F11 two context figures      | RESOLVED | Backend figure is the one source, Batch 46.2's frontend field replaced, event delivery chosen over poll (Comp. 10).                                                                                                                                                                                                                           |
| F12 id in path               | RESOLVED | `UUID_REGEX` check and confined resolve (Comp. 5, 8).                                                                                                                                                                                                                                                                                         |
| F13 reported-cost preference | RESOLVED | Stated as the reason in Decision 1, including the subscription "API-equivalent" caveat.                                                                                                                                                                                                                                                       |
| F14 tighten/restore          | RESOLVED | Text says the next request compacts when above target; restore sends the configured value or `null`, never a guessed class default (Comp. 4).                                                                                                                                                                                                 |
| F15 retention/location       | RESOLVED | Newest 50 files, location is Decision 3 option 2.                                                                                                                                                                                                                                                                                             |

### Additional checks

- **Same snapshot as the chat UI.** Spot-checked 5 contracts on HEAD `5bb19f9fb`: `NATIVE_COMMANDS = new Set(['clear'])`
  (`slash-command-interceptor.ts:37`); `wrapResultStatsForActivity` at `sdk-agent-adapter.ts:1581-1591` passes `stats`
  through, so the `{...stats, budget}` wrap is a small additive change; broadcast forwards `sessionStats` unchanged and
  absent keeps the panel's last (`sdk-callbacks.ts:409-418`); the knownCost subtotal shows only at `partial`
  (`session-stats-summary.component.ts:765-776`); the resume snapshot is `statsOwner.snapshot(...) ?? prefix`
  (`session-history-reader.service.ts:1008-1016`); `compact_boundary` branch at `stream-transformer.ts:795`. All hold. The
  numerator is `tokenCount` / `totalCost` of the same object and is never recomputed. PASS.
- **A1 and E2.** A1 defaults stay `null` and untouched (stated in Quality and Verification). The tighten is off by default
  (`tightenWindowTokens = null`); when enabled it verifies by `getContextUsage()` read-back and reverts to `null` on a
  miss, so nothing assumes `autoCompactWindow` is honoured. PASS.
- **TASK_2026_609 files.** No agent-generation, `.claude/agents` or system-prompt changes. Component 4 touches
  `session-control.service.ts`, `session-lifecycle-manager.ts` and `session-registry.service.ts`, not
  `sdk-query-options-builder.ts`. The shared `file-settings-keys.ts` is flagged append-only. PASS.
- **Gate 2 decisions.** Four clear decisions, each with a recommended first option and a stated trade-off. PASS.

### New findings

None Blocking or Serious. One Moderate residual (F10 above) and one note: `sessionBudget.enabled` only takes effect "on
the next figure" (Failure and rollback), so toggling it off while a session is already at `limit` still blocks until a
result or a resume arrives; the team-leader should make `canSend` read the setting directly.

### Verdict

APPROVED for Gate 2. 15 findings: 14 RESOLVED, 1 PARTIAL (F10), 0 OPEN; 0 new Blocking, 0 new Serious.
