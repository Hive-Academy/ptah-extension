# Requirements Review - TASK_2026_593_7c2e

Reviewer: cross-side requirements reviewer (not the author). Date: 2026-10-19.
Inputs: `context.md` (2026-10-19 expansion governs), `decisions.md` (#3, #4, #7), `task-description.md`,
`parity-inventory.md`, and the code in `.claude-worktrees/attention-notifications`.

## Verdict: REVISE

Blocking 0 · Serious 4 · Moderate 9 · Minor 7.

The document is well bounded overall. It gets the finished-turn removal, Clear all semantics,
host-neutral port placement, Zod at the boundary and most of the accessibility criteria right.
Four gaps go against what the user said they wanted (failures stay visible, one attention place,
private system notices, nothing distracting). Fix those before design starts. The Moderate items
can be fixed in the same pass.

## Spot-check of file:line references (27 checked)

| Reference (as cited) | Actual | Result |
| --- | --- | --- |
| `notification-ledger.service.ts:44` / `:45` LEDGER_LIMIT / BURST_MS | :44 / :45 | OK |
| ledger `:108` root-scoped note | :108-116 | OK |
| ledger `:140` pendingEntries | :140-151 | OK |
| ledger `:170` completion effect, `:173` voice guard | :170-182, :173 | OK |
| ledger `:202` markAllRead / `:210` dismissCompletion | :203 / :211 | off by one |
| ledger `:388` grouping / `:440` queueBurst | :389 / :441 | off by one |
| `notification-center.component.ts:45` bell, `:84` mute, `:98` Read all | bell :36-57 (badge :49), mute :80-92, Read all :94-102 | OK (approx.) |
| component `:106` pending rows, `:181` dismiss, `:250` toggle, `:277` activatePrompt | :106, :181, :251, :277 | OK |
| `notification-center.store.ts:59` focus | :59 | OK |
| `canvas-needs-you-queue.component.ts:52` chip, `:83`, `:106`, `:195`, `:234` | :52, :83, :106, :196, :235 | OK |
| `review-shell.component.ts:172` stale strip, `:181` conflict banner, `:482` | :166-175, :180, :480-490 | OK |
| `back-office-activity.service.ts:497` rate-limit | :497 | OK |
| `orchestra-canvas.component.ts:300` activity | :300 | OK |
| `electron-user-interaction.ts:130/143/156` | error :131, warning :144, info :157 | off by one |
| `vscode-user-interaction.ts:32` | :32-37 | OK |
| `angular-webview.provider.ts:291/309/323` | :291, :309, :323-329 | OK |
| `apps/ptah-electron/src/main.ts:354` second-instance | :354-359 | OK |
| `vscode-platform-commands.ts:26` ptah.main.focus | :26 | OK |
| `rpc.types.ts:1678` settings:get | :1678 | OK |
| `notification-sound.service.ts:3` MUTE_KEY | :3 | OK |
| `electron-shell.component.ts:301`, `app-shell.component.html:370` | :301, :370 | OK |

Every cited location exists and makes the stated claim. The off-by-one references are Minor (m1).

## Serious

### S1. "Failures" are not defined, so the doc can silently drop failed-turn and action failures

The user's decision (`context.md:84-86`) removes finished-turn notifications, and it names
"failures and other items that need the user" as items that do appear. Added scope 1
(`context.md:91-93`) says "Failures show a snackbar." The task description gates every failure on
being "actionable", and that word has no definition:

- The matrix row "Finished turn, including ... terminal failure merely indicating run ended" = No
  (`task-description.md` event table, last row). The parity row `notification-ledger.service.ts:170`
  removes success and failure completions together as `removed-user-approved`. Today a failed turn
  produces a red error row. The phase-based fallback is at `notification-ledger.service.ts:64-66`.
  The error classification sorts first at `:433-436`. The terminal reasons include `api_error`,
  `model_error`, `budget_exhausted`, `blocking_limit`, `prompt_too_long` and `turn_setup_failed`
  (`:67-98`). The user approved removing finished-turn notices. The user did not approve removing
  failure notices. As written, a provider error or an out-of-budget stop disappears from every
  attention surface.
- `ActionBannerService` has no actions at all (`action-banner.service.ts:20-25`). Its ~20 error
  call sites, for example `chat-view.component.ts:1771` "Rewind failed" and
  `session-budget-actions.service.ts:202,209` wrap-up failures, would all fail the "only when
  actionable" test. The migration row would then move nothing.

Fix:
1. Add a "Failure" definition to the doc. An attention failure is any of these: a terminal turn
   with `phase === 'failed'`, or a turn that ended with one of an explicit list of reasons. Write the
   reason list from `SdkTerminalReason`, for example `api_error`, `model_error`, `image_error`,
   `budget_exhausted`, `blocking_limit`, `rapid_refill_breaker`, `prompt_too_long`,
   `turn_setup_failed`, `malformed_tool_use_exhausted`, `structured_output_retry_exhausted`. State
   explicitly which reasons are not failures: `completed`, `aborted_*` (the user stopped the turn),
   `background_requested`, `hook_stopped`/`stop_hook_prevented`, `tool_deferred*`, `max_turns`
   (decide). Every failure gets at least an Open session action. That makes it "actionable" by
   definition.
2. Split parity row 15 into two rows. "Successful/neutral completion entries": `removed-user-approved`.
   "Failed-turn entries": `move`, to a failure attention item with Open session.
3. Add an acceptance criterion: "When a turn ends with a failure reason from the list, the system
   shall raise one failure item (snackbar, bell failure row, host notice under the host rule) with
   Open session. When a turn ends with a non-failure reason, it shall raise nothing."
4. Make the ActionBanner rule explicit. Errors and warnings become failure snackbars (tab-scoped,
   Open/Dismiss). Info messages ("Branch created.", `chat-view.component.ts:1700`) stay contextual.

### S2. Bell and canvas count different things today, and the doc does not settle the set

The user asked for one attention place (`context.md:98-99`). The two surfaces read different sets
today:

- Canvas includes CLI-agent lane permissions: `agents.pendingPermissions()` at
  `canvas-needs-you-queue.component.ts:148`, with kind `'lane-permission'` in
  `canvas-needs-you-queue.ts:8,99-100`, answered through `responder.respondLane` (`:204-210`). The
  bell has no lane permissions (`notification-ledger.service.ts:140-151`).
- Canvas is limited to tiles on the board (`canvas-needs-you-queue.component.ts:135-144`). The bell
  is cross-workspace.
- The bell renders a disabled "Target unavailable" row for requests with no resolvable tab
  (`notification-ledger.service.ts:312-327`, `notification-center.component.ts:109`). It silently
  drops `surfaceMode` requests (`:312`). It renders one row per attached tab (`:297-304`) but counts
  each source once (`:154-156`).

The doc mentions agent permissions only in a risk line ("including agent permission entries"). No
event row, acceptance criterion or parity row says whether lane permissions are attention items in
the bell, the snackbar and the OS notice. AC1 ("exactly one live attention item in the bell")
quietly changes the per-tab fan-out, and parity does not record that change.

Fix:
1. Add a matrix row "CLI agent lane permission request": snackbar, host notice and bell
   "Needs you", with Allow/Deny through the same responder. The other choice is to exclude it, with
   the reason. Pick one and record it in Decisions.
2. Add parity rows for lane permissions in the canvas, "Target unavailable" rows, the `surfaceMode`
   exclusion and multi-tab fan-out, each with a decision.
3. Add an acceptance criterion: "For any set of pending requests, the bell 'Needs you' count shall
   equal the number of unique unresolved request identities across all workspaces. The canvas count
   shall equal the subset whose session is on the active board. A test asserts both from one
   fixture that includes a lane permission and an unroutable request."

### S3. Session labels in OS notices can leak prompt text

AC16 allows a "safe workspace/session label" on OS and host text and never defines "safe".
Session titles are auto-derived from the session name or the first user message
(`notification-ledger.service.ts:361-363`). On a lock screen, in the Windows Action Center or in
the macOS Notification Center, that is user prompt text. Workspace folder names can also be
sensitive (client or project names). The user asked for this to be "system information"
(`context.md:79-80`), so it is outward-facing text. Under the role rules, this is a
privacy-category decision.

Fix:
1. Define the allowlist precisely. The default OS text is category + action only, for example
   "Ptah: a session needs permission" / "Ptah: a question is waiting" / "Ptah: a session failed".
   Add the workspace folder basename only. Never include the session title, unless a separate opt-in
   setting allows it.
2. Change AC16 to: "OS/host notice title and body shall be drawn only from {fixed category string,
   workspace folder basename, fixed action label}. A test feeds a request whose session title,
   question, tool input and error contain a canary string, and asserts that the canary is absent
   from the constructed notice."
3. If the team wants session titles on notices, send that to the user as a privacy decision. Do not
   assume it.

### S4. "Non-distracting" has no checkable bound

The user's central ask is a place "that doesn't cause distractions" (`context.md:78-79`). AC1 adds
one snackbar per new request. With N canvas tiles running in parallel, N snackbars stack with no
limit. The doc also never suppresses a snackbar when the request's own session is already visible.
The chat view already shows the permission or question card inline, so a snackbar there duplicates
it. "Snackbars never cover primary actions" (In scope, line 12) has no criterion a reviewer can
check.

Fix (outcome-level, the architect picks the mechanism):
1. Add an acceptance criterion: "When more than K attention items are live, at most K snackbars
   shall be visible, and the rest collapse into one summary ('N more need you') that opens the bell."
   Set K now (recommend 3) or list it as an open question for the designer. Do not leave it
   unbounded.
2. Add an acceptance criterion: "When the request's own session is visible and focused, the system
   shall not show a snackbar for that request. The bell and canvas still count it."
3. Make "never covers primary actions" checkable. Name the regions a snackbar must not overlap: the
   chat composer and send button, the permission card buttons, and the canvas dock. Verify each
   region in Electron, the VS Code sidebar width and canvas.

## Moderate

### M1. The VS Code retraction question is decided but still listed as open

`decisions.md` #7 settles it with stale-action invalidation and lets the architect evaluate
`window.withProgress({location: Notification})`. The task description still ends with
"## Clarifications Needed" asking the same question. The risk line says "seek the product decision
below". Fix: delete the Clarifications section, add decision #7 to the Decisions table, and reword
AC2/AC14 to accept either mechanism: "a stale host message shall perform no action and shall open
the session with 'already answered'. If the chosen surface is retractable, it shall close on
resolution."

### M2. VS Code multi-webview and the "hidden/unfocused" wording are inconsistent

The matrix says "VS Code when Ptah webview hidden/unfocused". AC14 says "not visible". VS Code
hosts a sidebar and editor-panel webviews (`angular-webview.provider.ts:315-317`, "Panel event
queues flush directly via createPanel"). Each one runs its own Angular instance. Fix: define
eligibility as "no Ptah webview (sidebar or panel) is visible", which VS Code can observe. Drop
"unfocused" or define it with `window.state.focused`. Require the host notice to be raised once,
from extension-host state, so two mounted webviews cannot raise it twice (extend AC4). State that
VS Code `show*Message` appears inside the VS Code window, not as an OS notification, so the user's
expectation is recorded.

### M3. No failure path for the OS notification dependency

No criterion covers `Notification.isSupported() === false`, OS-level notification permission
denied (macOS), or Focus Assist / Do Not Disturb. Fix: add "When the host cannot display a native
notification, the system shall keep the in-app attention surfaces, shall not throw or retry in a
loop, and shall log once." Also state the default value of the host-notice toggle. Recommend
enabled, because the user asked for system notices (AC15 is silent on it).

### M4. Git stale status as an OS notice contradicts "only items that need the user"

The matrix lets git stale status raise an OS/host notice "if user action remains needed". A git
timeout or lock usually clears on the next poll, and the existing strip only reports "showing the
last known changes" (`review-shell.component.ts:166-175`). Fix: git stale shows no OS/host notice.
Show the snackbar only while a git surface is open, plus a bell warning row. Also list the
first-read "unavailable" body notice (`review-shell.component.ts:71,191,477`) in parity as `keep`
(inline body state).

### M5. Back-office warnings are incomplete in parity

Parity lists only the rate-limit pause. The service also narrates warn-level states: embedder error
(`back-office-activity.service.ts:248-252`), indexing readiness `failed`/`degraded` (`:343`),
skill-synthesis error (`:492-495`), and the level mapping at `:462`. AC11 also assumes a "pause that
needs user intervention" exists. Nothing in the service distinguishes one today. Fix: add a parity
row for each warn-level kind, with a decision. Either name the concrete intervention action and its
backing RPC, or state that no back-office item becomes attention in this task, so AC11 reduces to
"stays contextual".

### M6. Voice-session sound guard is listed as "keep" but is a behaviour change

Today the guard applies only to completion pulses (`notification-ledger.service.ts:173`). New
pending prompts always pass `soundEligible = true` (`:195`, default at `:444`). Removing
completions removes the only guarded path. AC20 adds new behaviour. Fix: change the parity
decision to `move` with the new rule. Specify whose voice session suppresses the sound: the
request's tab (today's semantics) or any active voice session. Also list the existing 2000 ms
sound cooldown (`notification-sound.service.ts:4`) and the `NOTIFICATION_AUDIO_ENABLED` token
(`:6`).

### M7. The phasing never builds the snackbar host

Phase A covers the "attention model and bell/canvas cleanup". Phase B covers host notices.
Phase C covers migration. No phase mounts the snackbar host in `electron-shell.component.ts`,
`app-shell.component.html` and canvas, and Phase C depends on it. Fix: Phase A owns the shared
attention contract (types, plus any `rpc.types.ts` additions) and the snackbar host. B and C start
after A. Name the overlapping files that make B and C not file-disjoint: the shell templates and
`libs/shared/src/lib/types/rpc.types.ts`. Assign each overlapping file to one phase.

### M8. Possible file overlap with TASK_2026_702_594d at `orchestra-canvas.component.ts`

TASK_702 edits the dock in `orchestra-canvas.component.ts:149-193,584-628` and keeps the ticker and
needs-you mount (`:85-141`) as-is (702 `parity-inventory.md:26`). This task's Phase C back-office
migration touches the ticker region (`orchestra-canvas.component.ts:101-113,300`). Out-of-scope
line 25, "integrates shared attention state where that screen consumes it", is vague, and the start
screen does not consume attention state. Fix: state that this task does not edit the start-screen
or setup-card files. Its canvas changes are limited to `canvas-needs-you-queue*.ts`. Any change to
`orchestra-canvas.component.ts` (ticker) is limited to the ticker block, and is rebased after 702
merges or coordinated through the orchestrator.

### M9. ActionBanner parity has one row for about 20 call sites and loses its behaviour

The single row (`action-banner.service.ts:2,62`) omits these behaviours: tab-scoped versus global
banners (`:7-11`), the latest message replacing the prior one (`:14-16`, `:105-117`), 4 s/8 s
auto-clear (`:27-28`), `clear()` (`:97-103`), the render site in `chat-view.component.ts:355-390`,
and the second caller `session-budget-actions.service.ts:202,209`. Fix: list each behaviour with
keep/move, and group the call sites by kind (error/warning/info) with the S1 rule applied.

## Minor

- m1. Correct the off-by-one references: ledger `:202→:203`, `:210→:211`, `:388→:389`,
  `:440→:441`; `electron-user-interaction.ts :130/:143/:156 → :131/:144/:157` (also in Decisions).
  Canvas `:195→:196`, `:234→:235`.
- m2. Parity omits small bell and canvas behaviours: focus moves to the first enabled row on open
  (`notification-center.component.ts:255-261`). Escape closes the bell and restores focus (`:68`,
  `:264-268`). Canvas closes on outside pointer and on Escape, with focus return
  (`canvas-needs-you-queue.component.ts:156-177`). Canvas auto-closes when emptied (`:179-184`).
  Canvas has a double-answer guard (`:186-225`). List them as `keep`. AC17 depends on them.
- m3. AC19 "pass the project's accessibility checks" is vaguer than the original acceptance
  (`context.md:63`, axe no critical/serious, dark and light). Restore that wording.
- m4. "Snoozed from view" (In scope, line 12) and "transient presentations" (AC7) are undefined.
  Say whether Clear all hides a live request's snackbar. Recommended: it hides the snackbar, and
  the request stays in "Needs you".
- m5. Define the badge count: unresolved unique requests plus unread failure rows? Today it is
  `bg-error` for everything (`notification-center.component.ts:51`). AC5 covers only requests.
- m6. The deliverable deviates from the PM output contract. It has no `## Handoff` (next
  specialist), the risks are a list rather than the Likelihood/Impact/owner table, and there is no
  `## Open questions`. Add a Handoff entry: ui-ux-designer, then software-architect, as
  `context.md:69` says.
- m7. The voice-provider row says "OS when eligible". The failure happens during an active
  in-app voice interaction, so recommend no host notice for it. Preserve FR-7.3, "never
  auto-applies the switch" (`voice-provider-error-toast.component.ts:24-25`), as an explicit
  acceptance criterion.

## Checks against the brief

| Check | Result |
| --- | --- |
| (1) Parity complete, removals approved | Mostly. The completion removal is approved. The failed-turn rows are an unapproved removal under the current wording (S1). Lane permissions, unroutable rows, back-office warnings and ActionBanner behaviours are missing (S2, M5, M9). |
| (2) Matrix matches intent | Attention-only, Clear all, "Needs you" first and no finished-turn rows are all correct. Failures are under-specified (S1), one attention place is unsettled (S2), non-distracting is unbounded (S4), and git raises OS notices (M4). |
| (3) Criteria checkable | Good coverage of Electron focus, VS Code reveal, keyboard/SR, reduced motion, multi-workspace and answered-elsewhere. Gaps: multi-webview (M2), OS dependency failure (M3), snackbar cap (S4), axe (m3). |
| (4) Host-neutral architecture | Satisfied: platform-core port, Electron/VS Code/CLI adapters (platform-cli exists), no electron/vscode imports, Zod at the boundary, settings-core schema. |
| (5) Privacy | Intent is right. The session-title leak needs closing (S3). |
| (6) Phasing | The snackbar host is missing and shared files are not assigned (M7). |
| (7) No overlap with TASK_702 | Ownership of the chip is clean. `orchestra-canvas.component.ts` needs an explicit boundary (M8). |

## Round 1 re-review

Inputs: `decisions.md` #8-#11, `task-description-revision-1.md`, the revised `task-description.md`
(the "Revision 1 requirements" section, AC22-31, the new Decisions/Risks/Handoff sections) and
`parity-inventory.md` (the "Revision 1 parity additions" table). I checked the new references
against the code again: `back-office-activity.service.ts:248-252,343,462,492-497`,
`canvas-needs-you-queue.component.ts:148,156-225`,
`notification-ledger.service.ts:64-98,154-156,297-327,433-436,444`,
`notification-sound.service.ts:4,6`, `review-shell.component.ts:71,191,477`. All of them are
correct.

### Verdict: REVISE

Open items: Blocking 0 · Serious 1 (new, R1) · Moderate 1 (new, R2) · Minor 4 (new, R3-R6).
All 20 original findings are resolved.

### Status of the original findings

| ID | Status | Evidence in revision |
| --- | --- | --- |
| S1 | Resolved | The failure definition lists the terminal reasons and phase `failed`, lane failures and ActionBanner errors/warnings. The non-failure reasons are listed too. AC22 covers it. The parity rows split success/neutral completions (`removed-user-approved`) from failed turns (`move`). |
| S2 | Resolved | One pending model covers chat permissions, questions and lane permissions. The bell counts all of them and the canvas counts its active-board subset. Unroutable and surfaceMode requests are counted once and tab fan-out is collapsed. AC23 covers it, and parity has a row for each. |
| S3 | Resolved | Host text uses a fixed label, the workspace basename, the agent/provider name and the tool name. Session titles are excluded unless the user opts in (off by default). The canary test is AC26, and decision #10 records it. |
| S4 | Resolved | At most 3 snackbars plus "+N more". No snackbar for a focused, visible session. The no-overlap regions are named. AC24-25 cover it. |
| M1 | Resolved | The Clarifications section is gone. The stale-action rule allows a retractable surface. Decision #7 is reflected. |
| M2 | Resolved | VS Code eligibility means no Ptah sidebar or panel webview is visible. The host emits once per request. The doc notes that `show*Message` is not an OS notice. AC14 and AC26 cover it. |
| M3 | Resolved | Unsupported or denied notifications fall back to in-app attention and log once (AC27). The defaults are stated: general notices on, failure notices off. |
| M4 | Resolved | Git stale shows a warning only while a git surface is open, plus a bell row, with no host notice (AC10). The first-read body stays inline. |
| M5 | Resolved | The embedder, indexing and synthesis-error warnings have parity rows and stay contextual. The rate-limit pause decision is challenged under R1. |
| M6 | Resolved | The voice guard is now `move` with request-tab semantics. The cooldown and audio gate are listed (AC20, AC31). |
| M7 | Resolved | Phase A owns the contract, the `rpc.types.ts` additions, the snackbar host and the shell mounts. B and C follow, and C does not edit the shells or `rpc.types.ts`. |
| M8 | Resolved | Only `canvas-needs-you-queue*.ts` changes for the chip. Any `orchestra-canvas.component.ts` change is limited to the ticker block, coordinated or rebased after TASK_702. TASK_702 owns the start-screen files. |
| M9 | Resolved | Parity has rows for scope, replacement, timeouts, clear, the render site and the callers. |
| m1-m7 | Resolved | The references are corrected, the focus/Escape/auto-close/double-answer rows were added (AC29), the axe wording is restored (AC30), Clear all is defined (AC28), the badge is defined, the Handoff and Risks tables were added, and the voice switch is never automatic (AC31). |

### New findings (regressions from revision 1)

#### R1 (Serious). Info toasts bring back the non-attention notices the user asked to remove

The revision adds a global "keyed info toast with history" for ActionBanner info, including the
routine "Branch created." (`chat-view.component.ts:1700`), and for the skill-synthesis rate-limit
pause on every page (AC11). The bell badge now also counts unread info rows. This goes against
three things:

- The user's own decision (`context.md:84-86`): "Only attention items appear (permission requests,
  ask-user questions, failures and other items that need the user)". A rate-limit pause has no
  user action (the revision says so itself: "no concrete intervention action is exposed"), and
  "Branch created" is routine success feedback. Decision #8 ("Info notices stay as keyed info
  toasts") is an orchestrator decision. It reads the 2026-10-02 lines that the 2026-10-19
  expansion supersedes (`context.md:71`).
- The doc's own unrevised lines, which leave AC11 contradicted inside the same document:
  In scope line 16 ("Keep ordinary success feedback and non-actionable progress contextual"),
  Out of scope line 23 ("Passive back-office progress, routine successful actions ... do not need
  user intervention"), and the original parity rows for the back-office pause and ActionBanner
  ("passive rate-limit progress remains contextual activity", "ordinary success stays
  contextual").
- The "doesn't cause distractions" requirement: a badge that lights up for "Branch created" is
  the bell full of non-attention rows that the user complained about.

Fix (pick one and record it in Decisions):

1. (Recommended) ActionBanner info stays tab-local and contextual. Its existing inline banner
   behaviour moves to an in-tab presentation, not the global toast stack, and it is not in the
   bell. The rate-limit pause stays in the back-office ticker, or at most appears as a bell
   history row that does not raise the badge and has no snackbar. Rewrite AC11 to match, and
   drop "info" from the badge definition.
2. If the orchestrator wants global info toasts anyway, treat that as a scope-intent question and
   put it to the user (it reverses their "only attention items" answer). Do not settle it inside
   the requirements.

#### R2 (Moderate). The event-to-surface matrix was removed

The revision replaced the "Event-to-surface contract" table with prose spread across five
paragraphs. Its rows no longer exist anywhere, and the unrevised AC1-21 still refer to "the host
rule". Restore one table with these columns: event | snackbar (persistence) | host notice (when,
which setting) | bell (section, counted in badge?) | sound/announce. Add one row per event class:
chat permission, question, lane permission, failed turn, lane failure, ActionBanner error/warning,
ActionBanner info, git stale, rate-limit pause, back-office warnings, voice failure, and
successful turn. Reviewers and the designer check against that table.

#### R3 (Minor). Superseded lines still sit beside their replacements

"Supersedes conflicting lines above" makes the document legal but slow to read. Update or delete
these:

- In scope lines 11 and 16.
- Out of scope lines 23 and 25 ("integrates shared attention state where that screen consumes it"
  now conflicts with the M8 ownership rule).
- The original parity rows for the back-office pause, ActionBanner and git stale, which now
  disagree with the additions table.

#### R4 (Minor). Encoding damage and a wrong path in `parity-inventory.md`

- Mojibake appears in 4 places (`â€œNeeds youâ€`, `â€œAll clear / N need youâ€`), and
  `task-description.md` gained a BOM. Save both as UTF-8 without a BOM.
- The ActionBanner rows cite `libs/frontend/chat/src/lib/chat-view.component.ts`, which does not
  exist. The real file is `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`.

#### R5 (Minor). What activating a surfaceMode request does is undefined

surfaceMode requests are now counted. They route "to its own chrome instead of the standard chat
surface" (`libs/shared/src/lib/types/permission.types.ts:78-80,192-194`), so "Open session" has
no obvious target. State what bell, snackbar and host activation do for them. For example: focus
the owning surface when it is known; otherwise show a disabled row labelled "Answer in <surface>",
like "Target unavailable".

#### R6 (Minor). The failure-notice sentence is ambiguous

"Failed-turn and lane failures have a snackbar, bell failure row, and OS/host notice only under
the separate failure notice setting" can be read as the setting gating all three surfaces. AC22
says only the host notice is gated. Reword it: "... have a snackbar and a bell failure row; their
OS/host notice appears only when the failure host-notice setting (off by default) is enabled."

### What it takes to approve

Fix R1, by option 1 or by an explicit user answer. R2-R6 are cleanup and can go in the same
pass. Nothing else blocks the designer or architect handoff.

## Round 2 re-review

Inputs: `decisions.md` #12 and #13, `task-description-revision-2.md`, the revised
`task-description.md` (scope, out of scope, AC1-35, the event-to-surface matrix, phasing,
decisions and risks) and `parity-inventory.md`. For #13, I also cross-checked TASK_2026_702_594d
`decisions.md` #9.

### Verdict: APPROVED

Open items: Blocking 0 · Serious 0 · Moderate 1 (N1) · Minor 3 (N2-N4). None of them block the
designer or architect handoff. The team-leader can close them during decomposition.

### Status of R1-R6

| ID | Status | Evidence |
| --- | --- | --- |
| R1 | Resolved | The badge counts only unique "Needs you" requests (attention rules and matrix "Badge count" column). Failures and actionable warnings go to a snackbar plus "Recent notices" with no count. ActionBanner info and "Branch created" stay tab-local (AC33, matrix row "ActionBanner info/success"). Routine back-office progress has no presentation (AC11). The original user intent ("only show important details") is now met. Decision #12 is recorded. |
| R2 | Resolved | The event-to-surface matrix is restored with the requested columns and all 12 event classes. A paragraph below it spells out host background eligibility and states that the failure setting gates only the host column. |
| R3 | Resolved | The in-scope and out-of-scope lines are rewritten. Out of scope now says the task does not edit the dock or `orchestra-canvas.component.ts`. The superseded parity rows ("Back-office synthesis paused", "Tab-scoped branch/rewind", "Actionable failure or intervention only") are gone. |
| R4 | Resolved | No mojibake is left in either file, `task-description.md` has no BOM, and the ActionBanner rows cite `components/templates/chat-view.component.ts`. |
| R5 | Resolved | The surfaceMode activation rule covers both the owner-known and the unavailable case ("Answer in <surface>"). AC32 covers it, and parity row 42 records it. |
| R6 | Resolved | The matrix paragraph and AC22 both say the failure host setting gates only OS/host notices. |

### Decision #13 (dock, chip and ticker removal)

| Check | Result |
| --- | --- |
| Removal approved and marked | The parity rows for the chip (20), dock (23), popover close behaviours (46-47) and ticker (54) are `removed-user-approved`. Proposed Removals cites #13. This matches 702 `decisions.md` #9. |
| Chip capabilities kept | Allow/Deny (21), Open (22), lane permissions (40) and the double-answer guard (48) are `move` to the bell, each with a named new spec. AC1, AC21, AC23 and AC29 cover lane permissions in the bell. |
| Back-office failures kept | The embedder, indexing and synthesis-error rows (51-53) move to a failure snackbar plus Recent notices. AC35 covers it. |
| Chip references gone from the criteria | No acceptance criterion still mentions the canvas count or popover. AC15 keeps "canvas is open" only as a page context. |
| File overlap with TASK_702 | Clean. This task does not edit `orchestra-canvas.component.ts` or the dock. TASK_702 owns removing the dock, chip mount and ticker. |

### New findings

#### N1 (Moderate). The fate of the chip files and the merge order are unassigned

TASK_702 #9 "unmounts" the chip. No document says who deletes
`libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts`, `canvas-needs-you-queue.ts`
and their spec. The bell may want to reuse the lane-permission mapping (`buildNeedsYouItems`,
`canvas-needs-you-queue.ts:8,99-100`). The repo rule "delete unused code" applies, and orphaned
files would survive both tasks.

The Risks row "Dock removal strands lane permission actions" also depends on merge order: the
bell lane actions must land before TASK_702 removes the dock. The owner on that row is "Frontend
implementer", but no single implementer controls the order of two branches.

Fix:
1. State that this task, in Phase A, moves or extracts the lane mapping it needs and deletes the
   chip files and spec once TASK_702 has unmounted the chip. TASK_702 only removes the mount.
2. Make the orchestrator or team-leader the owner of the merge-order constraint: the 593 Phase A
   bell lane actions land before, or together with, the 702 dock removal.

Also flag this to the orchestrator: TASK_702 #9 turns the three dock warnings into "dismissable
local board snackbars". Those should be built from the same snackbar primitive as this task's
host, or kept inline, so the app does not end up with two snackbar systems.

#### N2 (Minor). The overlap criterion dropped the canvas page

In scope (line 12) still shows snackbars on canvas. AC25 now checks placement only "at Electron
and VS Code sidebar sizes". Add the canvas board, and name the tile composer and the inline
permission cards, so the no-overlap rule is still checked where many sessions run.

#### N3 (Minor). A stale Risks heading and owners

The heading still reads "Risks and mitigations (revision 1)". The owners are generic implementer
roles, and the merge-order risk belongs to the team-leader or orchestrator (see N1). Rename the
heading and set the owners.

#### N4 (Minor). Git stale has three presentations

AC10 keeps three presentations for one git timeout: a dismissable local strip, a snackbar while
the git surface is open, and a Recent notices row. Decision #12 makes this consistent with the
rules, but the snackbar shows on the same surface as the strip. The designer should confirm that
both earn their place (for example, snackbar only when the strip is scrolled out of view or
already dismissed). This is a design-stage note, not a requirements change.

No regressions were found in the host-neutral constraints (platform-core port, Electron, VS Code
and CLI adapters, Zod at the boundary), in the privacy allowlist (AC16, AC26) or in the phasing
(A, then B, then C, with the shells and `rpc.types.ts` owned by A and B).
