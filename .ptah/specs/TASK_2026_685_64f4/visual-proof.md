# TASK_2026_685 — visual proof and header prototype

Session: child session "685 lane header proof", branch `docs/lane-header-proof` (base `ff9ec5fec`).
All `file:line` references below are from this worktree. No production source changed.

## Status of the Electron capture

Parent decision: this session does not launch Electron. The parent's visual-reviewer takes the
real-app screenshots (Part 1) after the TASK_2026_683 recordings free Electron, and writes them
into `screenshots/` of this worktree. Until then, the prototype "before" panels are rebuilt from
the current templates and from the values in the user's report (`completed`, `71h 18m`,
`ctx — in ≥ 11.9k out ≥ 56 —`, `Parent: 18e50e43…`, `pong`). They are marked as rebuilt.

## Screenshots

### Shots to capture (parent's visual-reviewer)

Themes: `anubis` (dark) and `anubis-light` (light). Widths: 1440 and 760 (window width).
Use the private profile copy only. Use the same agents in every shot of one lane kind, so the
values can be compared side by side. If the profile has no such run, record that in this table
and do not fake data.

| File | Lane kind | Theme | Width | What must be visible |
| --- | --- | --- | --- | --- |
| `current-cli-dark-1440.png` | CLI (codex), finished | dark | 1440 | Full lane view: dock with the selected tab chip, the header (status badge, model badge, Resume icon, duration), the usage row (`ctx / in / out / cost`), the `Task` / `Parent` row, the first output lines |
| `current-cli-light-1440.png` | CLI (codex), finished | light | 1440 | Same as above |
| `current-cli-dark-760.png` | CLI (codex), finished | dark | 760 | Same as above; shows wrap of the header and usage row |
| `current-cli-light-760.png` | CLI (codex), finished | light | 760 | Same as above |
| `current-cli-restored-dark-1440.png` | CLI lane restored from a saved session (reopen the session) | dark | 1440 | Header duration (expected: lane age, e.g. `71h 18m`) and the selected tab chip in the same frame (expected: no duration). Proves the duration finding |
| `current-cli-running-dark-1440.png` | CLI, running (only if one runs during capture) | dark | 1440 | Stop button, ticking duration, status `running` |
| `current-subagent-dark-1440.png` | SDK subagent, finished | dark | 1440 | Full lane view: tab chip, `ptah-subagent-usage-summary` row, bubble header (chevron, avatar, name, badge), status row with its actions, footer tokens / cost / duration |
| `current-subagent-light-1440.png` | SDK subagent, finished | light | 1440 | Same as above |
| `current-subagent-dark-760.png` | SDK subagent, finished | dark | 760 | Same as above |
| `current-subagent-light-760.png` | SDK subagent, finished | light | 760 | Same as above |
| `current-subagent-running-dark-1440.png` | SDK subagent, running (only if available) | dark | 1440 | Status row actions (background, stop, transcript, message) and the progress line |
| `current-tabchip-cli-dark-1440.png` | CLI | dark | 1440 | Selected tab chip close-up: avatar, name, status word (`done`), duration or none |
| `current-tabchip-subagent-dark-1440.png` | subagent | dark | 1440 | Same for the subagent |
| `current-hovercard-cli-dark-1440.png` | CLI | dark | 1440 | Hover card of the same CLI lane: status word, duration, activity line |
| `current-hovercard-subagent-dark-1440.png` | subagent | dark | 1440 | Hover card of the same subagent |
| `current-inspector-dark-1440.png` | CLI + subagent rows | dark | 1440 | Inspector agents section with the same CLI and subagent rows: status, duration, token badge, cost, model, actions menu (open it for one row) |
| `current-inspector-light-1440.png` | CLI + subagent rows | light | 1440 | Same as above |
| `current-mainchat-turn-dark-1440.png` | main chat | dark | 1440 | One assistant turn header: `Worked for X` disclosure row with tool / file counts, closed and (second shot `-open`) with the activity panel open |
| `current-mainchat-turn-light-1440.png` | main chat | light | 1440 | Same as above, closed |

### Prototype shots (taken in this session)

| File | Lane kind | Theme | Width | What it shows |
| --- | --- | --- | --- | --- |
| `prototype-1440-dark.png` | CLI + subagent | dark | 1440 viewport, 760 lane frames | Before/after for both lane kinds, header states |
| `prototype-1440-light.png` | CLI + subagent | light | 1440 viewport, 760 lane frames | Same, light theme |

The prototype screenshots show sections 1 and 2. Section 3 ("Where every item goes") is in
`prototype/index.html` and in the duplication map below.

## Duplication map (checked against the source)

The `context.md` table is confirmed, with the corrections marked **Correction**.

| Item | Lane view today | Also shown in | Evidence |
| --- | --- | --- | --- |
| Status word | CLI: raw `agent().status` badge (`completed`), `agent-card-header.component.ts:75-85`. Subagent: status row badge, `inline-agent-bubble.component.ts:197-264` (raw words, `killed` shows `failed`) | Tab chip `canvas-lane-tabs.component.ts:124-128`, hover card `agent-dock-card.component.ts:48-55`, inspector `inspector-agents-section.component.ts:171-173`, avatar dot | Chip, card and inspector use the roster word from `cliLaneStatusWord` (`session-agent-roster.ts:165`) = `done`. The lane header uses the raw store status = `completed`. |
| Duration | CLI: `formatElapsed`, `agent-card-header.component.ts:143-148`, value from `agent-card.component.ts:157-164`. Subagent: footer badge after streaming, `inline-agent-bubble.component.ts:309-311` | Tab chip `canvas-lane-tabs.component.ts:129-133`, hover card `agent-dock-card.component.ts:51-53`, inspector `inspector-agents-section.component.ts:174-176` (non-CLI) and `:205-207` (CLI) | **Correction:** the inspector also uses `formatElapsed` for CLI rows (`:342`), so two formatters are mixed inside the inspector too. |
| Resume (CLI) | `agent-card-header.component.ts:125-140` | Nowhere else in the dock | Confirmed. |
| Stop (CLI, running) | `agent-card-header.component.ts:107-122` | Inspector actions menu (`:212-221`) | **Correction:** not in `context.md`. Keep. |
| Subagent stop / background / transcript / message | Status row in `inline-agent-bubble` | Inspector actions menu (`:212-221`, when `view.tray && view.hasActions`) | **Correction:** `context.md` says "nowhere else". The inspector menu can also show actions. Still keep them in the lane. |
| ctx / in / out / cache / cost | CLI `cli-lane-usage-summary.component.ts:27-54`. Subagent `subagent-usage-summary.component.ts:46-106` (no `in`) | Inspector: CLI token total + cost (`:193-208`), subagent token total (`:189-191`) | Confirmed. |
| Warm/cold cache badge | `subagent-usage-summary.component.ts:54-65` | — | Not in `context.md`. Move behind the disclosure. |
| Model badge | `agent-card-header.component.ts:97-104` | Inspector row (`:183-185`) | Not in `context.md`. |
| Task text | CLI `agent-card.component.ts:78-105`. Subagent `agentDescription`, `inline-agent-bubble.component.ts:131-138` | Hover card / inspector activity line (current activity, not the task) | Confirmed. |
| Parent ID | `agent-card.component.ts:86-93` | — | Confirmed. |
| CLI session ID | `agent-card.component.ts:101-103` (flat only) | — | Not in `context.md`. |
| Guard stop reason | `agent-card-header.component.ts:87-94` | — | Not in `context.md`. Keep. |
| Subagent bubble header (chevron, avatar, name, Streaming/Background/Resumed/Interrupted badge) | `inline-agent-bubble.component.ts:104-186` | Tab chip (name, avatar, status) and inspector | Confirmed. |
| Subagent footer tokens / cost / duration | `inline-agent-bubble.component.ts:309-311` | Usage summary above it (same lane), tab chip, inspector | The lane shows tokens and cost **twice** (summary row and footer). |

## Duration finding ("71h 18m")

**Result: confirmed bug, but the cause is different from the suspicion in `context.md`.**

- The card and the tab chip read the **same** data: `MonitoredAgent.startedAt` / `completedAt`.
  The roster copies them (`session-agent-roster.ts:166-167`). They do not come from two sources.
- The cause is a restored lane with no end time:
  - `CliSessionReference` has `startedAt` but no `completedAt`
    (`libs/shared/src/lib/types/agent-process.types.ts:463-494`).
  - `AgentMonitorStore.loadCliSessions` rebuilds the card with `status: ref.status`
    (`completed`) and no `completedAt` (`agent-monitor.store.ts:1708-1736`).
- Each surface then handles "finished, no end time" differently:

| Surface | Code | Result for a restored lane |
| --- | --- | --- |
| Lane card header | `agent-card.component.ts:157-164`: no `completedAt` → `Date.now() - startedAt`, ticks every second | `71h 18m` = age of the lane since it started, not its run time |
| Inspector CLI row | `inspector-agents-section.component.ts:329-332`: `(endedAt ?? now) - startedAt`, `formatElapsed` | Same wrong age (it ticks only while some row is running) |
| Tab chip | `dock-overflow.ts:93-98`: not running and `endedAt` null → `null` | No duration |
| Hover card | `durationText` from the same helper | No duration |

- `ctx —` has the same root: restored lanes set `usageTotals: null` (`agent-monitor.store.ts:1731`),
  so the summary falls back to segments and marks `in`/`out` with `≥`.
- Fix direction (implementation task, not this session): one helper for all four surfaces.
  "Finished with no end time" shows no time, the same rule as the main chat
  (`turn-facts.utils.ts:246-250`: `Worked` without a time). Optional: persist `completedAt` in
  `CliSessionReference` so restored lanes can show a real run time.

## Prototype

`prototype/index.html` (static, no build, no CDN; theme tokens from
`apps/ptah-extension-webview/tailwind.config.js` and `src/styles.css`). Open it in a browser.
Toggles: Dark/Light, lane width 1440/760. Query string `?theme=anubis-light&w=1440` also works.

Proposed header, both lane kinds, main chat model (`turn-disclosure-row.component.ts`):

- One 30 px disclosure row: label (`Working · 0m 42s` with a pulse dot / `Worked for 4m 12s` /
  `Worked`), chevron, live peek (current activity), meta at the right (`N tools · N files ·
  N tokens`, `≥` when partial, or the guard stop reason).
- One action place at the right end of the row: CLI → Stop (running) or Resume (finished with a
  `cliSessionId`). Subagent → Background, Stop, Transcript, Message (same conditions as today).
- Details behind the disclosure: ctx / in / out / cache read / cache write / cost, warm/cold
  badge, model, task text, CLI session ID, parent ID.
- No status word in the header. One duration only, in the label, with `formatAgentDuration`.

Decision taken (no user available): the row label keeps the main chat wording "Worked for X".
This is the only duration in the lane view, and it uses the same source and formatter as the
tab chip. If the user wants no duration in the lane at all, the label becomes `Worked`.

## Proposed Removals

Each item needs the user's approval before implementation.

1. Status badge in the CLI lane header (`agent-card-header.component.ts:75-85`). Kept in: tab
   chip, avatar dot, hover card, inspector.
2. Subagent status row badge (`inline-agent-bubble.component.ts:197-264`) in the lane view.
   The row actions move to the shared action place. The progress line moves to the row peek.
3. Separate duration text in the CLI header (`agent-card-header.component.ts:143-148`) and the
   subagent footer duration. Replaced by the row label. `formatElapsed` is retired in favour of
   `formatAgentDuration` app-wide (lane view and inspector `:342`).
4. Subagent bubble header (chevron, avatar, name) in the lane view only
   (`inline-agent-bubble.component.ts:104-186`). The main chat keeps the bubble.
5. Subagent footer tokens / cost (`inline-agent-bubble.component.ts:309-311`) in the lane view.
   The values stay in the row meta and the details.
6. Always-visible usage rows (`cli-lane-usage-summary`, `subagent-usage-summary`) as top-level
   rows. Not removed: moved behind the disclosure.
7. Parent ID: moved behind the disclosure (default). Alternative: remove it completely.
