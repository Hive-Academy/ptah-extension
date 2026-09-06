# Batch 4 report — renderer boot status, boot screen, activity service and ticker

Executor: `frontend-developer`. Tasks 4.1 → 4.2 → 4.3 → 4.4, sequential, one pass.
Worktree: `D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380`.
Nothing committed; nothing outside the Batch 4 file list touched.

## Files

### Task 4.1 — `BootStatusService` (component 12)

- **CREATED** `libs/frontend/core/src/lib/services/boot-status.service.ts` —
  `providedIn: 'root'`, `implements MessageHandler`
  (`handledMessageTypes` + `handleMessage`). `status` is initialised to
  `{ readiness: 'ready', phase: 'settled', startedAt: Date.now() }`; every degrade
  path (rejected pull, unsuccessful pull, malformed push, silent host) leaves that
  default, so the VS Code webview is never gated. Derived signals: `readiness`,
  `phase`, `detail`, `isBooting`, `hasFailed`, `elapsedMs`, plus
  **`isBlockingBoot`** (see deviation D-1). The constructor pull of
  `boot:getReadiness` is guarded by the `VSCodeService.isElectron` **snapshot**
  (`app.ts:47` idiom) and is skipped entirely outside Electron. A `pushSeen` latch
  stops a late-resolving pull from overwriting a push that already landed.
- **CREATED** `libs/frontend/core/src/lib/services/boot-status.service.spec.ts` —
  19 tests: ready default before any RPC, no pull outside Electron, pull adopted,
  pull rejected / unsuccessful leaves the default, late pull loses to a push,
  `warming` → `isBooting`, the harness handover boundary, `failed` without
  blocking, six malformed-payload drops, unrelated message ignored, wire string,
  elapsed derivation and its clock-skew floor.

### Task 4.2 — `BackOfficeActivityService` (component 14d)

- **CREATED** `libs/frontend/core/src/lib/services/back-office-activity.service.ts` —
  `@ptah-extension/shared` only (no RPC, no `VSCodeService`, no backend import).
  Handles all **ten** message types listed in `batches.md`. Each type has a pure
  `(payload) => ActivityItem | null` mapper. `ACTIVITY_RING_CAPACITY = 50`,
  `ACTIVITY_COALESCE_WINDOW_MS = 750`, `ACTIVITY_IDLE_AFTER_MS = 8000`. Coalescing
  keys on `` `${source}:${kind}` `` against the **head** item and replaces it in
  place, keeping its position and its `id`. `null` for `phase === 'settled'` and
  for an unchanged vec/embedder snapshot; an unknown `SKILL_SYNTHESIS_EVENT` kind
  degrades to `Skill synthesis: <kind>` rather than disappearing. Skill phrasing is
  the vocabulary already in `skill-synthesis-live.service.ts:107-119`
  ("Curator analyzing candidates…", "Embedding candidates N/M…"). One
  `setInterval` behind `isIdle`, cleared through `DestroyRef.onDestroy`.
  `ActivityItem` is exported from here (see D-3).
- **CREATED** `libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts` —
  24 tests, all state/call-count based with fake timers: 60 pushes → 50 newest
  first; 100 `INDEXING_PROGRESS` 10 ms apart → **one** slot with the last summary
  and a stable slot id; two 2 s apart → two slots; no cross-source coalescing;
  `isIdle` false after a push and true past `ACTIVITY_IDLE_AFTER_MS`; settled boot
  produces nothing; malformed payloads for all eight shapes change nothing; empty
  summary admitted; status re-broadcast suppressed; timer cleared on destroy.
- **MODIFIED** `libs/frontend/core/src/lib/services/index.ts` — exports
  `BootStatusService`, `BackOfficeActivityService`, the three constants and
  `type ActivityItem`.
- **MODIFIED** `apps/ptah-extension-webview/src/app/app.config.ts` — both services
  registered on `MESSAGE_HANDLERS` (`useExisting`, `multi: true`), with a note on
  why registering `BootStatusService` for both hosts is safe.
- **MODIFIED** `apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts` —
  `BackOfficeActivityService` added to the mirrored provider list, plus a case that
  dispatches a genuine `window` `MessageEvent` carrying the literal
  `activity:event` string and asserts the item lands through the real router.

### Task 4.3 — Boot screen + skeletons (component 13)

- **CREATED** `libs/frontend/chat-ui/src/lib/atoms/skeleton-block.component.ts` —
  the extracted daisyui loading row (`rows`, `showAvatar`, `showAction`,
  `titleWidthClass`, `subtitleWidthClass`), `aria-hidden`, OnPush, no injection.
- **MODIFIED** `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-status-widget.component.ts`
  and `.../setup-status-widget.component.ts` — the two duplicated skeleton blocks
  replaced by the atom (the swap was trivial; the only difference was the two line
  widths, which are now inputs). Both widget specs still pass.
- **CREATED** `libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts` —
  inputs only (`phase`, `readiness`, `startedAt`, `detail`). `role="status"`
  `aria-live="polite"`; the phase list is a real `<ol>` of `<li>`; reached phases
  are checked, the current one spins, later ones are dotted; an unknown phase
  renders the headline "Starting" with everything pending; elapsed seconds derive
  from `startedAt` on one interval cleared via `DestroyRef`; a `prefers-reduced-motion`
  block kills the spin. Tailwind + daisyui only.
- **CREATED** `.../boot-progress/boot-progress.component.spec.ts` — 11 tests
  covering the list, the reached/active/pending marking, the unknown-phase
  degrade, detail present/absent, elapsed (including its clock-skew floor), the
  live region, the degraded tint and timer cleanup.
- **MODIFIED** `libs/frontend/chat-ui/src/index.ts` — exports
  `SkeletonBlockComponent`, `BootProgressComponent`, `ActivityTickerComponent`.
- **MODIFIED** `apps/ptah-extension-webview/src/app/app.html` — the loading branch
  is now `@if (appState.isLoading() || isInitializing() || bootStatus.isBlockingBoot())`
  and renders `<ptah-boot-progress>` when the boot is what is blocking, otherwise
  the original spinner. The shell branch gained `&& !bootStatus.isBlockingBoot()`
  (see D-2). The error branch renders `{{ errorMessage() }}`.
- **MODIFIED** `apps/ptah-extension-webview/src/app/app.ts` — injects
  `BootStatusService`, imports `BootProgressComponent`, folds
  `bootStatus.hasFailed()` into `hasError()` and adds `errorMessage()`, which
  prefers the host's boot `detail`.
- **MODIFIED** `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` —
  two skeleton sites only: the session list's `@empty` branch renders five
  skeleton rows while `bootStatus.isBooting()` instead of "No sessions yet", and
  the canvas region's `@else` spinner (`~:673-678`) is now a four-row skeleton.
- **MODIFIED** `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` —
  injects `BootStatusService` and imports `SkeletonBlockComponent` (see D-4).

### Task 4.4 — `ptah-activity-ticker` (component 14e)

- **CREATED** `libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.ts` —
  `items = input.required<readonly ActivityItem[]>()`, `idle = input.required<boolean>()`,
  `rotateMs = input<number>(4000)`, `activate = output<void>()`. Rotation is one
  interval that advances the index; an effect resets the index to 0 when the head
  **id** changes (a coalesced in-place update does not reset it). Idle collapses to
  a muted dot that stays in the DOM and remains the click target. `<button type="button"
aria-label="Open Thoth background activity">` inside
  `role="status" aria-live="polite" aria-atomic="true"`; `max-w-[22rem] truncate no-drag`;
  CSS-only `translateY` + `opacity` over 180 ms with a `prefers-reduced-motion` block.
  An empty `summary` falls back to the source label. No service injection, no new
  dependency.
- **CREATED** `.../activity-ticker/activity-ticker.component.spec.ts` — 10 tests:
  ordered rotation across two advances of a fake clock, reset on a new head, **no**
  reset on an in-place head update, empty-summary fallback, idle collapse that still
  emits `activate`, click emission, the a11y attributes and the width/no-drag
  classes, the warn tint, no rotation for a single item, timer cleanup.
- **MODIFIED** `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` —
  injects `BackOfficeActivityService`, places `<ptah-activity-ticker>` **inside**
  the existing right-hand group immediately **before** `<ptah-theme-toggle />`, and
  wires `(activate)="openThoth()"` (the existing method, including its
  `thothFirstRunDismissed` side effect). The header row's `h-10` is untouched — the
  ticker is `h-full items-center` inside it.

## Deviations, with reasons

- **D-1 — the boot screen is gated on `isBlockingBoot()`, not `isBooting()`.**
  `batches.md` writes the condition literally as `bootStatus.isBooting()` but in
  the same task states the handover point is `phase === 'harness'`. Those two
  cannot both hold: `isBooting()` stays true through `sessions` and `index`, which
  would keep the screen up over exactly the window the skeletons are for. The
  computed lives in the service (`isBlockingBoot = warming && phase ∈ {starting,
database}`) so the rule has one home and one spec.
- **D-2 — the shell branch also gained `&& !bootStatus.isBlockingBoot()`.**
  Without it, once `isReady()` flips, a still-blocking boot would render the boot
  screen and the shell simultaneously inside the same `<main>`. The two branches
  were previously mutually exclusive through `isInitializing()`/`isReady()` alone.
- **D-3 — `ActivityItem` lives in `libs/frontend/core`**, exported from the
  services barrel, and the ticker imports it with `import type`. `chat-ui` is
  `scope:webview` and already imports `@ptah-extension/core` in eleven files, so
  the boundary rule (`scope:webview` → `scope:shared | scope:webview`,
  `eslint.config.mjs:126-129`) permits it and `core` does not import `chat-ui`, so
  no cycle is created. `chat-types` was the alternative; keeping the type beside
  the service that produces it was the better of the two.
- **D-4 — `app-shell.component.ts` was modified**, though 4.3's file list names
  only the `.html`. A template cannot bind `bootStatus` or use
  `<ptah-skeleton-block>` without the injection and the `imports` entry. Same for
  `electron-shell.component.ts`, which the plan does list.
- **D-5 — `text-base-content/NN` is banned.** The first draft of the boot screen
  used the alpha ladder and failed the ratchet at
  `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts`. Every text
  tier now uses `text-base-content-muted`. This is why the boot screen has no
  40/50/60/70 tiers; the `bg-base-content/30` dot is allowed by that rule (it is
  not text).
- **D-6 — the two `webview-e2e-harness` cases were NOT written.** They are
  possible in principle — the thoth scenario shows the postmessage bridge plus an
  `isElectron: true` `ptahConfig` can drive the real bundle — but both cases need
  `test.use({ useAppBuild: true })` against `dist/apps/ptah-extension-webview`, and
  verifying them means running `nx build ptah-extension-webview` plus Playwright.
  The Batch 4 prompt forbids Nx builds while the Batch 3 agent holds the daemon.
  Landing two unrun Playwright specs is worse than landing none, so they are
  deferred. Sketch for whoever picks them up: post
  `{ type: 'boot:readinessChanged', payload: { readiness: 'warming', phase: 'database',
startedAt: Date.now() } }` and assert `[data-testid="boot-headline"]`, then post
  the same with `phase: 'harness'` and assert the shell; for the ticker, post an
  `activity:event` and assert `[data-testid="activity-ticker-line"]`. Both
  `data-testid`s exist in the shipped components for exactly this.

## Verification

Single-lib Jest only, as instructed. No `nx run-many`, no `nx build`, no
`typecheck:all`, no `lint:all`.

| Command                                                                                                 | Result                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx jest --config libs/frontend/core/jest.config.ts --rootDir libs/frontend/core`                      | 28 suites, **639 tests passed**                                                                                                                                                                                                                              |
| `npx jest --config libs/frontend/chat-ui/jest.config.ts --rootDir libs/frontend/chat-ui`                | 22 suites, **119 tests passed**                                                                                                                                                                                                                              |
| `npx jest --config libs/frontend/chat/jest.config.ts --rootDir libs/frontend/chat`                      | 62 suites, **944 passed, 2 skipped**                                                                                                                                                                                                                         |
| `npx jest --config apps/ptah-extension-webview/jest.config.ts --rootDir apps/ptah-extension-webview`    | 7 suites, **142 tests passed** (includes the alpha-class ratchet and the routing spec)                                                                                                                                                                       |
| `... --coverage --collectCoverageFrom "src/lib/services/{boot-status,back-office-activity}.service.ts"` | statements 97.44 %, branches 88.67 %, functions 100 %, lines 97.59 % — above the lib floor (85/75/75/85)                                                                                                                                                     |
| `npx eslint` on all 18 touched files                                                                    | 0 errors. Three pre-existing warnings in `app-shell.component.ts` (unused `SessionId`, an empty arrow at `:368`), untouched by this batch; `.html` files report "no matching configuration", which is how this repo lints templates (through the component). |
| `npx prettier --write` on all touched files                                                             | applied                                                                                                                                                                                                                                                      |

Not run and why: `nx build`, `nx run-many` and the repo-wide typecheck/lint are the
orchestrator's post-batch step — the Batch 3 agent holds the Nx daemon. `chat-ui`'s
dependency list is unchanged (the ticker animation is CSS; no package added).

## Open questions for the team leader

1. **D-1 needs a ruling.** If the intent really was to hold the screen until
   `settled`, the change is one identifier in `app.html` — but then the two
   skeleton sites never render, and the plan's "skeletons own the window in which
   parts are usable" argument is void. I implemented the harness handover.
2. **The `@else` skeleton in the canvas region is not boot-gated.** It replaces the
   `orchestraCanvasComponent`-missing spinner, which is the plan's literal
   instruction (`app-shell.component.html:673-678`), so it also shows if the
   token is ever unbound outside a boot. That matches the plan; flag it if the
   intent was `@if (bootStatus.isBooting())` there instead.
3. **The two deferred e2e cases (D-6)** need a session where a webview build is
   allowed. Worth its own small task rather than a Batch 4 re-run.

## Lint fix (post-review)

`@ptah-extension/chat-ui:lint` reported 10
`@angular-eslint/template/no-duplicate-attributes` errors — a static `class="…"`
beside a `[class]="…"` binding on the same element, at five elements across
`skeleton-block.component.ts` (2), `boot-progress.component.ts` (2) and
`activity-ticker.component.ts` (1). Each is now a single `[class]` binding
concatenating the static classes with the dynamic part, the idiom already used at
`typing-cursor.component.ts:16` and `tool-icon.component.ts:35`. No other file
touched, no behaviour change, no spec changed.

- `npx nx run @ptah-extension/chat-ui:lint --skip-nx-cache` → **0 errors**
  (5 pre-existing warnings, in `compact-session-activity`,
  `compact-session-header`, `session-stats-summary` and `plugin-browser-modal` —
  none in a Batch 4 file).
- `npx jest --config libs/frontend/chat-ui/jest.config.ts --rootDir libs/frontend/chat-ui`
  → 22 suites, **119 tests passed**.

## Logic-review fixes (code-logic-review.md, APPROVED WITH NOTES 7/10)

All five requested items taken. `chat-ui` was not touched in this round.

### 1. F-1 — lost-push watchdog (serious) — FIXED

`libs/frontend/core/src/lib/services/boot-status.service.ts`. While
`readiness === 'warming'`, the service re-pulls `boot:getReadiness` every
`DEFAULT_READINESS_RETRY_AFTER_MS` (2000 ms, imported from
`@ptah-extension/shared` rather than re-declared). The loop is Electron-only
(`startWatchdog` returns early otherwise), starts and stops inside the single
`adopt()` path so it can never outlive `warming`, and is cleared through
`DestroyRef.onDestroy`.

The `pushSeen` boolean is replaced by a `hasSnapshot` latch plus a real
monotonic rule, because a periodic pull needs an ordering, not a one-shot veto:

- The **first** accepted snapshot is unconditional — the `ready` default is a
  placeholder, not a claim, so without this the initial pull's `warming` answer
  would be rejected as a regression.
- After that, a **pull** is adopted only if `isAtLeastAsAdvanced`: readiness
  rank first (`warming` = 0, every terminal state = 1), then
  `BOOT_PHASE_VALUES.indexOf(phase)`.
- A **push** is always adopted, including backwards. It is the host reporting a
  change, and `warming@index → failed@database` is a real and important
  transition that a monotonic rule would have swallowed.

Seven new specs (26 total in the file): warming with no further push re-pulls
and adopts `ready`; the interval stops once readiness is terminal and does not
fire again over 20 s; no watchdog at all outside Electron; a pull answering an
older phase than the last push is ignored while a further-along one is adopted;
a push may move the state backwards; the interval is cleared on destroy.

### 2. F-2 — loading/error overlap (serious) — FIXED

`apps/ptah-extension-webview/src/app/app.html` is now one exclusive chain in the
order the review asked for: `@if (hasError())` → `@else if (isLoading ||
isInitializing || isBlockingBoot)` → `@else if (isReady())`. The shell branch's
`&& !appState.isLoading() && !bootStatus.isBlockingBoot()` guards are gone —
`@else if` makes them dead conditions that would read as if the overlap were
still possible.

Guarded by a source sweep in `app.spec.ts` (`app.html top-level branch
exclusivity (F-2)`, 5 cases), for the same reason
`no-alpha-base-content.spec.ts` is a source sweep: the defect is the template's
structure, and jsdom renders a stacked spinner-plus-error as happily as a
correct chain. It asserts the error branch opens the chain, that loading and
shell follow as `@else if`, that exactly one top-level `@if` exists, and that
the retired guards have not crept back.

### 3. F-3 / F-4 — mapper narrowing (moderate) — FIXED

`libs/frontend/core/src/lib/services/back-office-activity.service.ts`:

- `finiteTimestamp()` replaces `?? Date.now()` inside `makeItem`, whose
  `timestamp` field is now `unknown`. A wire timestamp is kept only when
  `typeof === 'number' && Number.isFinite`; anything else becomes `Date.now()`.
  This covers `timestamp` and `completedAt` on every mapper at one chokepoint
  rather than nine.
- `mapBootReadiness` uses `detail` only when `typeof === 'string'`, otherwise
  the phase label — "[object Object]" is not a sentence.
- `mapMemoryExtracted`, `mapMemoryCorpus`, `mapIndexingProgress` and
  `mapIndexingComplete` now require their control-flow numbers to be finite (a
  `NaN` `created`/`percent`/`elapsedMs` drops the message) and treat a
  non-finite `merged`/`count` as `0`.
- `mapIndexingProgress` ignores a non-string `currentLabel` instead of
  interpolating it.
- `skillSummary` guards each stat with `finiteStat()` and returns the **generic**
  `Skill synthesis: <kind>` line when one does not coerce, so
  "Embedding candidates NaN/NaN…" is unreachable; a non-string `error` reads
  `unknown`.
- Two extras in the same spirit: a non-string vec `reason` reads `unknown`, and a
  non-string embedder `error.message` no longer counts as an error.

Ten new specs (34 total in the file), one per rule above.

### 4. Canvas skeleton gating (moderate) — FIXED

`libs/frontend/chat/src/lib/components/templates/app-shell.component.html`: the
canvas `@else` is now `@else if (bootStatus.isBooting())` for the skeleton, with
the **original** spinner markup restored in a final `@else`. A DI regression that
leaves `ORCHESTRA_CANVAS_COMPONENT` permanently unbound therefore looks like the
old broken-wiring fallback again, not like a boot that never finishes. This also
closes Open Question 2 from the first report.

### 5. Remaining notes — what I took and what I left

- **Taken**: everything above, including the moderate canvas note (item 4) and
  the two extra string-guards in the vec/embedder mappers that the review did
  not itemise but that are the same class of defect as F-3.
- **Left — `elapsedMs` is a non-ticking, production-unused computed (minor).**
  `batches.md` Task 4.1 names `elapsedMs` as a required derived signal, so
  deleting it would break the batch contract, and making it tick would add a
  second always-on interval in a root service for a number only the boot screen
  renders — and that component already owns its own clock, deliberately, because
  it is presentational and must not depend on a service. The doc-comment already
  states it is measured at the last transition. Flagging for the team leader
  rather than acting unilaterally.
- **Left — the unguarded `MessageRouterService` dispatch loop.** Pre-existing
  (`message-router.service.ts:67-73`), outside Batch 4's file ownership, and the
  reviewer explicitly recorded it as a defensive read rather than a finding
  against this batch. Neither new handler throws on any payload, malformed or
  otherwise, which the specs pin.
- **Left — the two `webview-e2e-harness` cases (D-6).** Unchanged reason: they
  need `nx build ptah-extension-webview` plus a Playwright run to be worth
  landing.

### Verification after the fixes

| Command                                                                                              | Result                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npx jest --config libs/frontend/core/jest.config.ts --rootDir libs/frontend/core`                   | 28 suites, **656 tests passed** (was 639; +17)                                                           |
| `npx jest --config libs/frontend/chat/jest.config.ts --rootDir libs/frontend/chat`                   | 62 suites, **944 passed, 2 skipped**                                                                     |
| `npx jest --config apps/ptah-extension-webview/jest.config.ts --rootDir apps/ptah-extension-webview` | 7 suites, **147 tests passed** (was 142; +5)                                                             |
| `... core --coverage` (whole lib)                                                                    | statements 93.14 %, branches 84.32 %, functions 91.56 %, lines 94.06 % — all above the 85/75/75/85 floor |
| `npx nx run @ptah-extension/core:lint --skip-nx-cache`                                               | **0 errors**, 11 pre-existing warnings, none in a Batch 4 file                                           |
| `npx nx run @ptah-extension/chat:lint --skip-nx-cache`                                               | **0 errors, 0 warnings**                                                                                 |
| `npx nx run ptah-extension-webview:lint --skip-nx-cache`                                             | **All files pass linting**                                                                               |

No commit. Files touched in this round: `boot-status.service.ts` + spec,
`back-office-activity.service.ts` + spec, `app.html`, `app.spec.ts`,
`app-shell.component.html`.
