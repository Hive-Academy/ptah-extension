# Phase B fix report

| Item | Result | File:line | Test |
| --- | --- | --- | --- |
| Desktop dock | All five regions explicitly occupy row 1 in identity, actions, field, Status, Start new column order; recovery remains on row 2. | `command-dock.component.ts:19` | CSS placement assertions in `command-dock.component.spec.ts:27` |
| Responsive breakpoints | Preserved viewport rules at 1100px and 720px, with three and four primary rows respectively. Start new spans the full mobile row. | `command-dock.component.ts:26` | CSS breakpoint assertions in `command-dock.component.spec.ts:34` |
| Layout test | Reads the exact CSS string supplied to component metadata and checks grid placements at each breakpoint; behavior tests remain. | `command-dock.component.spec.ts:15` | 532 command-center tests passed |
| Accessible root | Added `role="group"` to the labelled dock root. | `command-dock.component.ts:56` | Role assertion in `command-dock.component.spec.ts:19` |

The command field retains its visible status announcement and Tribunal guidance inside the field cell. They can increase desktop row height; moving them to a separate grid row would require changing the child component's structure, so this optional refinement remains for visual review. The unframed page state was accepted for Phase A2b and was not changed here.

## Checks

| Check | Result |
| --- | --- |
| `npx nx typecheck command-center --parallel=1 --output-style=static` | Passed (exit 0) |
| `npx nx lint command-center --parallel=1 --output-style=static` | Passed, 0 errors and 0 warnings (exit 0) |
| `npx nx test command-center --parallel=1 --output-style=static --maxWorkers=2` | Passed, 46 suites and 532 tests (exit 0) |
| `npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2` | Passed, 11 tests (exit 0) |

## Orchestrator notes

- Review item 2 (container queries, 900px) not applied: the approved prototype dock uses viewport
  `@media(max-width:1100px)` and `@media(max-width:720px)` rules, and the page stats band uses the
  same 1100px breakpoint. The lane kept those breakpoints on purpose.
- Review item 4 (page shows the child components unframed) accepted as a temporary state: A2b
  switches the page to `ptah-command-dock` in the same PR.
- Orchestrator re-ran the checks after the fix: typecheck pass, lint 0/0, 532/532 tests, alpha
  guard 11/11, degradation audit 294.
