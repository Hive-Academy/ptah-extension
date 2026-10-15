# Batch A1-2 report: turn molecules (chat)

Executor: frontend-developer (Claude). Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view`.
Status: implemented. No nx / jest run (decisions.md row 59); the team-leader MODE 2 runs the scoped checks.

## Files (all CREATED, under `libs/frontend/chat/src/lib/components/molecules/turn/`)

- `turn-disclosure-row.component.ts` - `ptah-turn-disclosure-row` (§3.2). Inputs: `open` (false), `label`
  (required, `turnElapsedLabel(...).text`), `live` (false), `toolCount` (0), `filesChanged` (0), `peek`
  (`string | null`), `controlsId` (required), `viewMode` (`'full' | 'compact'`, 28 px tall in compact). Output:
  `toggled: boolean` (the requested open state, `!open()`).
- `turn-activity-panel.component.ts` - `ptah-turn-activity-panel` (§3.11). Inputs: `turn: TurnContext`
  (required), `panelId` (required, the `aria-controls` target). No output. Renders nothing when every item is unknown.
- `turn-live-line.component.ts` - `ptah-turn-live-line` (§3.7). Inputs: `startTs` (`number | null`), `now`
  (transcript clock), `needsYouCount`. No timer of its own.
- `turn-agent-chips.component.ts` - `ptah-turn-agent-chips` (§3.5). Input: `agents: readonly SessionAgent[]`.
  Output: `laneRequested: string` (the `SessionAgent.key`). Avatar size 24 binding `kind`, `status`, `cliId`,
  `agentType`.

No barrel touched, no spec added or changed, no other file touched. A1-3 imports these by relative path inside
`@ptah-extension/chat` (`../molecules/turn/...` from `organisms/`). No barrel export is needed for A1-3; none
requested from B-4.

## Imports used (verified in source)

- `@ptah-extension/chat-ui`: `AgentAvatarComponent`, `agentAccessibleLabel`, `formatAgentDuration`,
  `formatTokenCount`, `type AgentStatusWord` (`libs/frontend/chat-ui/src/index.ts:163-188`).
- `@ptah-extension/shared`: `formatUsdCost`, `formatDurationMs` (`libs/shared/src/lib/utils/index.ts:30`),
  `type MessageTokenUsage`.
- Relative, same lib: `summarizeTurnMetrics`, `TurnContext`, `TurnMessageMetrics`
  (`utils/turn-facts.utils.ts`, A1-1); `type SessionAgent` (`services/session-agents/session-agent-roster.ts:22`).
- Tokens: `bg-state-run`, `text-state-*`, `surface-*`, `base-content-muted` (`apps/ptah-extension-webview/tailwind.config.js:31-41`);
  `--surface-highlight`, `--surface-border-strong` (`apps/ptah-extension-webview/src/styles.css:146-153`);
  `--ptah-ease-soft` is defined on the transcript / chat-view hosts only (`chat-transcript.component.css:2`), so the
  component CSS uses it with the same cubic-bezier as fallback.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                           | Options                                                                | Evidence                                                                                                                                            | Reversible |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Disclosure count meta takes two numbers `toolCount` / `filesChanged` instead of a preformatted `meta` string                                                                                                                                                                       | (a) two primitives [chosen]; (b) `meta: string` (plan A1:34 name)      | the component must build both the visible `6 tools · 3 files` and the accessible `…, 6 tools, 3 files` (§3.2); primitives keep OnPush inputs stable | yes        |
| 2   | Disclosure order: [live dot] label [timer] chevron [peek] meta                                                                                                                                                                                                                     | (a) label before chevron [chosen]; (b) chevron first (§3.2 text order) | prototype `index.html:162-166` and `reference/01-clean-chat-turns.png` both show `Worked for 4m 12s ›`                                              | yes        |
| 3   | While live, the label is split at the first `·`: the head (`Working`) is the accessible name, the timer is `aria-hidden`; accessible name set via `aria-label` = head + meta parts joined by `, `                                                                                  | (a) split in the row [chosen]; (b) separate `timer` input              | §3.9 "ticking … aria-hidden"; `turnElapsedLabel` returns one string `Working · 1m 05s` (A1-1); avoids a second input contract                       | yes        |
| 4   | Activity panel computes `Duration` itself from `turn.startTs` / `turn.settledEndTs` via `formatAgentDuration(E - S)` (omitted when null, i.e. not derivable or under 1 s); no `durationLabel` input                                                                                | (a) derive in panel [chosen]; (b) `durationLabel` input (plan A1:134)  | §3.11 "the label value of 3.9"; prototype dd shows `4m 12s` (not `Worked for …`); one source (`TurnContext`)                                        | yes        |
| 5   | Single-message turn renders exactly the spec's `<dl id aria-label="Turn activity">`; N > 1 renders a `div role="group" aria-label="Turn activity"` holding an `<h4>All messages</h4>` + summary `<dl aria-labelledby>` and one `<section aria-label="Message n of N">` per message | (a) chosen; (b) `<dt>` heading inside the summary `dl` (§3.11 wording) | a `dt` without a `dd` is invalid in a `dl`; `h4` matches the per-message `Message n` heading recipe                                                 | yes        |
| 6   | Message duration items (`Message duration`, per-message `Duration`) use `formatDurationMs` (today's B-12 badge format); the turn `Duration` uses `formatAgentDuration`                                                                                                             | -                                                                      | §3.11 "today's B-12 badge value and format"; `duration-badge` uses `formatDurationMs`                                                               | yes        |
| 7   | `Tool calls` / `Files changed` omitted when 0; a per-message section with no known item is omitted (numbering kept)                                                                                                                                                                | -                                                                      | §3.11 "never `0` or a placeholder", "items unknown for a message are omitted for that message only"                                                 | yes        |
| 8   | Chips show `· {duration}` after a settled status word (`done`/`failed`/`stopped`) when both `startedAt` and `endedAt` are known; running chips show no time (no per-item timer)                                                                                                    | (a) chosen; (b) status word only (§3.5)                                | §3.9 "each chip shows its own `done · {duration}`"; runtime rule: no timer per list item                                                            | yes        |
| 9   | Chip accessible name = `agentAccessibleLabel({name, kind, status, durationMs}) + '. Open lane'`                                                                                                                                                                                    | -                                                                      | §3.5 `{name}, {kind}, {status}. Open lane`; shared C-1 builder                                                                                      | yes        |
| 10  | Live line pulse ring in component CSS (`::after`, transform + opacity only, 1.6 s, scale .6 -> 1.25, opacity .55 -> 0), off under reduced motion; disclosure live dot uses `animate-pulse motion-reduce:animate-none` (opacity only)                                               | -                                                                      | §3.7; runtime rule (infinite animations on compositor properties only)                                                                              | yes        |

## Deviations

1. Plan A1:34 `meta` input -> `toolCount` + `filesChanged` (Decision 1). Plan A1:134 `[durationLabel]` -> not an
   input (Decision 4). A1-3 binds: `[turn]`, `[panelId]` on the panel; `[toolCount]`/`[filesChanged]` from
   `summarizeTurnMetrics(turn)` (or `messageSummary()`) on the row.
2. Added `viewMode` input to the disclosure row (28 px in compact, §3.8) - not in the plan's input list.

## Notes for A1-3 (consumer)

- Disclosure `(toggled)` emits the requested open state; map it to `logToggled.emit({ turnId, open })`.
- Pass `peek` only in `compact` mode while live (§3.8); pass `null` otherwise.
- Live line `now` must come from the single transcript clock; the component starts no timer.
- Chips: pass only the roster entries whose key matches a `sub:` / `bg:` lane of the turn (plan §2.2); the chip
  row renders nothing for an empty list.
- Panel: render it only when `activityOpen()`; give the `Show activity` button `aria-controls` = the same `panelId`.

## Verification

- `ptah_get_diagnostics` with `files` = the 4 new files (typescript-compiler, coverage clean): **no diagnostics
  in the requested files**. This is a `tsc` check; Angular template type-checking (strictTemplates) is not covered
  by it and runs only in the team-leader's `nx typecheck` / `nx test`.
- Same run, sibling files not owned by this batch (reported, not fixed): pre-existing spec type errors (e.g.
  `agent-card-truncation.spec.ts:137`, `tab-bar.component.spec.ts:178`, `send-message-chip.component.spec.ts:6`),
  and one NON-spec error: `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:755`
  `Cannot find name 'Send'` (TS2304) - composer file, likely A2-2 in flight; flag for A2-2 / MODE 2.
- `npx prettier --write` on the 4 new files and this report (formatting only).
- nx test / typecheck / lint: not run (decisions.md row 59); the batch's Scoped checks are for MODE 2.

## Open items

- None blocking. `chat-input.component.ts:755` (above) is outside this batch.
