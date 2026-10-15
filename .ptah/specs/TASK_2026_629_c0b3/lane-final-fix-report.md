# Final-run fix report — F3–F7

## Defects

| Defect | Root cause | Change | Regression spec |
|---|---|---|---|
| F3 | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:156` read `sessionSubagentsForSession`, which filters to background Task records. The detail tabs read all records for the owning session. | The card now reads the monitor's full sub-agent map and filters by `parentSessionId === sessionIdentity()`. The CLI source remains `agentsForSession`. | `shows foreground Task sub-agents while running and after completion` in `compact-session-card.component.spec.ts` |
| F4 | `libs/frontend/canvas/src/lib/canvas-detail-geometry.ts:34` had a 320 px floor, leaving almost no transcript with a full-height tile row. | Floor is 70% of container height. Row-bottom placement and displacement of rows below are unchanged. | `gives a full-height tile row a usable detail while preserving its row bottom` in `canvas-detail-geometry.spec.ts` |
| F5 | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:1569` saved an untouched empty composer by clearing the shared draft. A second composer could mount before the old one unmounted and erase its draft. | Track the last restored or saved local content and skip saves when unchanged. A real edit to empty still clears the draft. | `preserves a draft when a second empty composer mounts before the first unmounts` in `chat-input.component.spec.ts` |
| F6 | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:692` opened detail for a card click even when the click followed text selection. | Ignore card clicks while a noncollapsed text selection is anchored inside that card; existing interactive-target and drag handling remain. | `keeps a card text selection without opening detail` in `canvas-tile.component.spec.ts` |
| F7 | `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts:31` used a backdrop inside the dock stacking context, leaving tiles above it and dock controls behind it. | Disable the backdrop; attach document `pointerdown` and Escape listeners only while open, with effect cleanup. Close when the request list transitions from nonempty to empty. | `closes from an outside pointer or Escape and removes document listeners on close`; `closes after the last request is answered` in `canvas-needs-you-queue.component.spec.ts` |

## Checks

Commands used `--parallel=1 --skip-nx-cache`; tests used `--coverage=false --maxWorkers=2`. All checks ran one at a time.

| Project | Focused specs | Full test | Typecheck | Lint |
|---|---|---|---|---|
| chat | `npx nx test chat --testFile=<spec> ...`: card 35/35, input 75/75 | `npx nx test chat ...`: 200/200 suites, 3,628 passed, 2 skipped | `npx nx typecheck chat ...`: pass; one NG8107 warning in unrelated peer-session-send component | `npx nx lint chat ...`: 0 errors, 37 warnings |
| canvas | `npx nx test canvas --testFile=<spec> ...`: geometry 2/2, tile 51/51, queue 8/8 | `npx nx test canvas ...`: 26/26 suites, 326/326 tests | `npx nx typecheck canvas ...`: pass; same NG8107 warning in chat dependency | `npx nx lint canvas ...`: 0 errors, 14 warnings |

The queue focused spec first failed because jsdom has no `PointerEvent`; the test dispatches a `pointerdown` with `MouseEvent` and then passed. Chat typecheck first rejected `ReturnType<typeof this._selectedFiles>`; explicit `ChatFile[]` and `PastedImage[]` types resolved it. The full chat suite ran before that type-only correction.

Scoped `ptah_get_diagnostics` found no diagnostics in the five changed implementation files. Its broader compiler scan reported 262 errors in sibling spec files, including older errors outside this change; this differs from the passing declared Nx library typecheck targets, which exclude spec files.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| Read all Task sub-agent records in the card | Expand the store accessor; filter the monitor map in the card | The detail tabs already use the full map and strict owning-session match; the store accessor excludes foreground records | Yes |
| Preserve pristine composers | Coordinate owners in the store; skip unchanged local saves | A new empty composer has no user change to persist, while explicit clearing changes its local snapshot | Yes |
| Close queue from document events | Move the backdrop outside the dock; remove backdrop and use scoped listeners | The backdrop's stacking context blocks dock buttons and misses tile clicks | Yes |

## Anything not done

- No live Electron rerun was requested or performed. The regressions passed after the fixes; a red run against the original code was not executed.
- The Ptah tools were exposed with an `mcp__ptah__` prefix, which the initial tool-name search missed. Earlier reads used the native CLI; the final scoped Ptah diagnostics are recorded above.
