# Requirements - TASK_2026_677_efcd

Path prefixes (from `handoff-1.md` §4): C = `libs/frontend/chat/src/lib/components`, CU = `libs/frontend/chat-ui/src/lib`,
CS = `libs/frontend/chat-state/src/lib`, CV = `libs/frontend/canvas/src/lib`.
Companion file: `parity-inventory.md` (every capability of the replaced surfaces, with a decision per row).

## Context

Today a session renders in one of two presentations chosen per tab by `viewMode` `'full' | 'compact'`
(`chat-types.ts:507,782`; toggle in `CS/tab-manager.service.ts:3089-3108`, persisted in `CS/tab-persistence.ts:161-175`,
switched from `CU/molecules/session/tab-item.component.ts:72-83` and `CV/canvas-rail/canvas-focus-header.component.ts:57-60`).
`'compact'` swaps the whole transcript for `ptah-compact-session-card` (`C/templates/chat-view.component.html:4-14`,
`chat-view.component.ts:962-978`), a summary card with lane rows, a permission/question callout, elapsed time, context,
todos and git. `'full'` renders `ptah-message-bubble` per message (`C/organisms/transcript/chat-transcript.component.html:35-68`),
where every message older than the last four auto-collapses to a header with chevron, title and tool/file counts
(`C/organisms/message-bubble.component.ts:216-281`, `.html:39-89`), plus token/cost/duration badges (`.html:136-185`) and a
hover copy button (`.html:158-163`). Nothing today shows a "Worked for" duration, a live turn timer, or a staggered
entrance on session switch. Per-session accounting lives in the Canvas Rail details aside
(`CV/canvas-detail/canvas-session-details.component.ts:30-178`: context %, tokens, cost, turns, todo count + active title,
branch, +/- changes), which exists only in the Rail.

The user asked (context.md, 2026-10-15) for a one-to-one rebuild of two reference screenshots
(`reference/01-clean-chat-turns.png`, `reference/02-session-shell-with-inspector.png`): a clean turn that shows the live
work while the agent runs, then collapses it into a "Worked for Xm Ys" disclosure under which the final answer and a row
of status-coloured agent chips appear; a "This session" right inspector (orchestrator card, AGENTS, TODOS, GIT); header
and composer chips; a staggered session-switch animation; and the 40 carry-over items T1-01..T1-40 of PR #730
(`reference/pr730-followup-map.md` §T1). The user wants "stunning", clean UI with lucide-angular icons and the CLI
provider marks, built fast, with testing postponed.

It matters because the orchestrator view is where the user supervises sub-agents, CLI lanes and background commands.
Today that state is split between the transcript, the Rail details aside and per-lane views, and the Electron single
chat view has no place to answer a CLI-lane permission request at all (T1-07). The visual target is fixed by
`design-spec.md` (revise round 1, commit 3693f9227) and `prototype/`.

## Classification

- Type: FEATURE — adds the inspector surface and replaces the compact presentation and the per-message collapse with
  the clean turn (decisions.md row 2).
- Estimate: XL — six feature areas (Delta 1 adds the inspector TASK section, which reads tasks-ui presentation helpers)
  across four frontend libraries (chat, chat-ui, chat-state, canvas), a replacement
  that needs a parity inventory, and 35 in-scope carry-over items, under a bundle budget with 0.01 MB headroom.
- Priority: not defined here (the repository and the user define no priority scale for this task).

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| PM-1 | The clean turn becomes the presentation of assistant turns in the session transcript (replacing the per-message auto-collapse and the assistant bubble chrome) in both view modes, and the chat-host compact activity card is retired. The per-tab view-mode toggle and its persistence stay. Resolved in round 1 per design-spec §3.8 and D16: `full` and `compact` are two densities of the same clean-turn transcript, never a card; `compact` keeps the live work log collapsed, uses tighter spacing and leaves the inspector closed until opened. Requirement 16 holds the criteria. The Rail card variant of `ptah-compact-session-card` (`variant 'rail'`, `SESSION_FORCED_CARD`) is not changed. | (a) keep a chat-host card as `compact`; (b) density variant of one transcript; (c) remove the toggle | task.md item 1 "replaces the compact view"; handoff-1 §1.1 and §4; design-spec §3.8, D16 (option b loses no capability and adds no surface); removing the toggle (c) would be a user-reserved capability removal | yes |
| PM-2 | "N needs you" counts distinct pending requests (each permission request and each question once, by request identity), across the session and every lane it owns. A lane with two pending permission requests counts 2; a lane waiting on a question that is also listed as a session question counts 1. | count waiting agents; count agents + requests (design-spec §5, §9) | design-spec-review finding 3 (double count, no rule for several requests per lane); each request needs its own user action | yes |
| PM-3 | Existing specs whose assertions target markup this task intentionally replaces may be updated to the new markup so the suites keep passing. No new spec files and no new coverage are written. | freeze specs; write new specs | decisions.md row 3 (testing postponed; suites, typecheck, lint still run) | yes |
| PM-4 | T1 items that only change specs (T1-10, T1-13, T1-16, T1-17, T1-18) are deferred to T2. | do them now | decisions.md row 3; each item names a spec defect only (pr730-followup-map §T1) | yes |
| PM-5 | Parity rows where the design is silent default to keep. A row is `remove-proposed` only where design-spec.md excludes the capability. After design round 1 no row qualifies: the design keeps B-4, B-8, B-11 at new places (`move`) and B-14, B-15 on the user turn (`keep`) (design-spec §12.2-12.3, D19). The inventory has no `remove-proposed` row. | mark every unplaced capability as a removal | design-spec §12.2, §12.3, D19; handoff-1 §3 item 1 | yes |
| PM-6 | Data without a source today (decisions.md row 9) is hidden or derived in the frontend; no backend change. | add backend sources now | decisions.md row 9 | yes |
| PM-7 | The turn duration is derived only from the durable fields `message.timestamp` and `message.duration`, with no value kept in memory, so the label is the same before and after a reload. `E` is the latest assistant `timestamp + duration` only; a CLI lane or agent completion time is never added (orchestrator decision, revision round 2). When a duration cannot be derived the label is the bare `Worked` (requirement 1). The spec's `[verify]` items are assumptions the architect checks and records in `implementation-plan.md` before batching (assumptions A1-A3 under requirement 1). | live-frozen value; add a backend start time | design-spec §3.9, D17; decisions.md row 9 (no live turn start time); task-description-review finding 2 | yes |
| PM-8 | The T1-01 "tiles" request is met by three views of the same agent record: the chip (at rest), the activity row in the expanded work log, and the inspector AGENTS row. No separate large tile is added to the main view. | add a tile grid to the transcript | reference screenshots (chips, not tiles); design-spec §1.4 (chip and row re-skin `subagent-tile`), §3.3, §3.5, §4.2; task-description-review finding 6 | yes |
| PM-9 | Of the PR #730 "Style F6-F12" findings, only "details in `subagent-tile`" (T1-27) is in scope. The other six are T3-09..T3-14 (refactoring) and stay out (requirement 4.7). | fix all seven now | `reference/pr730-followup-map.md:50,116-121`; PR #730 body, "R9 phase reviews" > "Style F6-F12"; finding text `.ptah/specs/TASK_2026_629_c0b3/code-style-review-R9-phase.md:104-141` (F9 at :120-124) | yes |
| PM-10 | Per-message tokens, cost and duration stay reachable: the activity panel shows the turn totals as a summary and, when a turn has more than one assistant message, one row per message (requirement 5.6). Parity rows B-8, B-11, B-12 are therefore a true `move`. | totals only, with the lost granularity as a proposed removal | task-description-review-r1 finding 1; `message-bubble.component.html:166-182`; parity-inventory B-8, B-11, B-12 | yes |
| PM-12 | The inspector TASK section (requirement 17) is read-only: it shows the linked primary task and opens its documents, and never links, unlinks or edits tasks. When no link is `primary`, the most recently linked task is shown first. The phase is shown only when derivable from data the frontend already receives, else omitted. | add link/unlink or status controls; show `—` for phase | decisions.md row 21 ("shown", "links to its artifacts", frontend only); `SessionTaskLinkSummary` has `role`, `createdAt`, `missing` (`session-organization.types.ts:92-100`); `TaskSpecDetail` has no phase field (`task-spec.types.ts:194-198`) | yes |
| PM-11 | Inspector open state (orchestrator decision): open in `full` and closed in `compact` at 960 px and wider are initial defaults; the toggle closes the `full` dock too; the manual choice is kept per tab in memory across tab switches and reset by a view-mode change (requirements 6.1, 6.6-6.9, 16.4). | non-closable `full` dock; one global choice; persist the choice across reloads | task-description-review-r1 finding 4; design-spec §3.8 inspector row ("the dock is closable") | yes |

## Scope

In scope:

- Clean assistant turn: live work log while streaming, auto-collapse to a `Worked for` disclosure on the final message,
  final answer, agent chip row, copy + activity actions, the per-turn activity panel, the tool/file count meta, live
  `Orchestrating` line (design-spec §3, §3.11).
- View modes `full` and `compact` as two densities of the clean-turn transcript (design-spec §3.8, PM-1, requirement 16).
- User turn re-skin with every capability listed as `keep`/`move` in `parity-inventory.md`, including time, sender,
  branch and rewind (design-spec §3.10).
- "This session" inspector in the chat view (both hosts) and as the re-skinned body of the Canvas Rail details aside:
  orchestrator card, AGENTS, TASK, TODOS, GIT; docked/overlay behaviour by container width (design-spec §2.1, §4).
- Inspector TASK section above TODOS: the session's linked primary task with ID, title, status, phase when derivable,
  links that open its existing artifacts, and live refresh on the `tasks:changed` push (requirement 17; decisions.md
  row 21; Delta 1).
- Permission and question routing from inspector rows and chips to a surface where the user can respond, including the
  Electron single chat view (T1-02, T1-07).
- Header chips (branch hint, `N needs you`, inspector toggle with dot) and composer chips (workspace, branch, approval
  mode, model and effort) (design-spec §5, §6).
- Staggered session-switch entrance with reduced-motion handling (design-spec §7).
- Carry-over items T1-01..T1-09, T1-11, T1-12, T1-14, T1-15, T1-19..T1-40 (requirements 12-14 and the traceability table).
- Keeping every chat-view surface the new view does not replace (stats strip with limits and budget, background tray,
  compaction notice and markers, banners, permission badge, question cards, queued-content indicator).
- `parity-inventory.md` rows marked `keep` or `move`.

User-visible visibility changes (not removals; each capability stays; decided by the user in decisions.md row 23):

- B-8, B-11, B-12 (user-approved, decisions.md row 23): per-message cost, token and duration badges move from always
  visible to the activity panel, one click behind `Show activity` (design-spec §3.11, §12.3): turn totals as the
  summary, plus one row per assistant message with its own tokens, cost and duration when the turn has more than one
  (requirement 5.6). The turn duration also stays visible as the `Worked for` label.

Proposed visibility changes the user did not approve (decisions.md row 23), so they stay as today:

- B-16: the user-turn time and the `You` label stay visible at rest, as today (requirement 3.5). No hover- or
  focus-only reveal.
- B-14, B-15: Branch and Rewind keep today's reveal behaviour unchanged (hover reveal of the action strip,
  `message-bubble.component.html:311-314`); no focus reveal and no always-visible variant is added (requirement 3.4).

Out of scope:

- Backend or RPC changes: ahead/behind per session, numeric lane progress ("212 of 340"), live background shell list,
  per-lane activity events, live turn start time, Gemini `CliType` — hidden or derived per PM-6 (decisions.md row 9); a
  later task if the user wants them.
- Vendoring a Gemini provider mark (`scripts/brand-icons.manifest.json`) — Gemini uses the `terminal` fallback
  (design-spec D5); optional follow-up.
- New spec files or new test coverage, including T1-10, T1-13, T1-16, T1-17, T1-18 and all of T2 — postponed by the
  user (decisions.md row 3).
- Removing any capability — `parity-inventory.md` "Proposed removals" lists none; a later removal needs the user's
  approval first.
- PR #730 style findings other than T1-27: `distinctRetainedCount` consumer, ignored output payloads,
  `chat-transcript.component.ts` size, glyph controls, retention coupling, canvas token names (T3-09..T3-14) —
  refactoring task T3 (PM-9).
- Turning the workspace and branch composer chips into pickers — design-spec D8; reversible later.
- Contrast tuning for third-party theme-picker themes — the anubis pair is measured; one third-party light theme is
  spot-checked (NFR Accessibility); full coverage is follow-up T4.
- The Canvas Rail board card (`compact-rail-card`, `SESSION_FORCED_CARD`) visuals — not in the reference screenshots;
  only the Rail a11y/layout carry-over items touch the Rail.
- Housekeeping in handoff-1 §6 (worktree removal, empty folder, 628 note) — user-reserved, not this task.
- Linking, unlinking, re-ranking or editing a task, or changing its status, from the inspector TASK section — the user
  asked for a display of the linked task (decisions.md row 21); the Tasks board and the `ptah_task_*` / `ptah_session_link_task`
  tools stay the places that change tasks and links.
- Rendering task artifacts inside the inspector, or embedding the Tasks board or its panels in the chat view — artifact
  links open the file (requirement 17.5); the board stays in tasks-ui (NFR Performance).
- Any change to the `tasks:changed` push, the `.ptah/specs` watcher or the task RPC contract — frontend only
  (decisions.md row 21, NFR Backend).

## Requirements

### 1. Clean assistant turn

Requirement: the session transcript — shows each assistant turn as live work while it runs and as a short, final
answer when done — so the user reads the result without scrolling through tool output.

Acceptance criteria:

Duration terms (design-spec §3.9, PM-7). A turn is a user message plus every assistant message up to the next user
message. `S` = the `timestamp` of the turn's first user message, skipping a compaction-continuation message and any
message without a finite timestamp; an inbound peer message counts. `E` = the largest `timestamp + duration` over the
turn's assistant messages, and exists only when every one of them has a finite `duration`. Nothing else is an input
to `E`: no CLI lane, sub-agent or background-command completion time (persisted or not) and no agent run time after
the last assistant message. `S` and `E` are computed in the frontend from those persisted message fields only, so the
same turn yields the same value live, after a reload and after a tab switch. A turn is running while it streams or
while any agent it owns runs; otherwise it is settled.

1. When an assistant turn is streaming and has no final text yet in `full` view mode, the system shall show the work
   log expanded, the running tool rows with a spinner, a disclosure row reading `Working · {now − S}` that ticks each
   second, and no answer, chip row or action row (`compact`: requirement 16.2).
2. When a turn is settled and `S` and `E` exist with `E − S` of at least 1 s, the system shall collapse the work log and
   show the disclosure row `Worked for {E − S}` formatted `{s}s` under one minute, `{m}m {ss}s` under one hour and
   `{h}h {mm}m` from one hour, followed by the final answer, the agent chip row and the action row.
3. When the final answer has arrived while agents owned by the turn still run, the system shall show the answer and
   the chips with live statuses, keep the disclosure row at `Working · {now − S}`, and show the live line. When those
   agents finish, the label shall settle to `E − S` from the assistant messages only; agent run time after the last
   assistant message is not added (each chip and activity row shows its own `done · {duration}`).
4. When the orchestrator answers without any tool call or agent activity, the system shall omit the disclosure row and
   the work log for that turn, so the turn shows no duration label.
5. When the user has expanded a turn's work log by hand, the system shall keep it expanded when that turn's final
   message arrives, and expanding or collapsing a turn shall not change its duration label.
6. When a settled turn has no `S`, no `E`, or `E − S` under 1 s (for example restored history without timestamps or
   durations), the system shall label the disclosure `Worked` with no number, never `0s` and never a guessed value.
   When a running turn has no `S`, the row shall read `Working` with the pulse dot and no timer.
7. When the work log is collapsed, the system shall make its content unreachable by Tab and not announced by a screen
   reader; the disclosure button shall expose `aria-expanded` matching the visible state.
8. When the session is reloaded or the tab is switched back, the system shall render past turns in their settled state
   with duration labels computed from `S` and `E` again, so a label shown before the reload is identical after it.
   When the live timer had shown more than `E − S`, the settled label shall show `E − S`.
9. When a turn was interrupted or stopped, the system shall apply the same rule, with `E` taken from the turn's
   assistant messages; no new copy is added.
10. When a turn's messages report tool calls or changed files (`messageSummary().toolCount`, `.filesChanged`), the
    disclosure row shall show the count meta `{n} tools · {n} files` at its right end, each part omitted when unknown
    or 0 and the whole meta omitted when both are, and the meta shall be part of the button's accessible name (B-4).

Assumptions the architect verifies and records in `implementation-plan.md` before batching (design-spec `[verify]`
items; each has a defined fallback, so none is a criterion the implementation can fail silently):

- A1: the restored-history loader maps `timestamp` and `duration` onto messages. If it does not, restored turns fall
  under criterion 6 (`Worked`), and the plan states this as a known outcome rather than a defect.
- A2 (settled in revision round 2, no longer a verification item): `E` never includes a CLI lane, sub-agent or
  background-command completion time, whether or not `MonitoredAgent` persists one; criterion 3 applies in every case
  (agent run time after the last assistant message is not added). The architect records no `MonitoredAgent` check for
  this requirement.
- A3: a turn renders one assistant message per user prompt today. Where a turn has several, the activity panel shows
  the turn totals (requirement 5.5) and, under them, one row per assistant message with that message's own tokens,
  cost and duration (requirement 5.6), so no message's values are lost.

### 2. Work log content parity

Requirement: the work log — keeps everything the current execution tree shows — so collapsing work never hides a
capability, it only folds it.

Acceptance criteria:

1. When a turn's work log is expanded, the system shall show streamed text, thinking blocks, tool calls with access to
   their input, output and errors, SDK workflow/task/monitor cards, agent summaries, Mermaid diagrams, `ptah-ui` blocks
   and inline permission cards for that turn, as `C/organisms/execution/execution-node.component.ts:167-340` does today.
2. When a tool call is running or finished, the system shall show its name, its arguments (truncated on one line, full
   value reachable) and a status of running or done (or the error).
3. When an inline permission card is pending inside a turn whose log is collapsed, the system shall still make that
   request reachable through the inspector row and the `N needs you` count (requirement 9).

### 3. User turn

Requirement: user turns — keep every capability marked `keep` or `move` in `parity-inventory.md` §B — inside the clean
right-aligned bubble.

Acceptance criteria:

1. When a user message has file attachments or images, the system shall show the file names and the image count on that
   turn.
2. When a message was sent from another session, the system shall show the peer label and the warning that the sender
   name is self-reported and unverified (`message-bubble.component.html:204-236`).
3. When a user message is a compaction continuation, the system shall show the "Continued from previous conversation
   (compacted)" disclosure with its expandable summary (`message-bubble.component.html:238-265`).
4. When a user turn renders, the system shall offer Branch (`Branch conversation from this message`) and Rewind
   (`Rewind file changes to this message`) as buttons under the bubble with today's events, result banners (C-10) and
   rule that Rewind is disabled with `aria-disabled` and the label `Rewind unavailable — session is not active` outside
   an active session (B-14, B-15 `keep`). The buttons shall keep today's reveal behaviour unchanged: hidden at rest and
   revealed when the pointer hovers the user turn or the strip (`message-bubble.component.html:311-314`), focusable as
   today. No focus reveal and no always-visible variant for devices without hover is added (user decision,
   decisions.md row 23; Delta 1).
5. When a user turn renders, the system shall show the message time and the sender, as today in
   `message-bubble.component.html:197-213`: the `formatTime` text inside a `<time>` element whose `datetime` attribute
   carries the machine-readable value (`formatDateTime`) and whose `title` gives the full date and time, next to `You`
   or, for an inbound peer message, the peer label (B-16). The time and the sender (`You` or the peer label) shall be
   visible at rest, without hover or focus, as today, and in the accessibility tree (user decision, decisions.md
   row 23; Delta 1).

### 4. Agent chip row and sub-agent display (T1-01, T1-05, T1-08, T1-27, T1-28)

Requirement: the orchestrator turn — shows one chip per delegated agent (sub-agent, CLI lane, background command) with
icon, name and a status word — so the user sees who worked and how it ended.

Acceptance criteria:

1. When a turn delegated work, the system shall show one chip per agent with the kind icon (lucide `Bot` for a
   sub-agent, `ptah-provider-mark` for a CLI lane with `terminal` fallback, lucide `Layers` for a background command),
   the agent name and one status word from `running | waiting | done | failed | stopped | queued` in its state ink.
2. When an agent's status changes, the system shall update the chip's status word without re-rendering other chips.
3. When the user activates a chip, the system shall open that agent's lane, and the matching inspector row shall carry
   `aria-current="true"`.
4. When the agent record is not in the stores (restored sub-agent, T1-08), the system shall either open its lane from
   the stored transcript or show a visible notice that the lane is not available for restored history; activation
   shall never be a silent no-op.
5. When the work log is expanded, each agent shall appear as an activity row with icon, name, its current or last
   activity text and `done · {duration}` or a spinner (T1-05).
6. When the task is complete, the two non-null assertions at `C/organisms/execution/subagent-tile.component.ts:80`
   (`endTime! - startTime!`) shall be gone, whether that file is kept, re-skinned or deleted, and no file that renders
   the agent chip, the agent activity row or the inspector agent row shall contain a non-null assertion; an agent with
   a missing start or end time shall show no duration rather than `NaN` or `0s` (T1-28). This holds whether or not the
   implementation edits `subagent-tile.component.ts`.
7. When the task is complete, the PR #730 style finding F9 shall be resolved in the code that renders the agent chip,
   the agent activity row and the inspector AGENTS row (T1-27), whether `subagent-tile.component.ts` is kept,
   re-skinned or deleted. Source: `.ptah/specs/TASK_2026_629_c0b3/code-style-review-R9-phase.md:120-124` (the R9 phase
   style review that `handoff-12.md` §2 item 3 calls "phase style F1-F12"). Full finding text:

   > **F9. `subagent-tile.component.ts` details.**
   > - The status-to-label map duplicates the background-agent strip (`'In background'` exists in both
   >   `subagent-tile.component.ts` and `chat-ui/.../background-agent-strip.component.ts`). The tile already imports
   >   `formatAgentElapsed` from that strip, so a shared `agentStatusLabel` would be the same dependency.
   > - `node().endTime! - node().startTime!` uses non-null assertions inside a single 170-character computed. A local
   >   `const { startTime, endTime } = node()` would remove both.
   > - `status` has no declared return type, so `statusLabel`'s object-literal lookup depends on inference. A named
   >   union would make it explicit.
   > - It is OnPush and uses `inject(..., { optional: true })` consistently, which matches the monitor/actions pattern
   >   of its siblings.

   The defects are still in the code: `subagent-tile.component.ts:75` declares its own status-to-label object literal
   (`running: 'Running', background: 'In background', ...`) beside the one at
   `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts:123-124`; `:64` declares `status` as a
   `computed` with no declared type; `:80` holds the non-null assertions in one long computed. The result is checked
   by a reviewer reading the files that render the three agent views, as follows:

   - (a) Labels: no file that renders the agent chip, the agent activity row or the inspector AGENTS row declares a
     status-to-label lookup of its own that repeats one elsewhere in `libs/frontend`; every status word those views
     show comes from one definition. Searching `libs/frontend` for the literal `'In background'` finds at most one
     status-label definition.
   - (b) Status type: the value that drives the status word in those views has an explicitly declared type that is a
     named union of the status values, not an inferred one.
   - (c) Non-null assertions: covered by criterion 6 (T1-28); the duration is not computed with `!` anywhere in those
     files.
   - (d) Kept pattern: the components that render those views use `ChangeDetectionStrategy.OnPush`, and any optional
     dependency is injected with `inject(..., { optional: true })`, as the finding's last bullet records.

   The same review numbers F6-F12 at `code-style-review-R9-phase.md:104,108,114,120,126,131,137` (summarised in the
   PR #730 body, "R9 phase reviews" > "Style F6-F12"); their outcomes are:

   | Finding | Item | Outcome in this task |
   | --- | --- | --- |
   | F6 | `distinctRetainedCount` has no consumer | out of scope, T3-09 |
   | F7 | ignored output payloads | out of scope, T3-10 |
   | F8 | `chat-transcript.component.ts` is 1231 lines | out of scope, T3-11 |
   | F9 | duplicated status-to-label map, untyped `status`, non-null assertions in the duration computed (`subagent-tile.component.ts:64,75,80`) | in scope, this criterion (a)-(d) and criterion 6 (T1-27, T1-28) |
   | F10 | glyph controls instead of lucide | out of scope, T3-12; new and re-skinned markup uses lucide anyway (NFR Conventions) |
   | F11 | the retention service and coordinator are coupled | out of scope, T3-13 |
   | F12 | canvas token names live in the `chat` lib | out of scope, T3-14 |

8. When the main view shows a session's delegated agents, the chip at rest and the activity row in the expanded work
   log together shall meet the T1-01 "tiles in the main view" request (PM-8), with this information available in
   each state:

   | Tile information today (`subagent-tile.component.ts:75-81`) | Chip (work log collapsed) | Activity row (work log expanded) | Inspector AGENTS row |
   | --- | --- | --- | --- |
   | Kind icon / CLI provider mark | yes | yes | yes |
   | Name | yes (truncated, full in accessible name) | yes | yes (tooltip) |
   | Status | status word | spinner or `done` | status word |
   | Duration | no | `done · {duration}` | yes |
   | Current or last activity | no | yes | yes |
   | Pending permission or question | status word `waiting` | — | `Needs permission:` / `Asked you:` with `Review` / `Answer` (req. 9) |
   | Open the agent's lane | yes (activation) | — | yes (activation) |

   Any other field the current tile renders (for example its tool count, `subagent-tile.component.ts:76-79`) shall
   remain reachable in that agent's lane or in the expanded work log.

### 5. Action row and live line

Acceptance criteria:

1. When an assistant turn is done, the system shall show at rest (not hover-only) exactly two buttons: `Copy message`,
   which copies the answer, and `Show activity`, which opens and closes that turn's activity panel with `aria-expanded`
   and `aria-controls` and leaves focus on the button (design-spec §3.6). The disclosure row, not this button, opens the
   work log.
2. When a turn is streaming or its log is open with work running, the system shall hide the action row.
3. When any agent of the session is working, the system shall show the live line `Orchestrating · {m}m {ss}s`; when
   any request waits on the user, the verb shall read `Waiting for you`.
4. When the live line timer ticks, screen readers shall not hear per-second announcements (static label in a polite
   live region, timer hidden from assistive technology).
5. When the activity panel of a done turn is open, the system shall list, in this order and each only when known,
   `Duration` (the requirement 1 label value), `Tokens` (input and output), `Cost`, `Tool calls` and `Files changed`,
   summed over the turn's assistant messages and formatted as today's token and cost badges format them; an unknown item
   is omitted, never shown as `0` or a placeholder, and when every item is unknown no empty or placeholder panel is
   rendered (B-8, B-9, B-11, B-12). These totals are the panel's summary. The panel is closed by default and is not
   offered while the turn runs.
6. When the activity panel of a done turn is open and the turn has more than one assistant message, the system shall
   also show a per-message breakdown under the summary: one row per assistant message, in message order and
   distinguishable by its position in the turn, each listing that message's own `Tokens` (input and output), `Cost`
   and `Duration` (`message().tokens`, `message().cost`, `message().duration`) formatted as today's per-message token,
   cost and duration badges format them (`message-bubble.component.html:166-182`). An unknown value is omitted from its
   row, never shown as `0` or a placeholder; a message with no known value has no row, and the other rows keep their
   true positions (positions are not renumbered). When the turn has exactly one assistant message, no breakdown is shown; instead the summary
   lists a separate `Message duration` item (that message's own `message().duration`, formatted as today's duration
   badge) directly after `Duration` whenever it is known, because the turn elapsed `Duration` (`E − S`) can differ from
   the message's own duration (design-spec §3.11; decision row 20). The breakdown is reachable by keyboard and readable by a screen reader in the same way as
   the summary (B-8, B-11, B-12).

### 6. Inspector shell and responsive behaviour (T1-32)

Requirement: the "This session" inspector — sits beside the session at wide widths and over it at narrow widths — so
the same information is available in a 400 px VS Code sidebar, the Electron window and Rail panes.

Acceptance criteria:

1. When the session container is at least 960 px wide, the system shall show the inspector docked at 336 px beside
   the thread whenever it is open. Its initial state for a tab is open in `full` view mode and closed in `compact`
   (requirement 16.4); these are initial defaults only, and the user can close the docked inspector in `full` and open
   it in `compact` with the toggle (criterion 6).
2. When the container is narrower than 960 px, the system shall show the inspector as an overlay sheet with a scrim;
   below 640 px the sheet is full width.
3. When the overlay opens, the system shall move focus into the inspector (close button), make the content behind it
   inert, and keep Tab within the sheet.
4. When the overlay closes by Escape, the close button or the scrim, the system shall return focus to the inspector
   toggle in every case.
5. When the Rail host is narrower than 400 px, the system shall hide the 44 px "Open details" button and show the
   details (inspector) as an overlay instead of the 288 px aside (T1-32).
6. When the inspector toggle is activated, the system shall open or close the inspector (docked or overlay, by width)
   and flip `aria-pressed` and its label between `Show session details` and `Hide session details`, in either view
   mode, including closing the docked inspector in `full`.
7. When the user has opened or closed the inspector with the toggle and then switches to another tab and back, the
   system shall show that tab's inspector in the state the user last chose for it; each tab keeps its own choice, in
   memory for the running window (it is not required to survive a reload or restart, after which the mode's initial
   default applies).
8. When the user changes a tab's view mode, the system shall discard that tab's manual Show/Hide choice and set the
   inspector to the new mode's initial default (open in `full`, closed in `compact`, at 960 px and wider).
9. When the container is narrower than 960 px, the system shall open the overlay only on toggle activation and never
   on a mode default, so a narrow `full` tab starts with the inspector closed.

### 7. Orchestrator card

Acceptance criteria:

1. When the inspector is shown, the system shall display the model, the orchestrator state (`working`,
   `waiting on N agents`, `needs you`, `idle`), context usage, tokens, cost and turns of the active session, from the
   same sources the Rail details aside uses today (`canvas-session-details.component.ts:111-123`).
2. When context usage is unknown, the system shall show `—`, an empty bar and the accessible value
   `Context usage unavailable`.
3. When the context window size has no source, the system shall show the percentage only (no `of 200k`).
4. When context usage reaches 80 % and 95 %, the system shall change the bar colour to the warning and error state
   colours respectively.
5. When tokens, cost or turns are unknown, the system shall show `—`, never `0`.

### 8. AGENTS section (T1-02, T1-04, T1-09)

Acceptance criteria:

1. When the session owns sub-agents, CLI lanes or background agents, the system shall list each exactly once (T1-09),
   with icon, name, kind badge (`Sub-agent`, `CLI lane`, `Background`), status word, duration and an activity line.
2. When agents exist, the system shall order rows: needing the user first, then running (newest first), then finished
   (most recent first), and the header shall read `{n} active · {m} finished`.
3. When a CLI lane has no activity string, the system shall derive it from the lane's last `segments` entry; when none
   can be derived, the activity line shall be omitted (not filled with a placeholder).
4. When an agent row is activated, the system shall open that agent's lane in the main area.
5. When the session has no agents, the system shall show the empty state "No agents yet" with its explanation; while the
   sources load, it shall show skeleton rows with `aria-busy="true"`.
6. When an agent's name is truncated, the full name shall be available as a tooltip and in the row's accessible name.

### 9. Permission and question routing (T1-02, T1-07)

Requirement: every pending request — session permission, CLI-lane permission, user question — can be answered from the
session view in every host, so a waiting agent never leaves the user without a path.

Acceptance criteria:

1. When an agent waits on a permission request, its inspector row shall show the icon, "Needs permission:" and the full
   command (wrapped, never truncated), and a `Review` control at least 24 x 24 px.
2. When an agent or the session waits on a user question, the row shall show "Asked you:", the first 60 characters of the
   question, and an `Answer` control at least 24 x 24 px.
3. When `Review` or `Answer` is activated, the system shall take the user to a surface where that specific request
   (matched by request identity) can be allowed, denied or answered — in the VS Code webview and in the Electron single
   chat view (T1-07).
4. When an agent has several pending requests, the system shall show the first and a `+N more` control (at least
   24 x 24 px) that reaches the rest.
5. When a request is answered elsewhere (permission badge, question card, inline card, another host), the system shall
   remove it from the inspector, the chips and the `N needs you` count without a reload.
6. When sending the response fails, the system shall keep the request listed and show an error with a retry path.
7. When the request's agent has finished or the request expired, the system shall remove the row's action and show no
   actionable control for it.

### 10. TODOS

Acceptance criteria:

1. When the session's latest todo list is known, the system shall list each item with its state (done, in progress,
   pending) derived in the frontend from the todo tool results (`parseTodoList`, `CU/molecules/compact-session/compact-session-metrics.ts:105`)
   and the header `{done} of {total}`.
2. When an item's state is shown, it shall carry a non-colour cue: an icon shape and a screen-reader prefix
   (`Done:`, `In progress:`, `Pending:`).
3. When more than 8 items exist, the system shall show 8 (in-progress first) and a `+N more` control of at least
   24 x 24 px that reveals the rest.
4. When there is no todo list, the system shall show "No todos for this session. The orchestrator lists its plan here."
5. When the todo data cannot be parsed, the system shall show the count-only summary available today
   (`summarizeTodos`) or `—`, never an empty list that looks complete.

### 11. GIT

Acceptance criteria:

1. When git stats are known, the system shall show the branch name, `+{additions}` and `−{deletions}` (U+2212), the
   partial marker when stats are partial, and the existing `gitTitle()` tooltip text.
2. When ahead/behind counts have no source (today), the system shall not show the ahead/behind pair.
3. When the root is not a git repository, the system shall show "Not a git repository" and no `Review changes` link.
4. When git stats are loading, the system shall show a skeleton row; when reading fails, it shall show
   "Could not read git status" with `role="alert"` and a `Retry` control that re-requests the stats.
5. When `Review changes` is activated, the system shall open the existing review surface for that session's changes.

### 12. Session-scoped aggregation, header and composer chips

Acceptance criteria:

1. When the inspector, the chips, the header count and the live line show a session's state, they shall read from one
   session-scoped source so the same request or agent never shows different states in two places at the same time.
2. When N distinct pending requests exist (PM-2), the header shall show a status chip `1 needs you` / `{N} need you`
   with `role="status"`; at N = 0 the chip is absent; when the inspector is closed and N > 0 the toggle shows a dot.
3. When the session has a branch, the header shall show a non-interactive branch hint (hidden below 640 px container
   width) whose tooltip is the full branch name.
4. When the composer is shown, it shall show the workspace name (tooltip: full path) and branch as non-interactive hints,
   an approval-mode chip that opens the existing approval-mode choice for that session
   (`AutopilotStateService.stateFor(sessionId)`), and a `{model} · {effort}` chip that opens the existing model and effort
   selection; below 640 px the effort is dropped from the label.
5. When the approval mode changes from anywhere, the composer chip shall show the new mode name in its state ink.

### 13. Session-switch motion (T1-06)

Acceptance criteria:

1. When the active session changes (tab switch, Rail focus), the system shall fade in the header and composer and
   stagger turn blocks and inspector rows, finishing within 620 ms; items after the 8th turn block or 6th inspector row
   shall share the last delay.
2. When the user switches again before the sequence ends, the system shall restart it for the new session and leave no
   element of the old sequence invisible or mid-animation.
3. When `prefers-reduced-motion: reduce` is set, the system shall show all content immediately at full opacity with no
   running stagger, pulse, spinner or caret animation.
4. When the work log collapses or expands, the system shall animate it without shifting content outside the turn.

### 14. Lane and Rail carry-over (T1-03, T1-11, T1-12, T1-14, T1-15, T1-19..T1-26, T1-29..T1-31, T1-33..T1-40)

Acceptance criteria:

1. When a `cli:`, `bg:` or `sub:` lane is open, its header shall show model, context, tokens, cost and elapsed time in
   the main stats-strip layout; a value without a source shows `—` (T1-03).
2. When the details copy about agents appearing as lanes is shown, it shall be true for the host it is shown in (T1-11).
3. When `CanvasDetailService.open` fails from a Rail card or the needs-you queue, the user shall see a notice instead of
   a silent no-op (T1-12).
4. When a restored-history session has no lane record, the copy shall not say "not available yet" (T1-14).
5. When a lane open is rejected repeatedly in a dev build, the console shall show no NG0956 warning (T1-15).
6. When the lane notice is shown, the context chip and stats strip shall stay visible and usable (T1-19).
7. When a tile or chip points at a lane key that no longer resolves, the system shall show a notice (T1-20).
8. When a lane shows a streaming agent, it shall show the streaming state and render `ptah-ui` blocks as the main
   transcript does (T1-21).
9. When Escape closes a menu, popover or dialog inside a lane, the lane shall stay open (T1-22).
10. When an agent's lane key changes `bg:`→`sub:` or `sub:`→`bg:`, an open lane shall stay open on the same agent without
    remounting (scroll position and focus kept) (T1-23, T1-26).
11. When a lane closes, focus shall return to the control that opened it most recently, whatever the open path (T1-24).
12. When an agent record arrives after its lane opened, focus shall stay where the user put it (T1-25).
13. When the collapsed Rail receives keyboard focus, the focused element shall show a visible focus indicator (T1-29).
14. When a screen reader reaches the collapsed `+` button, it shall announce an accessible name for creating a session (T1-30).
15. When the Rail header chips and the `+N more` control render, each target shall be at least 24 x 24 px (T1-31, T1-36).
16. When the collapsed Rail content overflows, the system shall show a scroll affordance (T1-33).
17. When Escape is pressed on the only button of a collapsed Rail, the event shall not be swallowed by the Rail
    keyboard handler (`canvas-rail-keyboard.ts:31-36`) (T1-34).
18. When the Rail select button is not visible, `focusRailSelectButton` shall not send focus to it, regardless of
    `aria-hidden` (T1-35).
19. When the host is narrower than 400 px, `aria-valuemax` shall equal the largest value the control can reach (T1-37).
20. When the lane strip is revealed, its reveal animation shall play once per reveal, not on later re-renders (T1-38).
21. When the deferred needs-you queue loads, the board shall not shift (fixed host footprint, including the wider
    loaded `N need you` label) across 4 reloads (T1-39, T1-40).

### Carry-over traceability (T1-01..T1-40)

| Item | Where | Item | Where | Item | Where | Item | Where |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1-01 | 4.1, 4.5, 4.8 | T1-11 | 14.2 | T1-21 | 14.8 | T1-31 | 14.15 |
| T1-02 | 8, 9 | T1-12 | 14.3 | T1-22 | 14.9 | T1-32 | 6.5 |
| T1-03 | 14.1 | T1-13 | deferred (PM-4, spec only) | T1-23 | 14.10 | T1-33 | 14.16 |
| T1-04 | 8 | T1-14 | 14.4 | T1-24 | 14.11 | T1-34 | 14.17 |
| T1-05 | 4.5 | T1-15 | 14.5 | T1-25 | 14.12 | T1-35 | 14.18 |
| T1-06 | 13 | T1-16 | deferred (PM-4, spec only) | T1-26 | 14.10 | T1-36 | 14.15, 9.4 |
| T1-07 | 9.3 | T1-17 | deferred (PM-4, spec only) | T1-27 | 4.7 | T1-37 | 14.19 |
| T1-08 | 4.4 | T1-18 | deferred (PM-4, spec only) | T1-28 | 4.6 | T1-38 | 14.20 |
| T1-09 | 8.1 | T1-19 | 14.6 | T1-29 | 14.13 | T1-39 | 14.21 |
| T1-10 | deferred (PM-4, spec only) | T1-20 | 14.7 | T1-30 | 14.14 | T1-40 | 14.21 |

Requirement 17 (inspector TASK section) is not a T1 carry-over item; it traces to the user's scope addition,
decisions.md row 21 (Delta 1).

### 15. Replaced-surface parity

Acceptance criteria:

1. When the implementation is reviewed, every `keep` and `move` row of `parity-inventory.md` shall be reachable in its
   stated new location.
2. When the implementation is reviewed, no capability listed in `parity-inventory.md` shall be absent from the
   product; the inventory has no `remove-proposed` row (PM-5), and the visibility changes listed under Scope are the
   only changes in how often a capability is seen.
3. When the per-tab view-mode toggle is used (tab item or Rail focus header), the session shall switch between the
   `full` and `compact` presentations defined in requirement 16, and the choice shall survive a reload (PM-1).
4. When a Rail board card renders, it shall look and behave as before this task (compact rail card unchanged).

### 16. View mode `full` | `compact` (PM-1; parity A-1..A-6)

Requirement: the per-tab view mode — changes density and how much live work is unfolded, over one clean-turn
transcript — so a user who prefers a condensed session keeps that choice without losing any capability
(design-spec §3.8, D16).

Acceptance criteria:

1. When a tab is in either mode, the system shall render the session as the clean-turn transcript; the chat-host
   compact session card shall not render in place of the transcript in either mode.
2. When a turn streams in `compact`, the system shall keep the work log collapsed and show the disclosure row as
   `Working · {t}` followed by a one-line peek of the newest log row's text (truncated, hidden from assistive
   technology, updated without announcements); the user can still open the log by hand. In `full`, the log is
   expanded and pinned to the bottom (requirement 1.1).
3. When a turn is done, the system shall show in both modes the same content: collapsed log, the `Worked for` row with
   count meta, the full final answer (never truncated or summarised), the agent chips and the action row; the live
   line behaves the same in both modes.
4. When the session container is at least 960 px wide, the inspector's initial state shall be open and docked in
   `full` and closed in `compact`; these are initial defaults only. The user can close the dock in `full` and open the
   inspector in `compact` with the toggle; that manual choice is kept per tab, in memory, across tab switches, and a
   change of view mode resets it to the new mode's default (requirement 6.1, 6.6-6.9). While the inspector is closed in
   either mode, the `N needs you` header chip and the toggle dot still show pending requests.
5. When a tab is in `compact`, the vertical gaps shall be 12 px (user to assistant), 20 px (assistant to user) and
   8 px (answer paragraphs) with a 28 px disclosure row, against 20 / 28 / 12 px in `full`.
6. When a tab is in either mode, user turns (attachments, time and sender, branch, rewind, compaction disclosure),
   banners C-1..C-17, the stats strip, compaction markers, the composer, the render window and older-history loading
   shall be present and behave identically.
7. When the user switches mode from the tab item or the Rail focus header, the system shall switch in place without
   remounting the transcript or replaying the session-switch stagger, keep the topmost visible turn at the same
   position, and set `aria-pressed` on the control to match the mode.
8. When a tab saved as `compact` by the previous build is restored, the system shall show it as the clean-turn
   transcript in `compact` density, with no data migration and no error.

### 17. Inspector TASK section (decisions.md row 21; Delta 1)

Requirement: the "This session" inspector — shows the task the session is linked to (its primary task from the
session organization record, `SessionOrganizationSummary.tasks`, `libs/shared/src/lib/types/session-organization.types.ts:92-100,125`,
written by `session:linkTask`, `libs/shared/src/lib/types/rpc/rpc-session.types.ts:157-184`) with its ID, title,
status, phase and artifacts, kept current while agents work on it — so the user sees which task the session serves
and its progress without opening the Tasks board. The section sits above TODOS; TODOS (requirement 10) is unchanged.

Terms. Linked tasks = the entries of the session's organization `tasks` list. Primary task = the entry with
`role: 'primary'`; when no entry is primary, the most recently linked entry (`createdAt`) is shown first. Task data =
the `tasks:get` result for that task id (`TaskSpecDetail`, `libs/shared/src/lib/types/task-spec.types.ts:194-198`;
method at `libs/shared/src/lib/types/rpc.types.ts:2349`). Artifacts = the task's `artifacts` filenames that are
workflow documents readable through `tasks:getArtifact` (`DocFile`, `libs/shared/src/lib/types/task-spec.contract.ts:74-96`;
method at `rpc.types.ts:2350-2353`).

Acceptance criteria:

1. When the inspector is shown for a session with a linked primary task, the system shall show a section headed
   `TASK` above the TODOS section, with the task ID (folder id, e.g. `TASK_2026_677_efcd`) and the task title from
   the task data.
2. When the task data has a status, the system shall show it with the label from `TASK_STATUS_LABELS`
   (`libs/frontend/tasks-ui/src/lib/task-presentation.ts:26-33`: Backlog, In Progress, In Review, Blocked, Done,
   Cancelled) and a non-colour cue (the text label itself, plus an icon or shape), never colour alone.
3. When a phase can be derived for the task from data the frontend already receives, the system shall show it next
   to the status; when it cannot be derived, the system shall omit the phase (no placeholder and no guessed value).
4. When the task folder holds workflow documents, the system shall list one link per document present (named by its
   filename, e.g. `task-description.md`) as a list (`role="list"` / `listitem` or native list markup); documents that
   are not present shall not be listed, and a task with none shall show `No documents yet`.
5. When an artifact link is activated by pointer, Enter or Space, the system shall open that file in the editor the
   same way the git sidebar opens a file today, in the VS Code webview and in the Electron app; the architect names
   the exact host call in `implementation-plan.md`. When opening fails, the system shall show an inline error on that
   link and keep the section usable.
6. When the session has no linked task, the system shall show `No task linked to this session` and no links.
7. When the linked task's organization entry is marked `missing: true`, or `tasks:get` returns `task: null`, the
   system shall show the task ID with `Task folder not found` and no artifact links.
8. When the task data is loading, the system shall show a skeleton row with `aria-busy="true"` in the section.
9. When `tasks:get` fails (rejected call or error result), the system shall show `Could not load task` with
   `role="alert"` and a `Retry` control (at least 24 x 24 px) that re-requests the task data; the rest of the
   inspector shall remain usable.
10. When the session has more than one linked task, the system shall show the primary task first in full (criteria
    1-5) and a `+N more` control (at least 24 x 24 px, N = linked tasks minus one) that reveals the other linked task
    IDs and titles; the control's accessible name shall state the count.
11. When a `tasks:changed` push arrives (`TASKS_CHANGED_MESSAGE_TYPE`,
    `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:53`; payload `TasksChangedNotification`
    `workspaceRoot`, `reason`, optional `folderNames`) for the session's workspace and either names the shown task's
    folder or names no folders, the system shall re-read the task data and update ID, title, status, phase and
    artifact links without a reload or a tab switch. This shall happen whether or not the Tasks board is open (today
    `TasksStoreService.handleMessage` drops pushes when no board surface is open, `tasks-store.service.ts:1121-1128`).
12. When an agent creates or updates the linked task through the `ptah_task_*` tools (status change, new document
    in the folder), the system shall show the new status and the new artifact link in the open inspector after the
    resulting `tasks:changed` push, without a reload.
13. When a `tasks:changed` push names only other task folders or another workspace, the system shall not re-request
    the shown task.
14. When several `tasks:changed` pushes arrive while a re-read of the same task is in flight, the system shall show
    the result of the latest re-read only, and shall not issue more than one concurrent `tasks:get` for that task.
15. When the session's linked tasks change (a task linked, unlinked or promoted to primary, e.g. by an agent's
    `ptah_session_link_task` call), the system shall show the new primary task without a reload, no later than the
    next existing push or fetch that updates the session organization record in the frontend or the next time the
    inspector opens; no new backend push is added for this (the architect records which existing signal applies).
16. When the TASK section is reached by keyboard, every link and control in it shall be in the tab order with a visible
    focus indicator, activate with Enter (links) or Enter/Space (buttons), and have a target of at least 24 x 24 px;
    a truncated title shall be available in full as a tooltip and in the accessible name.
17. When the inspector is closed, the system shall not render the TASK section and shall not request task data for it.

## Non-functional requirements

- Performance (bundle): the webview initial bundle is 3.49 MB against a 3.50 MB budget (handoff-1 §2, PR #730 CI). The
  initial bundle shall not exceed the budget: new UI loads lazily (`@defer`) or replaces existing code one to one, and
  code made unreachable by the replacement is deleted, not kept beside the new code. Measured by the existing CI budget
  check on the PR. The TASK section (requirement 17) loads inside the lazily loaded (`@defer`) inspector body and is
  not part of the initial bundle; the chat bundle shall not import the tasks-ui board, its panels or
  `TasksStoreService` — only shared types and the presentation helpers (`TASK_STATUS_LABELS` and peers in
  `task-presentation.ts`). Checked by review of the chat/chat-ui import graph and by the CI budget check.
- Compatibility: VS Code webview (including the 400 px sidebar), Electron single chat view, and Canvas Rail panes shall
  each render the clean turn and the inspector; breakpoints are based on the session container width, not the window.
- Conventions: Angular standalone components, `OnPush`, signals and `inject()`; lucide-angular icons imported per
  component (`LucideAngularModule` + icon objects; `libs/frontend/ui` stays lucide-free); CLI lane icons via
  `ptah-provider-mark`; colours only through existing theme tokens (design-spec §1).
- Themes: dark `anubis` and light `anubis-light` shall both meet the contrast pairs in design-spec §8.2 (text 4.5:1,
  UI and focus 3:1); one third-party light theme is spot-checked by the visual reviewer.
- Accessibility: WCAG 2.2 AA as applied in design-spec §8 (the repository enforces 4.5:1 for muted text in
  `base-content-muted.spec.ts`); interactive targets at least 24 x 24 px; status never conveyed by colour alone;
  `prefers-reduced-motion` respected (requirement 13.3). The TASK section uses list semantics for its artifact links
  and linked-task list, 24 x 24 px targets and full keyboard operation (requirement 17.4, 17.10, 17.16). Exception
  by user decision (decisions.md row 23): the Branch/Rewind strip keeps today's hover-only reveal (requirement 3.4),
  so this task does not change its focus visibility.
- Backend: no backend, RPC or shared-type change unless a row is added to `decisions.md` first (decisions.md row 9).
  The TASK section is frontend only (decisions.md row 21): it uses the existing `tasks:get`, `tasks:getArtifact`,
  session organization data and the `tasks:changed` push as they are.
- Verification: each changed project's existing test suite, typecheck and lint pass, run one at a time with
  `--parallel=1 --skip-nx-cache` and Jest `--maxWorkers=2` via `node .ptah/tmp/check-run.mjs`; no workspace-wide runs; no
  new spec files (PM-3). UI changes carry before/after screenshots in dark and light (context.md rules).

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| The user (operator of the orchestrator) | Final answers without scrolling through tool output; one place to see agents, todos, git and pending requests | Side-by-side with the two reference screenshots; never blocked by a request with no route |
| Keyboard and screen-reader users | Reachable disclosures, chips, rows and overlay with predictable focus | Tab order and focus return of requirement 6; announced names; no per-second announcements |
| VS Code sidebar and Rail-pane users | A usable layout at 400 px | Overlay inspector, no clipped targets, no horizontal scroll |
| Electron users | A place to answer CLI-lane permissions (T1-07) | `Review` leads to an allow/deny control in the single chat view |
| Codex reviewer (lane-review) | A checkable spec and a parity table | Each criterion verifiable from outside; removals listed for the user |
| Maintainers | No duplicate compact and clean code paths | Replaced code deleted; bundle under budget |
| The user running task-driven orchestration (`ptah_task_*`, linked sessions) | See which task a session serves, its status and documents, as agents change them | TASK section matches the Tasks board after an agent's `ptah_task_*` call, without a reload; documents open in one click |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| New inspector and turn UI push the initial bundle over 3.50 MB | HIGH | HIGH | Architect places inspector body and work-log detail behind `@defer` and deletes the replaced compact activity path in the same batch; team-leader confirms with the Electron renderer rebuild size before push |
| A capability of the message bubble or compact card disappears unnoticed | MEDIUM | HIGH | Code-logic reviewer checks every `keep`/`move` row of `parity-inventory.md` against the diff, including rows that only change visibility (B-8, B-11, B-12) and rows whose visibility must stay as today (B-14, B-15, B-16; decisions.md row 23) |
| `Review`/`Answer` looks actionable but leads nowhere in Electron | MEDIUM | HIGH | Architect specifies the route per request type and host before batching (requirement 9.3); visual reviewer exercises it in Electron |
| Needs-you count or agent status differs between header, chips and inspector | MEDIUM | MEDIUM | Single session-scoped aggregation (12.1, PM-2); architect defines request identity |
| Shared `CompactSessionCardComponent` change breaks the Rail board card | MEDIUM | MEDIUM | Team-leader keeps the `variant 'rail'` path out of the replacement batches; `compact-rail-card` and `canvas-rail-board` suites must pass |
| Regressions go unseen because testing is postponed | MEDIUM | MEDIUM | Existing suites, typecheck and lint per changed project (PM-3); visual review dark + light against the prototype |
| Derived data (todos, activity, durations) shown as if complete | MEDIUM | MEDIUM | Unknown/partial states of requirements 1.6, 5.5, 7.2, 8.3, 10.5, 11.2 are review gates |
| Restored history lacks `timestamp` or `duration`, so every restored turn reads `Worked` | MEDIUM | LOW | Architect verifies assumptions A1 and A3 (requirement 1; A2 is settled) and records the outcome in `implementation-plan.md` before batching; the fallback is specified, so the result is a known outcome, not a defect |
| `compact` density differs from `full` in more than density (a feature appears in one mode only) | LOW | MEDIUM | Visual reviewer checks requirement 16.3 and 16.6 in both modes, dark and light |
| Most ad-hoc sessions have no linked task, so the TASK section is usually an empty state that takes inspector space | HIGH | LOW | Designer sizes the no-task state (17.6) as one compact line (design-spec delta); visual reviewer checks it in `full` and `compact`, dark and light |
| The `.ptah/specs` watcher emits one `tasks:changed` per debounce window, so an agent writing a spec folder floods the inspector with re-reads | HIGH | MEDIUM | Architect filters pushes by workspace and `folderNames` and coalesces in-flight re-reads (17.13, 17.14); code-logic reviewer checks both criteria |
| The inspector depends on `TasksStoreService`, which drops pushes with no board open (`tasks-store.service.ts:1121-1128`) and pulls the board store into the chat bundle | MEDIUM | HIGH | Architect specifies the push subscription and data read for the inspector without that store (17.11, NFR Performance); code-style reviewer checks the chat/chat-ui import graph |
| No phase source exists in `TaskSpecDetail`, so a "phase" is invented | MEDIUM | LOW | Architect records the derivation or its absence in `implementation-plan.md`; 17.3 omits the phase when none can be derived |
| Today's hover-only Branch/Rewind reveal, kept by user decision, leaves a keyboard user focusing an invisible button | MEDIUM | LOW | Kept as today by user decision (decisions.md row 23); the orchestrator lists it in the PR body as a known state for a later decision |

## Open questions

- Answered (decisions.md row 23): the user approved B-8/B-11/B-12 behind `Show activity`, and did not approve the
  B-16 hover/focus-only time and `You` or the B-14/B-15 focus reveal; both stay as today (Scope, requirements 3.4-3.5).
- How the phase of a linked task is derived from data the frontend already receives (requirement 17.3), and which
  host call opens an artifact file the way the git sidebar opens files (requirement 17.5). Answer: the architect, from
  the tasks-ui and git-ui code, recorded in `implementation-plan.md` before batching.
- Request field names and identity (`requestKey`) for the `Review`/`Answer` routes are marked `[verify]` in
  design-spec §4.5. Answer: the architect, from the stores.

## Handoff

- Next specialist: software-architect, after the design-spec delta for the TASK section and the row-23 visibility
  decisions (Delta 1) passes the codex delta review. No removal decision is pending (PM-5).
- Why: the shape is the open question — the session-scoped aggregation contract, the request routing per host, the
  `@defer` split under the bundle budget, the replacement of a component shared with the Rail card, and the TASK
  section's push subscription and file-open route without the tasks-ui store.

## Revision round 1

Gate 1 revise round 1 of 2: the six findings of `task-description-review.md` (codex, REVISE 5/10), aligned with
`design-spec.md` revise round 1 (commit 3693f9227). Line numbers refer to this revision.

| Codex finding | Change | Line / section |
| --- | --- | --- |
| 1 Serious: view-mode toggle has no defined result | PM-1 resolved per design-spec §3.8 and D16 (two densities of one clean-turn transcript; chat-host card retired); new requirement 16 with eight criteria for what `full` and `compact` show and what the toggle changes (streaming log, done turn, inspector default, rhythm, identical features, in-place switch, persistence, old saved tabs); 1.1, 6.1 and 15.3 point to it; new risk row | PM-1 (:47); req. 1.1 (:123); 6.1 (:285); 15.3; req. 16 (:466-496); Risks |
| 2 Serious: duration persistence vs missing source | Duration terms `S` and `E` from `message.timestamp` and `message.duration` only (PM-7, design-spec §3.9, D17); criteria 1.1-1.9 rewritten: live label, settled label formats, still-running agents not added, zero-activity turn has no label, `Worked` fallback (also for E − S < 1 s), `Working` without timer when no `S`, identical label after reload, interrupted turns; `[verify]` items kept as architect-verified assumptions A1-A3 with defined fallbacks; new risk row | PM-7 (:53); req. 1 terms (:117-121), criteria 1-9 (:123-146), assumptions (:151-160); Risks |
| 3 Moderate: T1-27/T1-28 conditional; F6-F12 unnamed | 4.6 (T1-28) is unconditional: the two `!` at `subagent-tile.component.ts:80` are gone whether the file is kept or deleted, and no chip/row file has a non-null assertion. 4.7 (T1-27) is unconditional and enumerates F6-F12 by list order from the PR #730 body; only F9 "details in `subagent-tile`" is in scope, the other six are T3-09..T3-14 (PM-9, Out of scope). The finding's full text lives in TASK_2026_629's R9 phase style review (`handoff-12.md` §2.3), not in this folder; the architect quotes it in `implementation-plan.md`. Traceability T1-27 → 4.7 | PM-9 (:55); Out of scope; req. 4.6-4.7 (:220-241); traceability table |
| 4 Moderate: user-turn time and sender untested | New 3.5: `<time>` with `datetime` (`formatDateTime`) and `title` (full date and time), `You` or peer label, in the accessibility tree at all times, peer label visible at rest; 3.4 rewritten for Branch/Rewind as `keep` with labels, disabled rule and hover/focus reveal | req. 3.4-3.5 (:190-200) |
| 5 Moderate: two inventory citations | `parity-inventory.md` C-18 now cites `chat-input.component.ts` lines for input, attach, model, effort, voice, stop, send and approval mode, plus the mount at `chat-view.component.html:244-247`; D-10 cites `canvas-rail-board.component.ts:181,208,239` (`@defer (on idle)`) and the import note `:26-28`; the commit is kept as history only | parity-inventory C-18, D-10 |
| 6 Minor: T1-01 "tiles" narrowed to chips | PM-8 and new 4.8: chip + expanded activity row (+ inspector row) meet the tile request, with a table of which tile information is available in each state and a rule that other tile fields stay reachable in the lane or work log; traceability T1-01 → 4.1, 4.5, 4.8 | PM-8 (:54); req. 4.8 (:242-257); traceability table |
| Alignment: design kept all five proposed removals (design-spec §12.2-12.3, D19) | PM-5 updated; Scope lists the user-visible visibility changes (B-8/B-11/B-12 behind `Show activity`, B-16 time behind hover/focus, B-14/B-15 gain focus reveal) as changes, not removals; Out of scope no longer defers removals; 15.2 rewritten; 1.10 adds the count meta (B-4); 5.1 corrected (`Show activity` opens the activity panel, not the work log) and 5.5 adds the activity panel; Open questions and Handoff no longer wait on a removal decision | PM-5 (:51); Scope (:79-85); req. 1.10 (:147); 5.1, 5.5 (:263, :272); 15.2; Open questions; Handoff |

## Revision round 2

Gate 1 revise round 2 of 2 (final): the four findings of `task-description-review-r1.md` (REVISE 5/10). Findings 2
and 4 apply orchestrator decisions. Line numbers refer to this revision. `design-spec.md` §3 is aligned by the
designer in parallel and is not edited here.

| Finding | Change | Line / section |
| --- | --- | --- |
| 1 Serious: per-message metrics become turn-only aggregates | New 5.6: when a turn has more than one assistant message, the activity panel shows, under the 5.5 totals (now named the summary), one row per assistant message in message order with its own tokens, cost and duration, today's formatters, unknown values omitted; no breakdown for a single message. A3 rewritten (per-message split is shown, not dropped). Scope visibility note and PM-10 added. `parity-inventory.md` B-8, B-11, B-12 and "User-visible changes" now name the breakdown, so `move` is true | req. 5.5-5.6 (:310-324); A3 (:167-169); Scope (:83-86); PM-10 (:56); parity-inventory B-8, B-11, B-12 |
| 2 Serious: two definitions of `E` | Orchestrator decision: `E` = max over the turn's assistant messages of `timestamp + duration` only. Duration terms now state that no CLI lane, sub-agent or background-command completion time (persisted or not) and no agent run time after the last assistant message is an input, and that `S`/`E` are computed in the frontend from persisted message fields, identical live, after reload and after a tab switch. The A2 sentence allowing a persisted CLI completion time is deleted; A2 is now a settled statement, not a verification item. PM-7 and the A1-A3 risk row aligned | Duration terms (:121-128); A2 (:163-166); PM-7 (:53); Risks (:601) |
| 3 Moderate: T1-27 has no observable success condition | 4.7 now quotes F9 in full from `.ptah/specs/TASK_2026_629_c0b3/code-style-review-R9-phase.md:120-124` (the "phase style F1-F12" review of `handoff-12.md` §2 item 3), states where the defects are today (`subagent-tile.component.ts:64,75,80`; `background-agent-strip.component.ts:123-124`) and gives four checkable results (a) one status-label definition, at most one `'In background'` label definition in `libs/frontend`; (b) explicitly typed named-union status; (c) no `!` (criterion 6); (d) OnPush and optional `inject` kept. The F6-F12 table now cites each finding's line in the review and F9's row names its three defects instead of repeating the label. PM-9 cites the review file | req. 4.7 (:234-282); F9 row (:275); PM-9 (:55) |
| 4 Moderate: full-mode open state conflicts with its close control | Orchestrator decision: `full` open / `compact` closed at >= 960 px are initial defaults only; the toggle closes the `full` dock too; the manual Show/Hide choice is kept per tab in memory across tab switches (not across reload); a view-mode change resets it to the new mode's default; below 960 px the overlay opens only on the toggle. 6.1 and 6.6 rewritten, 6.7-6.9 added, 16.4 rewritten, PM-11 added | req. 6.1 (:333-336), 6.6-6.9 (:345-355); req. 16.4 (:542-546); PM-11 (:57) |

Proposed removals (user decision): none. The per-message breakdown (finding 1) keeps the only granularity that the
round 1 text would have lost; no other capability loss was found in this round.

## Delta 1 (user decisions)

Gate 1 was passed by the user (decisions.md row 22). This delta applies only the user decisions of decisions.md rows 21
and 23; nothing else was re-opened. `design-spec.md` and `prototype/` are aligned by the designers in parallel and are
not edited here.

| Decision | Change | Where |
| --- | --- | --- |
| Row 21: add an inspector TASK section | New requirement 17 (17 criteria): linked primary task above TODOS with ID, title, `TASK_STATUS_LABELS` status, phase when derivable, artifact links opened the way the git sidebar opens files, live refresh on `tasks:changed`, states for no task, missing folder, loading, error + Retry, several linked tasks (primary first, `+N more`), keyboard and list semantics. TODOS (requirement 10) unchanged. PM-12 (read-only, primary rule, phase omitted when not derivable). Scope in/out lists, Estimate, traceability note, NFR Performance (inside `@defer`, no tasks-ui board or `TasksStoreService` in the chat bundle), NFR Accessibility, NFR Backend (frontend only), stakeholder row, four risk rows, open question for the architect | Scope; Classification; PM-12; req. 17; NFRs; Stakeholders; Risks; Open questions; Handoff |
| Row 23: B-8/B-11/B-12 behind `Show activity` approved | Marked user-approved in the Scope visibility list; requirement 5.5-5.6 unchanged | Scope |
| Row 23: B-16 hover/focus-only not approved | Requirement 3.5: time and `You` / peer label visible at rest as today. Removed from the visibility-change list; listed under "not approved, stay as today". Parity B-16 and "User-visible changes" updated | req. 3.5; Scope; parity-inventory B-16 |
| Row 23: B-14/B-15 focus reveal not approved | Requirement 3.4: today's hover reveal unchanged (`message-bubble.component.html:311-314`), no focus reveal, no always-visible variant. NFR Accessibility records the exception; risk row added. Parity B-14, B-15 and "User-visible changes" updated | req. 3.4; Scope; NFR Accessibility; Risks; parity-inventory B-14, B-15 |

Requirement count after this delta: 17 numbered requirements (1-17).

Proposed removals (user decision): none. The TASK section adds a capability; it replaces nothing, so it adds no
parity row.
