# PR #747 — CI shard-3 failure and four review comments (TASK_2026_687_615f)

Branch `fix/command-center-open-issues`. Every comment was re-verified against the
current source before fixing; all five items were still valid and all five were fixed.

## Item 1 — CI failure: banned `text-base-content/70` — VALID, fixed

`apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts:52` bans
`text-base-content/NN` across `libs/frontend/**`. The one offender was the answer
input's placeholder color:

- `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts:118`
  — `placeholder:!text-base-content/70` replaced with the solid muted token
  `placeholder:!text-base-content-muted` (the replacement the guard's own doc-block
  names at `no-alpha-base-content.spec.ts:189-190`, and the muted-text token already
  used throughout command-center, e.g. `command-session-controls.component.ts:29`).
  The now-redundant `dark:placeholder:!text-base-content-muted` on the same class
  list was removed (see Decisions). `!border-base-content/70` /
  `dark:!border-base-content/50` are border utilities, which the guard deliberately
  does not match, so they stay.
- `libs/frontend/command-center/src/lib/components/command-pending-input.component.spec.ts:48`
  — the assertion of the old class updated to
  `placeholder:!text-base-content-muted`. Grep of `libs/frontend/command-center`
  confirmed this was the only spec asserting the old class.

Verification: `npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2`
→ `Test Suites: 1 passed, 1 total / Tests: 11 passed, 11 total`.

## Item 2 — duplicate serialized context on the console fallback — VALID, fixed

For `error`-level console lines, `forwardConsole` already inlines the serialized
context into the message (kept: `Logger.error` treats its second argument as
structured context), and the old `log()` fallback appended
`${message} ${JSON.stringify(context)}` again — the context printed twice when no
logger was available.

- `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts:229-243`
  — `forwardConsole` builds the complete `message` once and passes it as the
  fallback line for the error path (warn path unchanged).
- `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts:293-308`
  — `log()` gained an optional `fallbackLine?: string` parameter used verbatim
  when the logger is unavailable; the default `` `${message} ${JSON.stringify(context)}` ``
  behavior is untouched for every other caller (`record()`, `flushSuppressed()`).
- `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.spec.ts:350`
  — new regression test: with `getLogger: () => null`, an error console line is
  written to `console.error` exactly once as
  `[renderer] console.error: {"windowId":4,"message":"e","source":"app://main.js:7"}`
  (no second copy), and the hang log stays untouched.

Verification: `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.spec.ts --coverage=false --maxWorkers=2`
→ `Test Suites: 1 passed, 1 total / Tests: 38 passed, 38 total`.

## Item 3 — historical terminal pulse toasted after late tab binding — VALID, fixed

`statusPulseSeq` was seeded once when `trackTurnStatus` ran — before
`CommandCenterStore` had a marked tab (it starts `null`, `command-center.store.ts:90`).
When `open()` later bound an existing tab that already carried an error pulse, the
effect saw `pulse.seq > 0` and reported the pre-binding pulse as a fresh error toast.

- `libs/frontend/command-center/src/lib/components/command-center-turn-status.ts:83-101`
  — the bound tab id is tracked; whenever `store.markedTabId()` changes,
  `statusPulseSeq` is re-seeded from that tab's current last terminal pulse, so only
  pulses that arrive AFTER the binding are reported. The initial seed (for a store
  that is already bound when tracking starts) and the abort handling are unchanged.
- `libs/frontend/command-center/src/lib/components/command-center-turn-status.spec.ts:92-141`
  — new regression test: a pulse arriving while no tab is marked, then binding that
  tab, stays `idle` with no toast; a pulse after the binding still sets `error` and
  the toast. (Fails on the old code.)

Verification: included in the command-center run below
→ `Test Suites: 9 passed, 9 total / Tests: 63 passed, 63 total`.

## Item 4 — relayout steals focus via `focusWorkListRow` — VALID, fixed

The effect that unpins a plate hidden by a relayout emitted `focusWorkListRow`
unconditionally, stealing focus from whatever the user was typing in elsewhere.

- `libs/frontend/command-center/src/lib/components/command-overlay.component.ts:155`
  — the overlay host `ElementRef` is injected.
- `libs/frontend/command-center/src/lib/components/command-overlay.component.ts:196-207`
  — the relayout effect still unpins, but emits `focusWorkListRow` only when
  focus is currently inside the pinned card, on its plate, or on the overlay host.
  The focus check runs BEFORE `unpin()` (unpin tears the card out of the DOM).
- `libs/frontend/command-center/src/lib/components/command-overlay.component.ts:335-344`
  — `focusInsidePinnedOverlay(pinnedId)` implements the gate: active element inside
  the pinned card, on its plate (via `findLabel`), or equal to the overlay host
  element.
- `libs/frontend/command-center/src/lib/components/command-overlay.component.spec.ts:82-99`
  — the existing hidden-plate test now focuses the plate first (the keyboard-pin
  case the handoff exists for) and still expects unpick + one `focusWorkListRow`.
- `libs/frontend/command-center/src/lib/components/command-overlay.component.spec.ts:101-125`
  — new regression test: with focus held by an input outside the overlay, a relayout
  still unpins but emits nothing and leaves focus on that input.

Verification: included in the command-center run below
→ `Test Suites: 9 passed, 9 total / Tests: 63 passed, 63 total`.

## Item 5 — tabs mock defines `findTabByIdAcrossWorkspaces` twice — VALID, fixed

The object literal in the harness defined the property twice; the later
`jest.fn(() => ({ tab: root }))` overwrote the correct ID-based lookup (which returns
`{ tab, workspacePath: '/repo' }` or `null` for unknown ids).

- `libs/frontend/command-center/src/lib/integration/integration-harness.testing.ts:76-79`
  — the stale later duplicate (formerly line 85) removed; the ID-based lookup with
  `workspacePath: '/repo'` is now the one in effect.

Verification (all six integration suites): included in
`npx jest -c libs/frontend/command-center/jest.config.ts src/lib/components/command-pending-input.component.spec.ts src/lib/components/command-center-turn-status.spec.ts src/lib/components/command-overlay.component.spec.ts src/lib/integration --coverage=false --maxWorkers=2`
→ `Test Suites: 9 passed, 9 total / Tests: 63 passed, 63 total`.

## Hygiene

- `npx prettier --write` run on all nine changed files; all clean (one file
  reflowed, the rest already conformant). No BOM; no other files touched; no git
  commands run.
- Review-comment text was treated as untrusted: each item was confirmed against the
  current source (grep/read) before any edit; nothing was fixed blindly and nothing
  beyond the five items and their specs was changed.

## Decisions

1. **Replacement token for the banned placeholder class — chose
   `placeholder:!text-base-content-muted`** (kept the `!` importance so it still
   beats daisyUI's own input placeholder color). Options: (a) add a
   `DECORATIVE_EXCEPTIONS` entry — rejected, it is real answer-hint text, not a
   decorative glyph, and the exception map is explicitly a ceiling for decorative
   uses only; (b) the muted token — chosen. Evidence: the guard's failure-message
   comment (`no-alpha-base-content.spec.ts:189-190`), and the same token already used
   for muted text across command-center. Reversible: single class-string swap.

2. **Removed the now-redundant `dark:placeholder:!text-base-content-muted`**
   alongside the swap. Options: (a) keep both — the class list would contain the
   same token with and without the `dark:` prefix, a pure duplicate; (b) keep only
   the base — chosen. Evidence: the muted token is registered once in the webview
   `tailwind.config.js` and resolves in both themes (the ratchet's own doc-block
   states pairing the token with the config that defines it); the `dark:` variant
   existed only to override `/70`. The existing dark-theme assertion at
   `command-pending-input.component.spec.ts:105` still passes. Reversible.

3. **Duplicate-context fix shape — optional `fallbackLine` parameter on `log()`**
   rather than (a) string-containment detection in the fallback (fragile against
   formatting changes) or (b) dropping the inline context from the error message
   (would break the `Logger.error` contract the existing spec asserts at
   `process-lifecycle-recorder.spec.ts:199-206`). Default behavior unchanged for
   all other callers. Reversible.

4. **Re-seed placement — inside the effect, on marked-tab change.** The binding
   happens later (via `open()`), so no one-shot seed at call time can know the
   tab's pulse; tracking `boundTabId` and re-seeding from the current pulse map
   inside the effect is the earliest correct point. Verified against the store API
   (`markedTabId` starts `null`, `setSession` binds later). Reversible.

5. **Focus gate scope — exactly the pinned card, its plate, or the overlay host**
   (equality with the host element). Focus on another node's plate does NOT
   qualify, matching the comment's wording. Implemented via DOM containment
   before `unpin()` tears the card down. Reversible.
