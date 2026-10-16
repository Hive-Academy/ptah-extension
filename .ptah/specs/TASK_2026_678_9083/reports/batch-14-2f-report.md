# Batch 14.2f — Command Center page completion

## Changes

1. D39 import switch: `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.ts:8` and `command-center-tribunal.transport.spec.ts:9` import `TribunalDiscoveryService` from the narrow `/discovery` entry. The matching Jest mock also uses `/discovery` (spec line 14). Removed the obsolete main-barrel mock from `command-center-page.controller.spec.ts`.
2. A1/D1 answer text: `command-center-tribunal.transport.ts:93` forwards the supplied answer unchanged unless it contains the standalone word `Confirm` in any case, when it sends `Decline`. `command-center-tribunal.transport.spec.ts:98` checks verbatim D1 text and a mixed-case Confirm guard.
3. Projection wiring: `command-center-page.component.ts:36` provides `CommandCenterProjectionSource`; `command-center-page.controller.ts:26` injects it; `command-center-page.controller.ts:75` supplies its input to `projectOwnedWork`. `command-center-page.controller.spec.ts:94` provides a source mock.
4. Page specs: new `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts`. Page teardown clears overlay card state and calls `exit()` at `command-center-page.component.ts:167-169`.

## Required spec cases

| Case | Spec name and location |
| --- | --- |
| Scene hover reaches overlay | `passes scene hoveredNodeId to the overlay input`, `command-center-page.component.spec.ts:106` |
| Work list selection unpins; pin does not select | `selects a work list row and unpins the overlay without selecting on pinNode`, `command-center-page.component.spec.ts:120` |
| List-only fallback | `keeps the work list and text controls in list-only mode`, `command-center-page.component.spec.ts:140` |
| Safe record-write-failure notice | `renders a safe record-write-failure notice`, `command-center-page.component.spec.ts:159` |
| Roster proposal and actions | `passes the roster proposal to the pending card and routes confirm and decline`, `command-center-page.component.spec.ts:176` |
| Page destroy and overlay state | `exits on destroy and leaves no overlay card or pending timer`, `command-center-page.component.spec.ts:208` |
| Real controller roster timeout cleanup | `clears a pending roster timer and card on exit`, `command-center-page.controller.spec.ts:384` |

## Verification

- Main barrel grep: `rg -n -F "@ptah-extension/tribunal-panel'" libs/frontend/command-center` returned no matches (exit 1).
- Final permitted Jest run: `Test Suites: 7 passed, 7 total`; `Tests: 42 passed, 42 total`. Four focused Jest invocations total. The unused main-barrel Jest mock was removed after this passing run and was not retested because the lane limit was reached.
- TypeScript: requested `npx tsc -p libs/frontend/command-center/tsconfig.lib.json --noEmit` output filtered for `command-center/src` was empty.
- ESLint: `npx eslint libs/frontend/command-center/src/lib/components` exited 0.
- Prettier: `--write` completed; `--check` reported `All matched files use Prettier code style!`.

## Decisions

- The transport checks a word boundary around `Confirm`, preserving ordinary answer text and rejecting an affirmative command.
- The page test replaces Canvas with a scene stub while exercising the real overlay, work list, and pending card. The controller spec separately checks that a roster timeout cannot answer after exit.
- Angular retains the detached fixture's DOM after `fixture.destroy()`, so teardown assertions inspect overlay state. Fake timers also include framework and component timers; the controller test advances past the roster deadline and verifies no Tribunal answer is sent.

## Anything not done

- The removed obsolete Jest mock was not rerun under Jest because all four permitted invocations had been used. No Nx, Git, build, serve, dev, or e2e command was run.
