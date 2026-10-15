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
`design-spec.md` (round 0, under Gate 1.7 revision) and `prototype/`.

## Classification

- Type: FEATURE — adds the inspector surface and replaces the compact presentation and the per-message collapse with
  the clean turn (decisions.md row 2).
- Estimate: XL — five feature areas across four frontend libraries (chat, chat-ui, chat-state, canvas), a replacement
  that needs a parity inventory, and 35 in-scope carry-over items, under a bundle budget with 0.01 MB headroom.
- Priority: not defined here (the repository and the user define no priority scale for this task).

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| PM-1 | The clean turn becomes the presentation of assistant turns in the session transcript (replacing the per-message auto-collapse and the assistant bubble chrome) and replaces the chat-host compact activity card. The per-tab view-mode toggle and its persistence stay as a capability (one condensed, one detailed presentation of the same session); the architect defines what each mode shows. The Rail card variant of `ptah-compact-session-card` (`variant 'rail'`, `SESSION_FORCED_CARD`) is not changed. | (a) clean turn = new `'compact'` mode only, full view untouched; (b) clean turn = only presentation, toggle removed; (c) as decided | task.md item 1 "replaces the compact view"; handoff-1 §1.1 and §4 (old compact = viewMode card + per-message collapse); design-spec §3, §12; removing the toggle or the detailed view would be a capability removal, which is user-reserved | yes |
| PM-2 | "N needs you" counts distinct pending requests (each permission request and each question once, by request identity), across the session and every lane it owns. A lane with two pending permission requests counts 2; a lane waiting on a question that is also listed as a session question counts 1. | count waiting agents; count agents + requests (design-spec §5, §9) | design-spec-review finding 3 (double count, no rule for several requests per lane); each request needs its own user action | yes |
| PM-3 | Existing specs whose assertions target markup this task intentionally replaces may be updated to the new markup so the suites keep passing. No new spec files and no new coverage are written. | freeze specs; write new specs | decisions.md row 3 (testing postponed; suites, typecheck, lint still run) | yes |
| PM-4 | T1 items that only change specs (T1-10, T1-13, T1-16, T1-17, T1-18) are deferred to T2. | do them now | decisions.md row 3; each item names a spec defect only (pr730-followup-map §T1) | yes |
| PM-5 | Parity rows where the design is silent default to keep. A row is `remove-proposed` only where design-spec.md defines an exhaustive anatomy that excludes the capability: user turn "with the bubble only" (§3), the action row "two 28 px icon buttons" (§3.6), the disclosure label `Worked for {m}m {ss}s` (§3.2). | mark every unplaced capability as a removal | design-spec-review finding 1 and its "Proposed removals" section; handoff-1 §3 item 1 | yes |
| PM-6 | Data without a source today (decisions.md row 9) is hidden or derived in the frontend; no backend change. | add backend sources now | decisions.md row 9 | yes |

## Scope

In scope:

- Clean assistant turn: live work log while streaming, auto-collapse to a `Worked for` disclosure on the final message,
  final answer, agent chip row, copy + activity actions, live `Orchestrating` line (design-spec §3).
- User turn re-skin with every capability listed as `keep`/`move` in `parity-inventory.md`.
- "This session" inspector in the chat view (both hosts) and as the re-skinned body of the Canvas Rail details aside:
  orchestrator card, AGENTS, TODOS, GIT; docked/overlay behaviour by container width (design-spec §2.1, §4).
- Permission and question routing from inspector rows and chips to a surface where the user can respond, including the
  Electron single chat view (T1-02, T1-07).
- Header chips (branch hint, `N needs you`, inspector toggle with dot) and composer chips (workspace, branch, approval
  mode, model and effort) (design-spec §5, §6).
- Staggered session-switch entrance with reduced-motion handling (design-spec §7).
- Carry-over items T1-01..T1-09, T1-11, T1-12, T1-14, T1-15, T1-19..T1-40 (requirements 12-14 and the traceability table).
- Keeping every chat-view surface the new view does not replace (stats strip with limits and budget, background tray,
  compaction notice and markers, banners, permission badge, question cards, queued-content indicator).
- `parity-inventory.md` rows marked `keep` or `move`.

Out of scope:

- Backend or RPC changes: ahead/behind per session, numeric lane progress ("212 of 340"), live background shell list,
  per-lane activity events, live turn start time, Gemini `CliType` — hidden or derived per PM-6 (decisions.md row 9); a
  later task if the user wants them.
- Vendoring a Gemini provider mark (`scripts/brand-icons.manifest.json`) — Gemini uses the `terminal` fallback
  (design-spec D5); optional follow-up.
- New spec files or new test coverage, including T1-10, T1-13, T1-16, T1-17, T1-18 and all of T2 — postponed by the
  user (decisions.md row 3).
- Any capability under "Proposed removals" in `parity-inventory.md` — removed only after the user approves it; until
  then it stays.
- Turning the workspace and branch composer chips into pickers — design-spec D8; reversible later.
- Contrast tuning for third-party theme-picker themes — the anubis pair is measured; one third-party light theme is
  spot-checked (NFR Accessibility); full coverage is follow-up T4.
- The Canvas Rail board card (`compact-rail-card`, `SESSION_FORCED_CARD`) visuals — not in the reference screenshots;
  only the Rail a11y/layout carry-over items touch the Rail.
- Housekeeping in handoff-1 §6 (worktree removal, empty folder, 628 note) — user-reserved, not this task.

## Requirements

### 1. Clean assistant turn

Requirement: the session transcript — shows each assistant turn as live work while it runs and as a short, final
answer when done — so the user reads the result without scrolling through tool output.

Acceptance criteria:

1. When an assistant turn is streaming and has no final text yet, the system shall show the work log expanded, the
   running tool rows with a spinner, a disclosure row reading `Working · {m}m {ss}s`, and no answer, chip row or action row.
2. When the final assistant message of a turn completes, the system shall collapse the work log and show the disclosure
   row `Worked for {m}m {ss}s` (or `{h}h {mm}m` at one hour or more), the final answer, the agent chip row and the action row.
3. When the final answer has arrived while delegated agents are still running, the system shall show the answer and
   chips with live statuses, keep the disclosure row reading `Working · ...`, and show the live line.
4. When the orchestrator answers without any tool call or agent activity, the system shall omit the disclosure row and
   the work log for that turn.
5. When the user has expanded a turn's work log by hand, the system shall keep it expanded when that turn's final
   message arrives, and expanding a done turn shall not change its duration label.
6. When the turn's start time cannot be derived (for example restored history without timestamps), the system shall
   label the disclosure `Worked` without a duration rather than showing a wrong or zero duration.
7. When the work log is collapsed, the system shall make its content unreachable by Tab and not announced by a screen
   reader; the disclosure button shall expose `aria-expanded` matching the visible state.
8. When the session is reloaded or the tab is switched back, the system shall render past turns in their done state
   with the same duration labels as before.

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
4. When the user has not approved the removal of Branch and Rewind (parity rows B-14, B-15), the system shall keep both
   actions reachable on user turns with their current enabled/disabled rules and labels.

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
6. When `C/organisms/execution/subagent-tile.component.ts` is changed for the chip, it shall contain no non-null
   assertions (today two at line 80, T1-28) and shall resolve the subagent-tile style findings F6-F12 of the R9 phase
   review (T1-27).

### 5. Action row and live line

Acceptance criteria:

1. When an assistant turn is done, the system shall show at rest (not hover-only) a `Copy message` button that copies
   the answer and a `Show activity` button that expands that turn's work log.
2. When a turn is streaming or its log is open with work running, the system shall hide the action row.
3. When any agent of the session is working, the system shall show the live line `Orchestrating · {m}m {ss}s`; when
   any request waits on the user, the verb shall read `Waiting for you`.
4. When the live line timer ticks, screen readers shall not hear per-second announcements (static label in a polite
   live region, timer hidden from assistive technology).

### 6. Inspector shell and responsive behaviour (T1-32)

Requirement: the "This session" inspector — sits beside the session at wide widths and over it at narrow widths — so
the same information is available in a 400 px VS Code sidebar, the Electron window and Rail panes.

Acceptance criteria:

1. When the session container is at least 960 px wide, the system shall dock the inspector at 336 px beside the thread.
2. When the container is narrower than 960 px, the system shall show the inspector as an overlay sheet with a scrim;
   below 640 px the sheet is full width.
3. When the overlay opens, the system shall move focus into the inspector (close button), make the content behind it
   inert, and keep Tab within the sheet.
4. When the overlay closes by Escape, the close button or the scrim, the system shall return focus to the inspector
   toggle in every case.
5. When the Rail host is narrower than 400 px, the system shall hide the 44 px "Open details" button and show the
   details (inspector) as an overlay instead of the 288 px aside (T1-32).
6. When the inspector toggle is activated, the system shall flip `aria-pressed` and its label between
   `Show session details` and `Hide session details`.

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
| T1-01 | 4.1 | T1-11 | 14.2 | T1-21 | 14.8 | T1-31 | 14.15 |
| T1-02 | 8, 9 | T1-12 | 14.3 | T1-22 | 14.9 | T1-32 | 6.5 |
| T1-03 | 14.1 | T1-13 | deferred (PM-4, spec only) | T1-23 | 14.10 | T1-33 | 14.16 |
| T1-04 | 8 | T1-14 | 14.4 | T1-24 | 14.11 | T1-34 | 14.17 |
| T1-05 | 4.5 | T1-15 | 14.5 | T1-25 | 14.12 | T1-35 | 14.18 |
| T1-06 | 13 | T1-16 | deferred (PM-4, spec only) | T1-26 | 14.10 | T1-36 | 14.15, 9.4 |
| T1-07 | 9.3 | T1-17 | deferred (PM-4, spec only) | T1-27 | 4.6 | T1-37 | 14.19 |
| T1-08 | 4.4 | T1-18 | deferred (PM-4, spec only) | T1-28 | 4.6 | T1-38 | 14.20 |
| T1-09 | 8.1 | T1-19 | 14.6 | T1-29 | 14.13 | T1-39 | 14.21 |
| T1-10 | deferred (PM-4, spec only) | T1-20 | 14.7 | T1-30 | 14.14 | T1-40 | 14.21 |

### 15. Replaced-surface parity

Acceptance criteria:

1. When the implementation is reviewed, every `keep` and `move` row of `parity-inventory.md` shall be reachable in its
   stated new location.
2. When a row is `remove-proposed` and the user has not approved its removal, the capability shall remain in the
   product.
3. When the per-tab view-mode toggle is used (tab item or Rail focus header), the session shall switch between a
   condensed and a detailed presentation and the choice shall survive a reload (PM-1).
4. When a Rail board card renders, it shall look and behave as before this task (compact rail card unchanged).

## Non-functional requirements

- Performance (bundle): the webview initial bundle is 3.49 MB against a 3.50 MB budget (handoff-1 §2, PR #730 CI). The
  initial bundle shall not exceed the budget: new UI loads lazily (`@defer`) or replaces existing code one to one, and
  code made unreachable by the replacement is deleted, not kept beside the new code. Measured by the existing CI budget
  check on the PR.
- Compatibility: VS Code webview (including the 400 px sidebar), Electron single chat view, and Canvas Rail panes shall
  each render the clean turn and the inspector; breakpoints are based on the session container width, not the window.
- Conventions: Angular standalone components, `OnPush`, signals and `inject()`; lucide-angular icons imported per
  component (`LucideAngularModule` + icon objects; `libs/frontend/ui` stays lucide-free); CLI lane icons via
  `ptah-provider-mark`; colours only through existing theme tokens (design-spec §1).
- Themes: dark `anubis` and light `anubis-light` shall both meet the contrast pairs in design-spec §8.2 (text 4.5:1,
  UI and focus 3:1); one third-party light theme is spot-checked by the visual reviewer.
- Accessibility: WCAG 2.2 AA as applied in design-spec §8 (the repository enforces 4.5:1 for muted text in
  `base-content-muted.spec.ts`); interactive targets at least 24 x 24 px; status never conveyed by colour alone;
  `prefers-reduced-motion` respected (requirement 13.3).
- Backend: no backend, RPC or shared-type change unless a row is added to `decisions.md` first (decisions.md row 9).
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

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| New inspector and turn UI push the initial bundle over 3.50 MB | HIGH | HIGH | Architect places inspector body and work-log detail behind `@defer` and deletes the replaced compact activity path in the same batch; team-leader confirms with the Electron renderer rebuild size before push |
| A capability of the message bubble or compact card disappears unnoticed | MEDIUM | HIGH | Code-logic reviewer checks every `keep`/`move` row of `parity-inventory.md` against the diff; remove-proposed rows stay until the user decides |
| `Review`/`Answer` looks actionable but leads nowhere in Electron | MEDIUM | HIGH | Architect specifies the route per request type and host before batching (requirement 9.3); visual reviewer exercises it in Electron |
| Needs-you count or agent status differs between header, chips and inspector | MEDIUM | MEDIUM | Single session-scoped aggregation (12.1, PM-2); architect defines request identity |
| Shared `CompactSessionCardComponent` change breaks the Rail board card | MEDIUM | MEDIUM | Team-leader keeps the `variant 'rail'` path out of the replacement batches; `compact-rail-card` and `canvas-rail-board` suites must pass |
| Regressions go unseen because testing is postponed | MEDIUM | MEDIUM | Existing suites, typecheck and lint per changed project (PM-3); visual review dark + light against the prototype |
| Derived data (todos, activity, durations) shown as if complete | MEDIUM | MEDIUM | Unknown/partial states of requirements 1.6, 7.2, 8.3, 10.5, 11.2 are review gates |

## Open questions

- Should the per-tab view-mode toggle remain once the clean turn exists (PM-1 keeps it)? Answer: the user, via the
  orchestrator, together with the removal question.
- Approve or reject each row under "Proposed removals" in `parity-inventory.md` (fork, rewind, per-message tokens/cost,
  collapsed tool/file counts). Answer: the user (removals are user-reserved).
- Exact route for `Review`/`Answer` per host and request type. Answer: designer revise round 1 (review finding 2), then
  the architect.

## Handoff

- Next specialist: software-architect, after design-spec revise round 1 passes Gate 1.7 and the user answers the
  removal question.
- Why: the shape is the open question — the session-scoped aggregation contract, the request routing per host, the
  `@defer` split under the bundle budget and the replacement of a component shared with the Rail card.
