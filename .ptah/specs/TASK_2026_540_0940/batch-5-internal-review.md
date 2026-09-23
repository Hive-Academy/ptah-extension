# Code Logic Review — `TASK_2026_540_0940` Batch 5

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score        | 7/10                                  |
| Assessment           | ACCEPT WITH FIXES                     |
| Blocking issues      | 0                                     |
| Serious issues       | 1                                     |
| Moderate issues      | 1                                     |
| Failure modes found  | 2                                     |

## Scope examined

`git diff -- apps/ptah-electron-e2e` (5 modified files: `prewarm.ts`, `ui-driver.ts`,
`thoth-tour.scene.ts`, `skills-tour.scene.ts`, `memory-recall.scene.ts`) plus the new
`apps/ptah-electron-e2e/src/showcase/_harness/config-menu.ts`, read in full, not only the
diff hunks. Cross-checked against the real (uncommitted, Batch 4) selectors in
`libs/frontend/chat/src/lib/components/molecules/global-config-menu.component.ts` and
`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`, and against
`libs/shared/src/lib/types/webview-surface.types.ts` for the full `ViewType` union.
`batches.md` Batch 5 (lines 395-446), `plan-review.md` instruction 7 (lines 206-209), and
`prewarm.ts:15-25` (the SILENT / GUARDED / NON-DESTRUCTIVE rules) were the contract.
`mcp__ptah__ptah_get_diagnostics` on the six changed files: 0 errors, 0 warnings. Ran a
repo-wide grep for the remaining top-nav tab selectors named in the check list; all hits
map to Batch 6/7 files, confirmed against `batches.md`'s per-file task list (see Data flow).

## Five logic questions

### 1. How does this fail silently?

- `activeConfigSurface()` (`config-menu.ts:65-90`) returns `null` on ANY exception
  (unreachable trigger, a slow Floating UI mount, a stale locator) — not just when no
  surface is genuinely active. Its only caller, `prewarmThoth` (`prewarm.ts:88-116`),
  cannot tell "definitely on a top-level view" apart from "detection failed"; both look
  like "nothing to restore." No error surfaces anywhere — the scene silently keeps
  playing from the wrong surface. See Failure mode 1.
- `prewarmThoth`'s restore block (`prewarm.ts:111-115`) has no `else` branch: when
  neither `original` (a nav-tab title) nor `originalConfig` (a menu item) was captured,
  the function returns having navigated to Thoth, with no attempt to get back to
  wherever it started. This is a real gap, not just the detection-failure case above —
  see Failure mode 1 for the reachable views that trigger it even when detection works
  perfectly.

### 2. What user action produces unexpected behaviour?

Not user-facing (this is the showcase test harness), but the operator-facing analogue:
running `thoth-tour.scene.ts` against a profile that is not currently showing a top-nav
tab (chat/tasks/tribunal/analytics) or a configuration surface (thoth/setup-hub/
marketplace/settings) — for example the bare pre-workspace welcome screen, or a
mid-navigation state such as `setup-wizard`/`harness-builder` reached from Setup hub —
leaves the recording starting from Thoth instead of the surface the operator actually
had open. Today's sole caller of `prewarmThoth` happens to want Thoth next anyway
(`goToThoth` follows immediately), so the visible symptom in this specific file is an
extra, redundant "open trigger → click Thoth" camera beat rather than a wrong surface on
screen — see Failure mode 1 for why a future caller would not be so lucky.

### 3. What input data produces a wrong answer?

Any `ConfigSurfaceId` value is handled uniformly; there is no id-shaped input that
produces a wrong answer. The wrong answer instead comes from *state*, not id input: see
Q1/Q2. `activeConfigSurface`'s `switch` on the `data-test` attribute (`config-menu.ts:73-
84`) has an exhaustive `default: return null`, so a renamed/unexpected hook degrades to
"unknown," not a crash or a mismatched id — that part is correct.

### 4. What happens when a dependency fails?

- If the `ptah-native-dropdown` backdrop or Floating UI positioning never resolves
  `opened` (a known, accepted gap from the Batch 3 review, `batch-3-internal-review.md`
  MINOR 2), `openMenuSilently` (`config-menu.ts:23-35`) still succeeds through its own
  `waitFor` on the item, independent of the `(opened)` output, so this batch does not
  inherit that gap.
- If `closeMenuSilently` (`config-menu.ts:38-43`) fails to actually close the menu (its
  `Escape` press is itself `.catch()`-guarded and can silently no-op), the menu can be
  left open when a *recorded* `openConfigSurface` call fires next. The trigger's click
  handler is a toggle (`global-config-menu.component.ts:47`, `toggleMenu()`), so a second
  `director.click(trigger)` onto an already-open menu would **close** it, and the
  following `item.waitFor({ state: 'visible' })` in `openConfigSurface` (`config-menu.ts:
  16-19`) would then wait for an item that just became hidden and time out. This needs
  two independent failures to compound (a silent-helper failure, then a recorded-helper
  timeout), so it is a plausible but low-probability cascading failure, not a defect to
  block on. Recorded as an observed risk, not a separate finding.
- Playwright/page-close races are handled: every raw action in `prewarm.ts` and
  `config-menu.ts` is `.catch()`-wrapped or inside a `try`, matching the SILENT/GUARDED
  rules; verified by reading every awaited call in both files.

### 5. What is missing that the requirements never mentioned?

- `batches.md`'s edge-case list (line 100) only calls out "prewarm starting on a
  configuration surface... restore through the menu," which Task 5.2 does handle. It
  never states the "started on neither a tab nor a configuration surface" case
  explicitly, so the gap in Failure mode 1 is as much an underspecified requirement as an
  implementation miss — flagged here so the team-leader can decide whether it is worth a
  follow-up task or an accepted risk note, the way Batch 1-4's residual risks were
  recorded.
- No spec/test exists for `config-menu.ts`'s three exported helpers (unit-testable
  without Electron, since they only need a `Page`-shaped fake or a Playwright component
  test). Batch 5's scoped verification is `typecheck,lint` only per `batches.md`, so this
  is consistent with what was asked, not a violation — noting it because the restore gap
  below would have been caught by even a minimal test of `prewarmThoth`'s restore branch.

## Failure modes

### 1. `prewarmThoth` cannot restore the originating surface for any `ViewType` outside the four tab-row views and the four configuration-menu items

- Trigger: `prewarmThoth` runs while the app is showing a view that is neither one of
  the four top-nav tabs (`chat`, `tasks`, `tribunal`, `analytics` — the only ones
  `activeNavTitle` can read via `[role="tab"][aria-selected="true"]`,
  `prewarm.ts:33-39`) nor one of the four `ConfigurationSurfaceId`s (`thoth`,
  `setup-hub`, `marketplace`, `settings` — the only ones `activeConfigSurface` can read
  via `aria-current="true"`, `config-menu.ts:70`). `libs/shared/src/lib/types/webview-
  surface.types.ts:39-50` shows `ViewType` also includes `setup-wizard`,
  `orchestra-canvas` and `harness-builder`; `plan-review.md` finding 6 confirms
  `setup-wizard` and `harness-builder` are reachable from Setup hub's own buttons with no
  workspace present. The bare pre-workspace welcome screen (no tab row rendered, no
  configuration surface open) reaches the same "both null" state.
- Symptom: `original` and `originalConfig` are both `null` at `prewarm.ts:92-93`. The
  function proceeds to `openConfigSurfaceSilently(page, 'thoth')` (`:94`), mounts Thoth,
  runs its inner-tab loop, then reaches the restore block (`:111-115`): neither branch
  fires, so the app is left on Thoth even though it started somewhere else — no error,
  no log, no return-value signal to the caller.
- Evidence: `apps/ptah-electron-e2e/src/showcase/_harness/prewarm.ts:88-116` (the
  restore block specifically at `:111-115`); `apps/ptah-electron-e2e/src/showcase/
  _harness/config-menu.ts:65-90` (`activeConfigSurface`'s coverage is limited to
  `CONFIGURATION_SURFACE_IDS`); `libs/shared/src/lib/types/webview-surface.types.ts:39-
  50` (the full `ViewType` union); `libs/frontend/core/src/lib/services/app-state.
  service.ts:57-67` (`ConfigurationSurfaceId`/`CONFIGURATION_SURFACE_IDS` — the exact
  four ids `activeConfigSurface` can detect).
- Current handling: none — no `else` branch, no warning, no fallback (for example
  "go back to welcome" or a captured URL/route to restore by), and no propagated failure
  the caller could `.catch()` and act on.
- Actual impact today: benign in practice. The only caller, `thoth-tour.scene.ts:175`,
  calls `goToThoth(page, director)` immediately afterward, which itself needs to land on
  Thoth, so the coincidence hides the bug. It stops being benign the moment a future
  Batch 6/7 scene reuses `prewarmThoth` (or a similarly-shaped new prewarm helper) ahead
  of a step that does *not* also want Thoth, or if a scene is recorded against a profile
  that boots to the bare welcome screen (first run / reset profile) rather than the
  operator's usual already-open workspace.
- Recommendation: add a genuine fallback in the restore block — at minimum, when both
  `original` and `originalConfig` are null, call `page.locator('[data-test="config-back-
  to-welcome"]')` if visible, or record the pre-navigation `page.url()`/route and
  restore via `page.goto()`/an equivalent silent re-navigation, so "no known origin"
  degrades to "return to welcome" instead of "stay on Thoth." At minimum, document the
  gap explicitly in the function's JSDoc so a future caller does not assume the "returns
  to the starting surface" contract is unconditional.

### 2. Menu-open/close races between silent and recorded helpers can strand a recorded scene on a timeout

- Trigger: `closeMenuSilently` (`config-menu.ts:38-43`) fails to actually close the
  dropdown (its `Escape` press is wrapped in `.catch(() => undefined)`, so a failure is
  invisible), immediately followed by a recorded `openConfigSurface` call in a scene
  body.
- Symptom: `openConfigSurface`'s `director.click(trigger)` (`config-menu.ts:16`) hits
  the toggle handler while the menu is already open and closes it instead of opening it;
  the following `item.waitFor({ state: 'visible' })` (`:18`) then waits for an item that
  just disappeared and times out, throwing (uncaught, per the recorded helper's
  by-design "propagate failures" behaviour noted in `batch-5-report.md`).
- Evidence: `global-config-menu.component.ts:47` (`toggleMenu()` on the trigger's
  `(click)`); `config-menu.ts:11-20` and `:38-43`.
- Current handling: none beyond the low base-rate of the triggering failure (`Escape`
  failing to close a dropdown that is, by construction, already open and receiving the
  keypress).
- Recommendation: no change required to unblock this batch — this needs two independent
  failures to compound and no evidence in the diff or the report shows it happening. Flag
  it for whoever eventually gives the menu helper test coverage (see Q5), so the
  fallback in `closeMenuSilently` is pinned rather than assumed.

## Blocking issues

None found.

## Serious issues

### `prewarmThoth` has no restore path when the originating view is untracked

- File: `apps/ptah-electron-e2e/src/showcase/_harness/prewarm.ts:111-115`
- Scenario: see Failure mode 1 — any `ViewType` outside the tab row and the
  configuration menu (`setup-wizard`, `harness-builder`, the bare welcome screen, or an
  `activeConfigSurface` detection failure) is not restorable.
- Impact: the check explicitly called for in this review ("no path that leaves the app
  on Thoth when it started elsewhere") fails for these states. Silent today only because
  of the one caller's coincidental downstream navigation; would surface as visibly wrong
  footage the moment that coincidence stops holding.
- Fix: add the fallback described in Failure mode 1's recommendation, or explicitly scope
  and document the restore contract as "tab-row and configuration-surface origins only."

## Moderate and minor issues

- MODERATE: `activeConfigSurface` conflates "no surface is active" with "detection
  failed" by returning `null` for both (`config-menu.ts:85-89`). Not independently
  actionable without a broader silent-helper return-type change (`boolean | null` vs
  `T | null` is already the codebase's pattern elsewhere in this file), so folded into
  Failure mode 1 rather than filed separately.
- MINOR: the cascading close/open race in Failure mode 2 is worth a comment or a test
  once this helper gets coverage; not a blocker today.

## Data flow

1. Scene test starts (Electron launched via `showcase-fixtures.ts`, real persisted
   profile) — OK, out of this batch's scope.
2. `thoth-tour.scene.ts:175` calls `prewarmThoth(page, [...])` — captures
   `activeNavTitle` then `activeConfigSurface` — OK for the four tab-row and four
   configuration-menu views; GAP for every other `ViewType` (Failure mode 1).
3. `openConfigSurfaceSilently(page, 'thoth')` opens the menu (visibility-guarded, raw
   click) and clicks the Thoth item — OK, matches `data-test="config-menu-item-thoth"`
   in `global-config-menu.component.ts:67`.
4. Inner-tab loop clicks `#thoth-tab-<id>` and waits for `#thoth-panel-<id>` — OK,
   selectors unchanged by this batch, matched against `thoth-shell` ids used pre-batch.
5. Restore block: tab-row or configuration-menu origin — OK; untracked origin — GAP
   (Failure mode 1).
6. `goToThoth(page, director)` (`thoth-tour.scene.ts:105-113`) — recorded
   `openConfigSurface(page, director, 'thoth')` then the pre-existing
   `#thoth-tab-memory` wait — OK, matches `data-test="config-menu-trigger"` /
   `data-test="config-menu-item-thoth"` in the real component, and `director.click` is
   used for both clicks (camera beats recorded) as required.
7. `skills-tour.scene.ts:goToSkills` and `memory-recall.scene.ts:goToMemory` — same
   `openConfigSurface` entry, original inner-tab waits preserved — OK.
8. `ui-driver.ts:goto('chat'|'canvas')` — locator changed from `Canvas`/`[title="Orchestra
   Canvas"]` to `Chat`/`[title="Chat"]` — OK, matches
   `electron-shell.component.ts:128` (`title="Chat"`), confirmed against the real
   (uncommitted Batch 4) template.
9. Repo-wide sweep for remaining stale selectors — every hit
   (`gateway-tour.scene.ts:86`, `cron-tour.scene.ts:64`, `setup-wizard-tour.scene.ts:49`,
   `settings-tour.scene.ts:85`, `marketplace-tour.scene.ts:97`,
   `canvas-orchestra.scene.ts:44`, `chat-code-edit.scene.ts:179,181`,
   `dashboard-tour.scene.ts:53`) maps one-to-one to `batches.md` Task 6.1-6.5 and 7.1-7.3
   — OK, correctly out of Batch 5's file list, not a leak.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Task 5.1 — `ConfigSurfaceId` union, `openConfigSurface` (recorded), `openConfigSurfaceSilently` (guarded), `activeConfigSurface`, data-test-only selectors | COMPLETE | None found |
| Task 5.2 — prewarm through the menu, restore by `activeNavTitle` else `activeConfigSurface`, SILENT/GUARDED/NON-DESTRUCTIVE kept | PARTIAL | No restore fallback when neither signal is captured (Failure mode 1) |
| Task 5.3 — driver Chat rename, minimal diff | COMPLETE | None found |
| Task 5.4 — thoth-tour uses `openConfigSurface`, keeps `#thoth-tab-memory` wait | COMPLETE | None found |
| Task 5.5 — skills-tour uses `openConfigSurface`, keeps following waits | COMPLETE | None found |
| Task 5.6 — memory-recall uses `openConfigSurface`, keeps memory-tab click/wait | COMPLETE | None found |
| Batch 5 verification — six files, no `getByRole('tab', { name: 'Thoth' })` remains, typecheck/lint pass | COMPLETE | Confirmed via grep and `ptah_get_diagnostics` |
| Repo rules — no `as any`, no `@ts-ignore`, no dead code | COMPLETE | None found |

Implicit requirements not addressed: the restore contract ("return to the starting
surface") implicitly promised by `prewarmThoth`'s own JSDoc (`prewarm.ts:82-87`) is not
honoured for `ViewType` values outside the tab row and the configuration menu.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Start on a tab-row view (chat/tasks/tribunal/analytics) | YES | `activeNavTitle` + `restoreNav` | None |
| Start on a configuration surface (thoth/setup-hub/marketplace/settings) | YES | `activeConfigSurface` + `openConfigSurfaceSilently` | None |
| Start on an untracked `ViewType` (setup-wizard, harness-builder) or bare welcome screen | NO | Restore block has no fallback branch | See Failure mode 1 |
| Menu already open when a silent helper runs | YES | `openMenuSilently`'s "already visible" short-circuit | None |
| Trigger/menu items not visible (gated/renamed chrome) | YES | Every silent helper returns `false`/`null`, `.catch()`-guarded | None |
| Recorded helper (`openConfigSurface`) called against a missing trigger | YES (by design) | Propagates the Playwright timeout, matching the report's "deliberately propagates failures" | Consistent with plan; not a gap |
| Page closes mid-wait during prewarm | YES | `.catch()` on every awaited timeout/navigation | None |

## Verdict

- Recommendation: REVISE (a small, well-scoped fix — add the missing restore fallback,
  or explicitly narrow and document the restore contract), acceptable to land as-is if
  the team-leader records the gap as an accepted risk the way Batch 1-4 recorded
  comparable residual items, given it is currently inert.
- Confidence: HIGH — the gap is a straightforward code-reading finding (a missing `else`
  branch), independently corroborated by the full `ViewType` union and the real
  `ConfigurationSurfaceId` list, not a speculative scenario.
- Top risk: a future scene wires `prewarmThoth` (or a similarly-shaped prewarm helper)
  ahead of a step that does not also want Thoth, or is recorded against a freshly reset
  profile, and the recording silently opens on the wrong surface with no test or log to
  catch it.
- What a robust implementation would add: an explicit fallback in `prewarmThoth`'s
  restore block for the "neither signal captured" case (back-to-welcome button, captured
  URL, or a documented "Thoth-only origins supported" contract), and a minimal unit test
  or Playwright component test around `config-menu.ts`'s three exported helpers so this
  class of gap is pinned rather than discovered by a future reviewer.
