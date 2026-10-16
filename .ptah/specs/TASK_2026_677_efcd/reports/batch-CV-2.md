# Batch CV-2 report

Executor: frontend-developer (Claude sub-agent), W6, parallel with the C-3 canvas lane. No git, no nx / jest
run (decisions row 59). Not committed. F = `libs/frontend`, paths under the worktree
`D:\projects\ptah-extension\.claude-worktrees\clean-session-view`.

## Files

| Path | Action | One line |
| --- | --- | --- |
| `F/chat/src/lib/components/templates/chat-view.component.ts` | MODIFIED | `showCompactCard` narrowed to the forced card; `resolvedViewMode` + `isCompactViewMode` import removed (no consumer left); header computeds (`needsYouCount`, `headerBranch`, `inspectorDot`, `limitCue`, `contextRingPercent`, `toggleDescription`, `headerChipAddons`, `headerActionAddons`); session-switch stagger (`wireSessionSwitchStagger`, `playEnter`, `clearEnterTimer`, `ENTER_CLASS_MS`); imports `SessionHeaderComponent`, `NgComponentOutlet`. Every 648 behaviour (`forgetWorkflowSession` in `deleteOriginalSession`) untouched. |
| `F/chat/src/lib/components/templates/chat-view.component.html` | MODIFIED | Header block (A2 binding contract + Delta 3 inputs, add-on outlets in both slots via `ngProjectAs`) at the top of the session branch; compact branch now forced-card only (comment); composer wrapper `class="flex-shrink-0 st-f" style="--d: 120ms"`. |
| `F/chat/src/lib/components/templates/chat-view.component.css` | MODIFIED | `ptahStaggerUp` / `ptahStaggerLeft` keyframes, `:host(.is-entering)` rules for `.st-f`, `.st-t[data-st-i]`, `.st-r`, reduced-motion block (animation none, delay 0). +54 lines. |
| `F/chat/src/lib/components/molecules/session-header/session-header.component.ts` | MODIFIED (second owner, M-11) | `inspectorDot` widened to `'need' \| 'err' \| 'sel' \| null` (+ `err` dot rule); new inputs `limitCue`, `contextRingPercent`, `toggleDescription`; limit chip, 28 px `ptah-context-ring` in the toggle, per-instance `aria-describedby` description. |
| `F/chat/src/lib/tokens/session-workflow-addons.token.ts` | MODIFIED (H1-H2) | `sessionWorkflowKind` returns `tab?.workflow ?? null`; `workflowKind: WorkflowKind`. |
| `F/chat/src/lib/components/templates/chat-view.component.spec.ts` | MODIFIED | `modelFor` stub returns a signal; compact-gate describe updated (see Spec changes). |
| `F/chat/src/lib/components/templates/chat-view.dock.spec.ts` | MODIFIED | `modelFor` stub returns a signal (one line + comment). |
| `F/chat/src/lib/components/templates/chat-view.keepalive.spec.ts` | MODIFIED | `modelFor` stub returns a signal (one line + comment). |

`chat-view.memo.spec.ts`: unchanged (it never constructs `ChatViewComponent`).

## Acceptance

| Item | Evidence |
| --- | --- |
| Header renders above the one branch (main panel) | `chat-view.component.html:26-63` (`@if (hostsInspector() && resolvedActiveTab(); as headerTab)` at the top of the `@else` session branch). The forced card hosts no inspector, so header and card never coexist. |
| `bare` embed / tile / forced card: no header, chips or dot (row 85) | header gated by `hostsInspector()` = `!bareChrome && !_sessionContext && !forced` (`chat-view.component.ts:1097-1105`, CV-1). Absent / `'full'` token: unchanged. |
| `aria-controls="inspector"` (row 90) | `chat-view.component.html:29` `inspectorId="inspector"` -> `session-header.component.ts:177` `[attr.aria-controls]`; CV-1's `id="inspector"` host at `chat-view.component.html` inspector block. |
| Compact card shows only when forced; compact view renders the transcript | `chat-view.component.ts:927-929` `showCompactCard = computed(() => this._forcedCard?.() ?? false)` (pattern from batch notes). The transcript reads `viewMode` itself (A1-3, decisions row 93). |
| Forced Rail card path (A-5) untouched; `expandToFullView` kept only because the forced branch binds it | `chat-view.component.html:8-18` (`(expandToFull)="expandToFullView()"`), `chat-view.component.ts:2093`. |
| Stagger keyed on `resolvedTabId` | `chat-view.component.ts:1200-1212`: effect on `resolvedTabId()`, plays when it becomes a non-null id different from the last one; a view-mode switch or a first session id does not replay (req 15.7). Wired for every host in the constructor `:1413`. |
| `playEnter()` in `afterNextRender`; one `.st-t` index pass `--i = min(k+1, 8)` in DOM order | `:1207-1210` (`untracked(() => afterNextRender(..., { injector }))`); `:1220-1240` one `querySelectorAll('.st-t')` inside the shown transcript, `setProperty('--i', String(Math.min(k + 1, 8)))`. |
| Restart + timer released | `:1228-1239` remove class, `void host.offsetWidth`, add class, clear previous timer, one `setTimeout` (outside Angular) of `ENTER_CLASS_MS` (`:175`); released in `ngOnDestroy` (`:700`). No observer, no per-item timer. |
| Late-mounted items get no animation | only indexed items carry `data-st-i` (`:1227`), CSS `:host(.is-entering) ::ng-deep .st-t[data-st-i]` (`chat-view.component.css:227-230`). See Decisions 2. |
| `ptahStaggerUp` keyframes + reduced-motion block | `chat-view.component.css:200-209`, `:238-245` (animation none + delay 0). Also `ptahStaggerLeft` for B-4's `.st-r` rows (`:211-235`, A2 component 4). Only `opacity` / `transform` animate. |
| Composer wrapper `st-f`, `--d:120ms`; header `st-f` delay 0 | `chat-view.component.html:262`, `:28`; CSS `:222-225` (`animation-delay: var(--d, 0ms)`). |
| Header binds the dot directly | `chat-view.component.html:34` `[inspectorDot]="inspectorDot()"` = `limitAwareDot(shell.showDot(), shell.isOpen(), stats.inputs()?.limitSummary ?? null)` (`chat-view.component.ts:1145-1151`); replaces A2's `shell.isOpen() ? null : shell.showDot()` (M-10). |
| Limit chip (`Limit near` / `At limit`, `role="status"`, 22 px, glyph dropped < 440 px, `title` + sr-only `: {fullText}`, only closed and not `none`) | `session-header.component.ts:147-167` (markup), `:247-252` (`shownLimit`), `:64-68` (`@container (max-width: 439px)` hides the glyph), `:80-93` (55 % need / err borders). |
| Context ring 28 px around `panel-right` while closed and known | `session-header.component.ts:184-191`, `:254-256`; value `stats.inputs()?.context.percent ?? null` (`chat-view.component.ts:1157-1159`). |
| Toggle description (`aria-describedby`, per-instance id, name unchanged) | `session-header.component.ts:179`, `:201-203`, `:212`; `aria-label` still `toggleLabel()` (`:178`). Text = `inspectorToggleDescription(context, limitSummary, needsYouCount)`, `''` without stats (`chat-view.component.ts:1162-1172`). |
| All cues from `stats.inputs()` (one source); none while open | the three computeds read only `this.stats.inputs()` (`:1145-1172`); the header hides chip, ring and description when `inspectorOpen()` (`session-header.component.ts:247-260`); `limitAwareDot` returns `null` when open. |
| Add-on outlets; empty list renders nothing | `chat-view.component.html:43-62` (`@for` + `*ngComponentOutlet="addon.component; inputs: { tabId }"` inside `ngProjectAs` containers); lists from `workflowAddonsFor(SESSION_WORKFLOW_ADDONS, sessionWorkflowKind(tab), slot)` (`chat-view.component.ts:1174-1190`), `[]` with no registration. |
| D-O7: no model text in the main column except the composer selector | grep over `chat/src/lib/components/**/*.html` for `modelDisplayName`, `formatModelName`, `Model `: 0 hits. Inline-template `Model` text exists only off the main column: `agent-card-header.component.ts:96` (Agents side panel), `inspector-agents-section.component.ts:200` and `lane-usage-tile.component.ts:133` (inspector), `chat-input.component.ts:420` (the composer group). |
| Component-style budget 20 kB | `chat-view.component.css` gains ~1.6 kB of source (54 lines). |
| Chat suite green | NOT run here (row 59): team-leader MODE 2 runs `cv2-test`, `cv2-typecheck`, `cv2-lint`. |

## H1-H2

- H1: `sessionWorkflowKind(tab)` now returns `tab?.workflow ?? null`
  (`F/chat/src/lib/tokens/session-workflow-addons.token.ts:44-48`). This turns on, with no further edit, the
  controller's workflow initial-open (`inspector-shell.controller.ts:125`), its `sel` dot (`:153`) and the header
  add-on lookup built in this batch.
- H2: `SessionWorkflowAddon.workflowKind: WorkflowKind` (`:20`), imported as a type from
  `@ptah-extension/chat-types` (the alias the file already used for `TabState`). To keep the types honest the
  return type of `sessionWorkflowKind` and the `kind` parameter of `workflowAddonsFor` narrow to
  `WorkflowKind | null` too.
- Fallout: none. Consumers are `inspector-shell.controller.ts` (`!== null` check, compiles unchanged), the chat
  barrel (re-exports names only) and chat-view (this batch). No registrant of `SESSION_WORKFLOW_ADDONS` exists
  anywhere in `libs/` or `apps/`, and no spec references either function.

## Spec changes

- `chat-view.component.spec.ts`, `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`: the
  `SessionInspectorStore` stub's `modelFor: jest.fn()` returned `undefined`; the header (needs-you count) and
  `shell.showDot()` now call `modelFor(tabId)()` whenever the template renders with a tab, so the stub returns
  `signal({ needsYouCount: 0 })`. No assertion changed in dock / keepalive.
- `chat-view.component.spec.ts`, describe renamed `compact card gate (forced only)`:
  - `renders the compact card for "compact"` -> `renders the transcript under the session header for "compact"`:
    asserts no compact card, a `ptah-session-header`, `ptah-chat-input` and the sidebar tab (behaviour changed
    by A-6 retirement).
  - `forces a compact card ...`: the two `resolvedViewMode()` reads are removed (member deleted, no consumer);
    adds "no `ptah-session-header` while forced". Other cases unchanged.
- Not added (instruction: no new cases beyond changed behaviour): dedicated header cases for count chip copy,
  toggle `aria-pressed`, dot kinds, limit chip, ring and description. The batch's "Existing specs to update"
  names them, but no existing case asserts them; the phase reviewer / senior tester may want them in
  `chat-view.component.spec.ts`.

## Diagnostics

`ptah_get_diagnostics` (TypeScript compiler, severity error) with `files` = the six changed `.ts` files:

- `chat-view.component.ts`, `session-header.component.ts`, `session-workflow-addons.token.ts`,
  `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`: no errors.
- `chat-view.component.spec.ts`: only the pre-existing errors CV-1 already reported (SubagentRecord casts
  `:1365-1392`, protected `resolvedResumableSubagents` `:1535-1558`, private `panelResizeService` `:2010-2109`;
  line numbers shifted by the stub comment). None in lines this batch edited.
- Sibling chat spec errors listed by the tool are pre-existing (agent-card-truncation, chat-input,
  compact-lane-rows, compact-session-card, execution-node...), untouched.
- Templates are outside this tool; checked by hand: `@let` + `@if (ringPercent !== null)` narrowing,
  `[size]="28"` against `44 | 28`, `ngComponentOutletInputs` microsyntax, `headerTab.title` / `.id` on
  `TabState`, every bound member exists and is `protected`/public. MODE 2 `cv2-typecheck` confirms.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| 1. Header renders only with a tab: `@if (hostsInspector() && resolvedActiveTab(); as headerTab)`, title `headerTab.title \|\| 'New Chat'` | plan binding `@if (hostsInspector())` + `title ?? ''` | with no tab the toggle cannot act (`InspectorShellController.toggle` returns without a tab) and the empty state owns the screen; an empty `h1` is an a11y gap; `'New Chat'` is the fallback `agentParentTitle` already uses (`chat-view.component.ts`) | yes |
| 2. Items mounted after the index pass do not animate (`data-st-i` marker + `.st-t[data-st-i]` selector) | plan A2 component 4: CSS fallback `var(--i, 8)` so late mounts still animate | batches.md CV-2 validation note "late-mounted items get no animation" is the newer, batch-level rule; it also keeps scroll-window mounts during the 1 s window still. One attribute write per indexed item, no extra query | yes (drop `[data-st-i]` from the selector) |
| 3. Index pass scoped to the shown transcript (`ptah-chat-transcript[data-tab-id=tabId]`) | `hostEl.querySelectorAll('.st-t')` over the whole host | the main panel keeps retained transcripts mounted but `display:none` (`chat-transcript.component.ts:276`), so a host-wide pass would spend the 8 indexes on hidden items; same single query | yes |
| 4. Stagger plays on the first non-null tab id as well (mount = entering a session) | only on a change after the first | plan wording "changes to a non-null value that differs from the last seen id" with last seen `null`; a Rail pane opening a session is a session switch | yes |
| 5. Timer runs outside Angular, released in `ngOnDestroy` | `DestroyRef.onDestroy` (plan text) | the class removal is DOM-only; `ngOnDestroy` is this component's existing release point (`clearAnswerWait`) | yes |
| 6. `ptahStaggerLeft` + `.st-r` rule included | omit (batch line names only `ptahStaggerUp`) | B-4 already puts `st-r` + `--i` on inspector rows with no CSS (`session-inspector.component.html:31-76`, comment "the CSS caps the index at 6"); A2 component 4 assigns this rule to chat-view CSS | yes |
| 7. `resolvedViewMode` and the `isCompactViewMode` import deleted | keep | no production reader after narrowing `showCompactCard` (grep `libs/`, `apps/`); the transcript reads `viewMode` itself; rule "delete unused code" | yes |
| 8. Chip / ring / description gated on `!inspectorOpen()` inside the header; chat-view passes the raw values | gate in chat-view | plan D3-11 puts the "only while closed" rule on the header inputs; keeps chat-view's computeds pure reads of `stats.inputs()` | yes |
| 9. Header branch = composer rule (`sessionBranch(tab, gitStore.stateFor(sessionWorkingRoot(...)))`), read-only | start git tracking from chat-view | `chat-input.component.ts:696-728` same call; tracking is the inspector GIT section's job | yes |
| 10. Add-on `@for` tracks `$index` | `track addon.component` | two registrations of one component would duplicate the key | yes |

## Proposed Removals

None. The compact card's chat-host role (A-6) and its `expandToFull` (A-16) move as the parity inventory
records (`parity-inventory.md:36,46`); the forced Rail card (A-5) and its `expandToFullView` binding stay; the
view-mode toggles (A-1, A-3, A-4) are untouched.

## Clarifications Needed

None.

## Out-of-scope observations

- decisions row 71: the `--sel` layer in the `sel` dot colour is still dead (`--sel` is never defined); left as
  is (optional cleanup, one CSS line in `session-header.component.ts:104`).
- `.ptah/specs/TASK_2026_677_efcd/decisions.md` is modified on disk by another writer (orchestrator); not mine.
