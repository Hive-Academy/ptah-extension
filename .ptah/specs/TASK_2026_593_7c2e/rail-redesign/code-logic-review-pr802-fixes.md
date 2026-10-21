# Code logic review — PR #802 attention-rail fixes

**Verdict: REVISE**
**Score: 4/10**
**Review family: grok (implementer: codex)**

Uncommitted diff in `feat/attention-rail-redesign` (9 files under `libs/frontend/{core,notification-center,canvas,chat}`). Sources read in full for the shared permission control and the snackbar class; bell, rail activate/isBlocked, and the notification store activate path read through the decision handlers. No nx, Jest, tsc, lint, or build was run. Lane-reported Jest passes were not re-executed.

The happy path for one filled primary, whitespace denial, rail stale latch, bell request title, overflow count, and runtime secret fixtures holds. Four decision-path gaps keep this out of the 5–6 band: the snackbar can Allow a command it no longer shows, bell permission buttons ignore outcomes the store already recorded, a stale snackbar click dispatches again, and the new More menu is clipped or pushed into the composer gutter. It is not a 3: Allow, the denial form, and the rail block still reach the dispatcher.

## Decisions

- Menu placement is major, not a blocker. The rail list definitely clips (`overflow-y-auto`). The snackbar menu opens downward into the 5rem composer gutter; composer stacking was not measured, so coverage is not treated as proven.
- Bell and snackbar stale/unavailable gaps stay in scope. Check 1 names those hosts. The snackbar spec still requires the second click, which is evidence of the resend, not a reason to waive it.

## Defects

1. **Major** — Snackbar Allow no longer shows the command being approved. `attention-permission-actions.component.ts:10` renders `permissionPreview` only when `compact()` is false. The snackbar sets `[compact]="true"` at `notification-snackbar.component.ts:48`. Preview text is the tool command (`chat-attention-source.service.ts:33-36` and `:203`); `detail` is only `Tool: ${safeTool}` (`:202`). The card's second-row tooltip and the sr-only span both use `item.detail || item.context` (`notification-snackbar.component.ts:45` and `:63`), so the command is not in the accessible name either. Bell and rail leave `compact` at its default and still show the preview. A snackbar Allow/Deny is a permission decision on text the card no longer contains.

2. **Major** — Bell permission actions do not latch stale or unavailable, so the same decision is sent again. Needs-you and recent notices mount the shared control with `busy` only (`notification-center.component.ts:56` and `:84`). `reasonFor` reads `action.disabledReason` or the `unavailable` input (`attention-permission-actions.component.ts:88-90`); that input defaults to an empty map (`:64`). The store already stores per-action unavailable reasons (`notification-center.store.ts:105-107`) and exposes them from `disabledReason` (`:80-82`), and the bell still prints that text in `bell-reason-*` (`notification-center.component.ts:68` and `:86`). `activate` returns early only when `action.disabledReason` is set or a submit is in flight (`notification-center.store.ts:90-92`). After `stale` (`:104`) or `unavailable`, `busy` clears in `finally` (`:123-125`). More stays enabled (`attention-permission-actions.component.ts:23` disables it only for `busy()`), and Allow/Always allow/Deny emit again through `choose` (`:93-96`).

3. **Major** — Snackbar stale shows "Already answered" and still dispatches the next click. `dispatch` records stale as status text only (`notification-snackbar.component.ts:216`). It does not write `unavailable` and `finally` clears `pending` (`:227-228`). The only in-flight guard is `pending().has(item.key)` (`:203`). `notification-snackbar.component.spec.ts:80-88` clicks Open session, expects "Already answered", clicks the same button again, and only then expects the unavailable disable. That second click is a real `dispatchOutcome` call. The same path applies to Allow, Deny, and Always allow. Unavailable itself is per action (`:217-219`) and does disable that control through `reasonFor`; sibling actions stay enabled, which matches a per-action outcome.

4. **Major** — Always allow, Deny, and Deny with message can be clipped or drawn off the bottom of the viewport. Those ids are overflow-only: `visibleActions` keeps `allow`, the primary, and `open` (`attention-permission-actions.component.ts:73-74`); everything else is in the menu (`:75`). The menu is `absolute` / `top-full` (`:25`) inside the rail list `max-h-[260px] overflow-y-auto` (`canvas-rail.component.ts:191`) and inside the bell panel `overflow-y-auto` (`notification-center.component.ts:33`). Overflow clips hit targets, so a lower rail card's Deny row is not clickable. On the snackbar the host is `bottom: 5rem` (`notification-snackbar.component.ts:20`) and the menu grows downward from the second row, into the composer gutter or past the viewport. Narrow layout (`bottom: 15rem` at `:21`) has room; desktop does not. Escape and Tab still reach items that remain in the DOM.

5. **Minor** — Closing More drops keyboard focus. `closeMenu` only stops propagation and clears `menuOpen` (`attention-permission-actions.component.ts:99-103`). The trigger click (`:23`) does not move focus into the menu. Escape while a menuitem is focused removes that button. Focus falls to `document.body`. The spec asserts the menu node is gone (`attention-permission-actions.component.spec.ts:95-97`) and does not assert where focus lands. Tab can still open the menu and reach items before Escape.

6. **Minor** — Reason and denial-field ids are not unique in the document. Both copies use `permission-action-reason-${key}-${actionId}` and `permission-reason-${key}` (`attention-permission-actions.component.ts:18`, `:38`, `:44`). Canvas rail (`canvas-rail.component.ts:201`) and the snackbar (`notification-snackbar.component.ts:48`) mount the same `item.key` together whenever the bell panel is closed (`notification-snackbar.component.ts:28`). `aria-describedby` then resolves to whichever node is first. Text matches when both sides use `disabledReason`; it diverges when only the snackbar has an `unavailable` entry.

## Check 1 — Permission decisions still dispatch

Allow, Always allow, Deny, and Deny with message still have a code path on all three hosts.

- Allow (and Show in canvas / Open when Allow is disabled) stays inline and emits `{ actionId }` from `choose` (`attention-permission-actions.component.ts:93-96`). One `btn-primary` is the enabled Allow, else enabled `open`, else the first enabled action that is not `deny_with_message` (`:70-72`). Disabled Allow stays visible as a ghost button (`:73`).
- Always allow and Deny sit in More and emit the same shape once the menu is opened.
- Deny with message does not emit until the form submits. Whitespace-only input sets `reasonError` and does not emit (`:106-111`). A non-empty value is trimmed. The effect focuses the field when the form opens (`:78-80`).
- Hosts forward `actionId` and `reason`: bell `activate` (`notification-center.component.ts:180-181`), snackbar `dispatch` (`notification-snackbar.component.ts:202-215`), rail `activate` (`canvas-rail.component.ts:405-419`).
- In-flight double clicks are dropped: snackbar `pending` (`:203`), bell `submitting` keyed by generation (`notification-center.store.ts:92-93`), rail `submitting` or `isBlocked` (`canvas-rail.component.ts:407`). `choose` itself has no guard; a real browser does not click a disabled button.
- Rail stale/unavailable sets a generation-scoped status (`canvas-rail.component.ts:420-421`, `:436-437`) and passes `busy` as `submitting || isBlocked` (`:201`), which disables inline buttons and More. A generation change clears that status (`statusFor` at `:397-400`). The rail spec checks the three visible controls and a second Allow click (`canvas-rail.component.spec.ts:184-191`); it does not open More, but those items bind `busy()` when the menu is open (`attention-permission-actions.component.ts:28`).
- Failures are defects 2 and 3: bell never receives the store map, and snackbar stale does not latch. Snackbar unavailable disables only the action that failed.

## Check 2 — Disabled reason for assistive tech and tooltip

When `reasonFor` is set, the shared button gets `title` and `aria-describedby="permission-action-reason-${key}-${actionId}"` (`attention-permission-actions.component.ts:17-18` and `:28-29`). The matching sr-only span is rendered under the same condition (`:36-39`). Non-permission snackbar buttons still point at `snackbar-reason-${key}-${actionId}` (`notification-snackbar.component.ts:54-56`) and that span exists at `:64-65`. Within one component instance the id is unique per item key and action id.

Bell permission buttons do not get this wiring for store-only unavailable reasons (defect 2). The visible `bell-reason-*` paragraph is not the id those buttons reference. Duplicate ids across rail and snackbar are defect 6.

## Check 3 — Snackbar count, timers, and a path to hidden items

`limit` starts at 2 and `resize` sets 1 at `innerWidth <= 900`, otherwise 2 (`notification-snackbar.component.ts:95-102`). `visible` is `snackbars().slice(0, limit)` and `overflow` is `max(0, length - limit)` (`:96-97`). Four items at desktop width render two `.snackbar-card` nodes and `+2 more` (`notification-snackbar.component.spec.ts:119-128`). The button label and accessible name use that count (`notification-snackbar.component.ts:73-77`) and `openNotifications` is the bell path. The `+N` click still stops propagation (`:76`).

Hover, focus, and dismiss still call `pauseSnackbar` / `resumeSnackbar` / `dismissPresentation` (`:167-200`). The pause effect still resumes keys that leave the visible set (`:111-122`). Those functions were not edited. The spec still hovers, dismisses, and expects `resume` (`notification-snackbar.component.spec.ts:158-161`). Placement CSS is `bottom: 5rem; right: 18rem`, and at `max-width: 900px` `bottom: 15rem; right: 1rem` (`notification-snackbar.component.ts:20-21`). This pass did not screenshot pane clearance.

## Check 4 — Secret fixtures are still secret-shaped at runtime

`chat-attention-source.service.spec.ts:156` joins to `run password=hunter2 --token abc123`. `ASSIGNED_SECRET` / `FLAG_SECRET` (`chat-attention-source.service.ts:20-22`) rewrite that to `password=***` and `--token ***`. The expectation at spec `:159` is `Input: run password=*** --token ***`, which fits the 40-character command cap (`:36`). Spec `:160` joins to `echo sk-1234567890abcdef`. `TOKEN_SHAPE` (`:23`) requires `sk-` plus 8 word characters; that value has 16 and becomes `Input: echo ***` (spec `:163`).

`chat-attention-host-message-handler.service.spec.ts:164` joins to `sk-1234567890abcdef`. `isUnsafeAttentionContext` uses `\bsk-[\w-]{8,}\b` (`attention-context.util.ts:1-3`). The spec expects the title to be replaced with `Permission required`, `sessionTitle` unset, and context `Claude` (`:168-170`). The fixtures still exercise redaction. No contiguous secret literal remains in those two specs.

## Check 5 — Regressions

- No `any` and no new casts in the edited components.
- No `text-base-content/NN` utilities. `text-base-content` and `text-base-content-muted` are the tokens in the new templates.
- No `[innerHTML]`.
- Existing `catch` blocks still replace the failure with a fixed status string (`notification-snackbar.component.ts:225-226`, `notification-center.store.ts:118-121`, `canvas-rail.component.ts:429-430`). The snackbar rejection spec still asserts the private error text is absent (`notification-snackbar.component.spec.ts:91-102`). This change does not add a new swallow.
- More focus is defect 5. Escape on an open menu stops at the control (`attention-permission-actions.component.ts:99-102`), so the bell panel's Escape closer (`notification-center.component.ts:34`) does not also dismiss the panel. That part is right.
- Compact mode additionally drops `permissionPreview` (defect 1). The bell heading regression is fixed: the row title is `item.title` (`notification-center.component.ts:52`), and the spec selects that paragraph plus the session span (`notification-center.component.spec.ts:113-114`).

## Check 6 — Specs against behavior

Permission specs open More, submit a trimmed reason, reject whitespace, resolve the error id with `getElementById`, promote Show in canvas, and close on Escape (`attention-permission-actions.component.spec.ts:25-97`). Those assertions follow the click. They do not cover focus return or a second host with the same id.

Rail specs select Allow and Show in canvas by label and expect a single primary (`canvas-rail.component.spec.ts:119-125`). The stale example checks named disables and one dispatch (`:184-191`). It never opens More.

Snackbar overflow asserts two cards, `+2 more`, `flex-col-reverse`, and the newest card (`notification-snackbar.component.spec.ts:127-132`). Dropping `getComputedStyle` on host CSS matches jsdom not applying component styles; the count assertion is still behavioral. The stale example (`:72-88`) documents the resend in defect 3 instead of forbidding it. No snackbar spec expects `permissionPreview` on the card, so defect 1 is untested.

## Five logic questions

1. **Silent success.** Snackbar Allow looks successful while the command preview is absent (defect 1). After stale, a second click looks like a new decision and the dispatcher is called again (defects 2 and 3). Rail does not: `isBlocked` returns before `dispatchOutcome`.
2. **User action.** Open More on a lower rail card or on a desktop snackbar and press Deny or Always allow (defect 4). On the bell, click Allow again after "Already answered" or an unavailable reason (defect 2). Press Escape from a More menuitem (defect 5).
3. **Wrong answer without an error.** Whitespace-only denial does not submit; that path is correct (`attention-permission-actions.component.ts:109-111`). The wrong-answer case is a repeated allow/deny after stale, because the outcome is status text rather than a disabled control. Duplicate ids can associate a button with the other host's reason string (defect 6).
4. **Dependency failure.** `dispatchOutcome` unavailable on the snackbar disables that action and stores the reason (`notification-snackbar.component.ts:217-219`). The same outcome on the bell stores the reason and leaves the button enabled (defect 2). A thrown dispatch becomes the fixed string "Action unavailable" and does not render the error. A generation change drops stale rail state and filters snackbar unavailable keys (`notification-snackbar.component.ts:113-115`).
5. **Missing from the requirements.** The compact card does not say where `permissionPreview` goes. The More menu does not say it must flip upward or escape overflow. The shared reason id has no host prefix, so two mounted copies collide. The snackbar stale spec still requires a second dispatch, which conflicts with "no double send".

## Remaining uncertainty

Composer z-index over the snackbar menu was not measured. Electron placement at 1440×900 and 800×900 was not captured. Diagnostics and the lane's Jest runs were not repeated.
