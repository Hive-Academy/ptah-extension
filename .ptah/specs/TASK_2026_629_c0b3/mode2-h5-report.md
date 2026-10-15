# Mode 2 (H5): Batch R9v verify, TASK_2026_629_c0b3

**Verdict: PASS on the Mode 2 checks.** All six scoped checks and both named-case runs are green. The
report and the files on disk agree. Nothing was committed: under decision row 95 the orchestrator
commits.

**Commit gate: blocked.** The scoped re-review `codex-review-R9v-fix.md` was on disk by the end of this
run. Its verdict is **REVISE 6/10**, with one new Serious finding: late positioning leaves auto-update
observers attached to stale panels (see "Recorded, not fixed", item 2). Under the fix-round rule a
Serious must be fixed, so the ready commit command below must not run until the orchestrator rules on
that finding.

## Step 1-2: Report vs disk

`git status --short libs apps` lists exactly the 8 R9v paths (row 102) and nothing else. No other path
was found.

- M `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts` / `.spec.ts`
- M `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts` / `.spec.ts`
- M `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.ts` / `.spec.ts`
- M `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts` / `.spec.ts`

The diff is 950 lines added and 24 removed. It contains no TODO, FIXME, skip or only markers. The
contract points trace to code:

- Card inputs: `canMoveUp`, `canMoveDown` (`canvas-rail-card.component.ts:249-250`) and
  `splitDisabledReason`.
- Card outputs: `openBesideRequested`, `moveUpRequested` and `moveDownRequested`, each an
  `output<string>()`.
- B6 constants: `SPLIT_NEEDS_TWO_SESSIONS_REASON` and `SPLIT_ALREADY_FOCUSED_REASON`.
- The trigger is labelled `Session actions`, with `aria-haspopup="menu"`, `aria-expanded` bound to
  `menuOpen()`, and `[tabIndex]="focused() ? 0 : -1"`. Clicks inside `data-rail-actions` are guarded.
- The late-open guard is `onMenuOpened()`. It focuses the first item only while `menuOpen()`.
- Rail input `splitDisabledReason` is at `canvas-rail.component.ts:241`. The Rail forwards the three
  outputs unchanged (`:196-198`).
- `canMoveUp` and `canMoveDown` come from `!first` / `!last` over the sorted `orderedTiles()` (`:189-190`).
- `cardSplitReason` (`:273-278`): the board reason wins; otherwise only the focused card gets
  `SPLIT_ALREADY_FOCUSED_REASON`.
- The collapsed list uses `py-2` with no horizontal padding, plus the `rail-scroll-collapsed` class.
- `railMoveKey` (`canvas-rail-keyboard.ts:16-23`): Alt+Shift+ArrowUp/Down only; Ctrl or Meta reject.
- NativePopover:
  - `openGeneration` bumps on open, close and destroy.
  - `positionPanel` races the position against `POPOVER_POSITION_TIMEOUT_MS` (1000 ms) and clears the
    timer in `finally`.
  - On a failed or timed-out position it shows the panel unpositioned, with a dev-mode
    `console.error`.
  - When `isOpen()` is already false at entry, the open returns early.

## Step 3: Checks (serial, through `.ptah/tmp/check-run.mjs`; logs `%TEMP%\629-check-<label>.log`)

| # | Label | Command (from W) | Result |
| --- | --- | --- | --- |
| 1 | `r9v-full` | `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. `Test Suites: 23 passed, 23 total`; `Tests: 276 passed, 276 total` (17.3 s). No console error or warn lines in the log. |
| 2 | `r9v-tc` | `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0. `Successfully ran target typecheck`; 0 error lines |
| 3 | `r9v-lint` | `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0. `16 problems (0 errors, 16 warnings)`. That equals the R9l count (mode2-h3: 16), so R9v adds none (detail below). |
| 4 | `r9v-ui-spec` | `npx nx test @ptah-extension/ui --testFile=native-popover.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. `Test Suites: 1 passed, 1 total`; `Tests: 19 passed, 19 total`. One non-failing `NG0953` console.warn (residual 3). |
| 5 | `r9v-ui-tc` | `npx nx typecheck @ptah-extension/ui --parallel=1 --skip-nx-cache` | exit 0. `Successfully ran target typecheck` |
| 6 | `r9v-ui-lint` | `npx nx lint @ptah-extension/ui --parallel=1 --skip-nx-cache` | exit 0. 0 warnings, 0 errors (no `problems` line) |
| N1 | `r9v-names-canvas` | `npx jest -c libs/frontend/canvas/jest.config.ts <card, rail, keyboard specs> --coverage=false --maxWorkers=2 --json --outputFile=%TEMP%/629-r9v-names-canvas.json` | exit 0. 3 suites, 44 passed, `numFailedTests=0` |
| N2 | `r9v-names-ui` | `npx jest -c libs/frontend/ui/jest.config.ts native-popover.component.spec.ts --coverage=false --maxWorkers=2 --json --outputFile=%TEMP%/629-r9v-names-ui.json` | exit 0. 1 suite, 19 passed, `numFailedTests=0` |

### Canvas suite delta vs R9l

The R9l Mode 2 run (H3) ran only spec files, not the full canvas suite. The R9l baseline was therefore
rebuilt from the last full run and git:

- R9f full run (H2): 23 suites, 255 tests.
- R9l (`27be43205`) removed 3 `canvas-detail.service.spec.ts` cases (8 -> 5) and 1
  `canvas-layout-persistence.service.spec.ts` case (16 -> 15).
- R9u touched chat only.
- Baseline at HEAD: **23 suites, 251 tests**.

Now: **23 suites, 276 tests**, so +0 suites and +25 tests. All 25 are R9v additions in the three owned
canvas specs. HEAD has 19 cases across them (card 8, Rail 5, keyboard 4 `it.each` + 2); the working
tree has 44:

- Card spec: 8 -> 19 (+11, of which 1 is a fix-round case).
- Rail spec: 5 -> 10 (+5).
- Keyboard spec: 6 -> 15 (+9; 8 `railMoveKey` table rows and 1 Alt+Shift/plain-arrow case).

No test was lost: every HEAD case title is still present and passing in N1.

### Lint detail

Canvas: all 16 warnings are in specs.

- 3 in `canvas-rail.component.spec.ts` (`:62:20`, `:73:21`, `:82:5`, `no-non-null-assertion`). All
  three sit on unchanged HEAD lines (HEAD `:57/:68/:77`), shifted by the 5 import lines R9v added. R9v's
  own hunks are `:3`, `:8-12`, `:31-34` and `:98-160`.
- The other 13 are in `canvas-lane-tabs.component.spec.ts`, `canvas-lane-view.component.spec.ts`,
  `canvas-layout-persistence.service.spec.ts:67` and `canvas-focus-header.component.spec.ts`. These are
  the same files listed at R9l.

UI: 0 warnings.

## Named-case evidence (Jest JSON, all `passed`)

| Contract case | Test (`fullName`) |
| --- | --- |
| Payload forwarding card -> Rail, all three outputs | `CanvasRailCardComponent emits the tab id from Open beside, Move up and Move down (payload forwarding, card side)`; `CanvasRailComponent forwards openBeside, moveUp and moveDown payloads from the card unchanged (payload forwarding, Rail side)` |
| Disabled reason (both strings) shown, Open beside not emitted | `CanvasRailCardComponent shows the disabled reason "Open another session first to split" and does not emit Open beside`; `... "This session is already in the focused pane" and does not emit Open beside`; `CanvasRailComponent passes the board reason to every card, else the focused-pane reason to the focused card only (B6)`; `CanvasRailCardComponent enables Open beside without a reason (a stale id is never a disabled reason)` |
| Trigger click does not select | `CanvasRailCardComponent does not select the session from a trigger, menu or backdrop click` |
| Collapsed Tab order select then trigger | `CanvasRailCardComponent puts the collapsed select first and the trigger second in Tab order, only on the roving card` |
| Alt+Shift forwarding and boundary | `CanvasRailCardComponent forwards Alt+Shift+ArrowUp/Down from the select button and stops at the first and last card`; `CanvasRailComponent computes Move up/down from the sorted ids: first card no Move up, last no Move down`; 8 x `handleCanvasRailKeydown reads <key> <mods> as a move of <up/down/null>` |
| Plain arrows unchanged | `handleCanvasRailKeydown leaves Alt+Shift arrows to the card and keeps plain arrows moving focus`; `CanvasRailCardComponent leaves plain arrows alone (no move, not prevented)`; `CanvasRailComponent keeps plain arrows with handleCanvasRailKeydown and leaves Alt+Shift arrows to the card`; the existing `CanvasRailComponent moves DOM focus through collapsed cards with repeated ArrowDown and ArrowUp` |
| Escape focus return | `CanvasRailCardComponent closes the menu on Escape and returns focus to the trigger` |
| 176/96/56 px heights, gutter, `+N more` fits (N6b, real compact card) | `CanvasRailCardComponent keeps 176/96/56 px heights with the action gutter and +N more still fitting (N6b)` |
| Collapsed padding and gutter | `CanvasRailComponent drops the horizontal list padding and the scrollbar gutter only in the collapsed 56 px rail` |
| Fix round, Serious (reject / timeout) | `NativePopoverComponent Positioning failure and stale opens shows the panel unpositioned, focuses it and emits opened when positioning rejects; Escape still closes and restores focus`; `... shows the panel unpositioned once positioning overruns its bound` |
| Fix round, Moderate 1 | `NativePopoverComponent Positioning failure and stale opens does not focus or emit opened when closed before positioning resolves`; `CanvasRailCardComponent ignores a late opened after the menu closed (no focus pulled into the menu)` |

The pre-existing NativePopover cases (16) all pass, including `should emit opened event after async
positioning completes` and `Focus management should restore focus to previously-focused element when
popover closes`.

## Pre-existing failures outside R9v

None. Every check exited 0.

## Recorded, not fixed

1. **Minor: the collapsed Rail hides its scrollbar.** Source: `canvas-rail.component.ts:65-74`, applied
   in the template at `:158-173`, from the review Minor and the R9v report D4. Wheel and keyboard
   scrolling still work; a mouse user cannot see or drag a scrollbar in the 56 px rail. Decision row 102
   leaves it to the user's manual test.

2. **floating-ui.service residual: a late position installs `autoUpdate` on a stale panel.** Reported
   in `lane-R9v-fix-report.md` "Out-of-scope observations", at `floating-ui.service.ts:143-150`.
   **The re-review raised this to Serious** (`codex-review-R9v-fix.md`, "New defect"), so it no longer
   qualifies as recorded-not-fixed.
   - Mechanism: `position()` is neither cancelled nor owned per request. The service keeps one
     `cleanupFn` (`:87`) and overwrites it at `:146`. After a timeout-then-close, or after a
     close-then-reopen, the stale result installs an observer that nothing releases.
   - Pre-existing: HEAD's `openPopover` awaited `position()` with no guard. Close-before-resolve
     already leaked the same way at HEAD, and R9v's 1000 ms race adds the timeout-then-close ordering.
   - Out of scope for R9v's 8 files: the fix needs `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts`
     plus its existing `floating-ui.service.spec.ts`.
   - Destroy is safe: the service is component-provided (`native-popover.component.ts:76`) and checks
     `isDestroyed` before `autoUpdate` (`floating-ui.service.ts:144`).

3. **New residual (Minor): `NG0953` dev warning on a queued open after destroy.** This is the check-4
   console.warn, "Unexpected emit for destroyed OutputRef" at `native-popover.component.ts:230`.
   - Mechanism: the effect queues `openPopover` in a microtask (`:192`). If the component is destroyed
     before that microtask runs, `isOpen()` is still true, and `++openGeneration` (`:205`) runs after
     destroy's bump (`:301`), so the stale-open guard misses it.
   - Impact: a dev-mode warning and a no-op focus on a detached panel. No observer is installed,
     because the service sees `isDestroyed`. HEAD had the same unguarded path.
   - Suggested fix: set a `destroyed` flag and check it at the top of `openPopover`.

4. **Moderate residual (re-review): the unpositioned fallback can clip at a viewport edge.** It has no
   flip or shift (`native-popover.component.ts:219-227`), but focus, Escape and the backdrop still work.
   The pixel fit and the 272 px `+N more` fit stay with the Electron visual re-check (row 102).

5. The Rail's Alt+Shift case does not prove forwarding by itself, because CardStub never emits a move.
   The card-side case covers forwarding (original review, named-case audit). Naming only.

## Ready commit command

Run from W in the foreground, and only after the orchestrator resolves the re-review's Serious finding
and no writer lane is running.

```bash
git add libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.spec.ts \
  libs/frontend/ui/src/lib/native/popover/native-popover.component.ts \
  libs/frontend/ui/src/lib/native/popover/native-popover.component.spec.ts
git commit -F - <<'EOF'
feat(canvas,ui): batch R9v - Rail card actions menu, safe popover open

Add a Session actions menu to each Rail card: Open beside, Move up
and Move down emit the tab id, and the Rail forwards all three to
the board unchanged. Move up/down follow the sorted tab ids, so the
first card has no Move up and the last no Move down. Open beside is
disabled with a visible reason when the board has fewer than two
sessions or the card is already in the focused pane.
Alt+Shift+ArrowUp/Down on a card moves it; plain arrows still rove.
The collapsed rail uses a 32/24 px select and trigger row.

NativePopover: a rejected or overrunning first position (1000 ms)
now shows the panel unpositioned instead of leaving it invisible
behind its backdrop. An open that settles after close does not
focus the panel or emit opened.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

The subject is 70 characters, so it is at most 72. Every body line is 72 characters or fewer. The type
is `feat`, and both scopes, `canvas` and `ui`, are in the `.commitlintrc.json` `scope-enum`, so the
multi-scope subject is allowed. If a fix round adds `floating-ui.service.ts` and its spec, add both
paths to `git add` and one body sentence about the service.
