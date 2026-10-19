# Batch B1 — integrated Voice dock

| Requirement | Result | File:line | Test |
| --- | --- | --- | --- |
| One presentational dock; forward the page's inputs and outputs | Added standalone OnPush dock with signal inputs, narrow outputs, and child composition. It delegates successful-send draft clearing to session controls. | `libs/frontend/command-center/src/lib/components/command-dock.component.ts:8` | `command-dock.component.spec.ts:31` |
| Responsive prototype rows and full-width field | Desktop single row; at 900px title, actions, and full-width field form three rows; at 720px Start new moves to a fourth full-width row. Stable region classes support layout assertions. | `libs/frontend/command-center/src/lib/components/command-dock.component.ts:28` | `command-dock.component.spec.ts:15` |
| D7 Start new; D9 no tab action | Start new forwards only `newSession`; no resume or tab input/output/action was added. | `libs/frontend/command-center/src/lib/components/command-session-controls.component.ts:15` | `command-dock.component.spec.ts:31` |
| Mic, mute, stop, interrupt, recovery and numeric meters | Existing guards/actions remain. Speaking adds an adjacent waveform; numeric mic/speaker meters retain accessible names and values; speaker is speaking-only. | `libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts:13` | `command-voice-hud.component.spec.ts:17`; `command-dock.component.spec.ts:81` |
| Status, send, guidance, selectors and draft retention | Status and Start new stay native buttons; form/input/label remain in the child tag. Empty sends are blocked; draft clears only after the caller reports success. | `libs/frontend/command-center/src/lib/components/command-session-controls.component.ts:11` | `command-session-controls.component.spec.ts:5`, `:60`; 46 command-center suites |
| Theme tokens and icons | Dock uses DaisyUI theme classes and local Lucide icons; no alpha base-content classes were added. | `libs/frontend/command-center/src/lib/components/command-dock.component.ts:14`; `command-voice-hud.component.ts:2` | Alpha guard: 11 passed |

## Checks

| Check | Result |
| --- | --- |
| `npx nx typecheck command-center --parallel=1 --output-style=static` | Passed |
| `npx nx lint command-center --parallel=1 --output-style=static` | Passed, 0 errors and 0 warnings |
| `npx nx test command-center --parallel=1 --output-style=static --maxWorkers=2` | Passed, 46 suites and 532 tests |
| `npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2` | Passed, 11 tests |

The scoped `ptah_get_diagnostics` request timed out while its TypeScript check remained in progress. The required Nx typecheck passed. The final desktop CSS grid refinement was made after the four checks; it did not change TypeScript or template bindings.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep draft state in `CommandSessionControlsComponent`; dock delegates `clearDraft` | Move state into dock; delegate to existing child | Existing page calls `clearDraft` only after `sendCommand` succeeds; plan says dock owns no voice session state. | Yes |
| Use scoped dock CSS with `ViewEncapsulation.None` to place child regions in one grid | Child owned grid; dock scoped grid | Parent must own layout while child selectors and actions remain intact. All CSS selectors are scoped under `.command-dock`. | Yes |
| Render Start new in the prototype's Resume last slot | New resume action; existing Start new | D7 and parity row 32 require `newSession` and prohibit `chooseCurrentTab()`. | Yes |

## Conflicts

No N1 DOM text contract was changed. The visible `Start new` label intentionally differs from the prototype's `Resume last` under binding decision D7. `Retry speech` and `Could not send` remain page-owned strings in the untouched page component.
