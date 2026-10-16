# TASK_2026_685 — visual proof and header prototype

Session: child session "685 lane header proof", branch `docs/lane-header-proof` (base `ff9ec5fec`).
All `file:line` references below are from this worktree. No production source changed.

## Status of the Electron capture

The real-app screenshots (Part 1) are **not taken yet**.

- The Electron slot belongs to the parent (TASK_2026_683 perf recordings). I asked for it at the
  start of the session and did not receive "Electron: free" before this commit.
- The session policy lets Bash run only `git`, `ls`, `npx nx` and `npm` commands without approval.
  The capture needs `electron <launcher> --remote-debugging-port=9351`, a `node` Playwright script
  (`connectOverCDP`) and a kill by PID. Each one waits for approval in this tab and is denied after
  1 minute when nobody answers.
- The prototype "before" panels are therefore rebuilt from the current templates and from the
  values in the user's report (`completed`, `71h 18m`, `ctx — in ≥ 11.9k out ≥ 56 —`,
  `Parent: 18e50e43…`, `pong`). They are marked as rebuilt, not as screenshots.

Run plan when the slot and the approvals are available (all files stay in this worktree):

1. Copy `clean-session-followups/.ptah/tmp/a1117-launcher.mjs` to `.ptah/tmp/685-launcher.mjs`.
   Keep `COPY` = `.../clean-session-followups/.ptah/tmp/a1117-appdata/Ptah Dev` (private copy).
   Change the import to `chat-transcript-followups/dist/apps/ptah-electron/main.mjs`.
2. Start Electron with `--remote-debugging-port=9351`. Record the PID.
3. Connect with `chromium.connectOverCDP('http://127.0.0.1:9351')` (as in `final-lib.mjs`).
   Use themes `anubis` and `anubis-light`, window widths 1440 and 760.
4. Capture: Canvas dock lane view for a codex lane and an SDK subagent, the selected tab chip,
   the hover card, the inspector rows, and one main chat assistant turn header.
5. Kill the PID, confirm port 9351 is free, send "Electron: free".

## Screenshots

| File | Lane kind | Theme | Width | What it shows |
| --- | --- | --- | --- | --- |
| `screenshots/prototype-1440-dark.png` | CLI + subagent | dark (`anubis`) | 1440 viewport, 760 lane frames | Prototype: before/after for both lane kinds, header states |
| `screenshots/prototype-1440-light.png` | CLI + subagent | light (`anubis-light`) | 1440 viewport, 760 lane frames | Same, light theme |
| (pending) `screenshots/app-*.png` | CLI, subagent | dark, light | 1440, 760 | Real-app lane view, tab chip, hover card, inspector, main chat turn |

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
