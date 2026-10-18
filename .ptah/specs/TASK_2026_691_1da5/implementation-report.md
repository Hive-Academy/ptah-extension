# Implementation report — TASK_2026_691_1da5

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts`
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay.component.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-work-list.component.ts`
- `libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts`
- `libs/frontend/command-center/src/lib/components/command-state-icon.ts` (new)
- `.ptah/specs/TASK_2026_691_1da5/implementation-report.md` (this report)

## Scope completed

1. Provider marks: the overlay label plates and card use provider marks for IDs in `PROVIDER_BRAND_SLUGS` or `PROVIDER_MARKS`, and monograms otherwise (`command-overlay.component.ts:74,131,307`). The work list follows the same rule (`command-work-list.component.ts:51,148`). Root and child tabs fall back to the tab's `sessionStats.modelUsageList[0].contextCapacity.providerId` when live statistics are unavailable (`command-center-projection.source.ts:124,234`). CLI agents and workflow lanes resolve IDs using the public `CLI_PROVIDER_MARK_IDS` mapping, including hand drawn `pi` and `ptah-cli` marks (`command-center-projection.source.ts:26,149,200`). SDK subagents already use `anthropic` (`:164`). Tests: projection fallback and CLI mark (`command-center-projection.source.spec.ts:21`), known hand drawn marks and unknown monogram (`command-work-list.component.spec.ts:86`), existing overlay provider case (`command-overlay.component.spec.ts:251`). The tab field is defined in `libs/frontend/chat-types/src/lib/chat-types.ts:720` as `sessionStats`; its provider-bearing model rows are defined in `libs/shared/src/lib/types/rpc/rpc-session.types.ts:395`.
2. Lucide state icons and visible words: the shared state map assigns CircleCheck, CircleX, Ban, MessageCircleQuestion, LoaderCircle and CircleDashed (`command-state-icon.ts:12`). Both DOM surfaces use it with state colors and aria-hidden icons (`command-overlay.component.ts:89,146`; `command-work-list.component.ts:72`). The existing reduced-motion signal governs transform-only spinner animation; the work list receives it from the page (`command-center-page.component.ts:373`). Tests: visible state and icon presence (`command-overlay.component.spec.ts:251`; `command-work-list.component.spec.ts:22,142`), reduced motion (`command-overlay.component.spec.ts:343`). Canvas rendering, sprite cache and scene layout were untouched.

## Overlay audit on main

| Case | Applies? | Evidence before edit | Result and test |
| --- | --- | --- | --- |
| Pin outlives removed node | Applies | `command-overlay.component.ts:176-207` had effects for hover, selection and hidden plates, but none for projection membership. `activeNode` returned null while `pinnedNodeId` remained set (`:146-149`). | Membership effect releases pin and positioner (`command-overlay.component.ts:240-245`); regression test `command-overlay.component.spec.ts:355`. |
| Escape leaves hover preview | Applies | `command-overlay.component.ts:314-317` returned when no pin existed. | Escape closes a preview and suppresses reopening until hover ends (`command-overlay.component.ts:382-390,418`); regression test `command-overlay.component.spec.ts:369`. |
| `aria-expanded` lacks `aria-controls` | Applies | Plate had `aria-expanded` at `command-overlay.component.ts:55-59` and no `aria-controls`. | Pinned plate points to `command-node-card` (`command-overlay.component.ts:63`); regression test `command-overlay.component.spec.ts:387`. |
| Hover preview grows page height | Not applicable | Canvas overlay wrapper was absolutely positioned (`command-overlay.component.ts:36` before edit); card and pointer bridge were fixed (`:83-92`). They do not participate in page height. | No scene or layout change. |

## Checks

- `npx nx typecheck command-center --parallel=1 --output-style=static`: **Successfully ran target typecheck**.
- `npx nx lint command-center --parallel=1 --output-style=static`: **Successfully ran target lint**.
- `npx nx test command-center --parallel=1 --output-style=static -- --maxWorkers=2`: **40 suites passed, 422 tests passed**. Jest reported a worker teardown warning.
- Changed specs after the fixture correction: **3 suites passed, 31 tests passed** (`npx jest -c libs/frontend/command-center/jest.config.ts ... --coverage=false --maxWorkers=2`).
- `ptah_get_diagnostics` after edits: no diagnostics in changed files. It reports 29 existing errors in untouched sibling spec files.

## Decisions

- **Provider fallback:** use the tab's session statistics model row. Options were stored `sessionStats` or inferring from `sessionModel`; the former contains an explicit provider ID, while `sessionModel` is only a model name. Reversible.
- **CLI mark recognition:** accept both vendored brand slugs and hand drawn provider marks. `CLI_PROVIDER_MARK_IDS` includes `pi` and `ptah-cli`, which are in `PROVIDER_MARKS`. Reversible.
- **Page-height case:** leave fixed and absolute canvas overlay positioning intact; the reported growth path is absent on main. Reversible.

## Not done

- No canvas renderer, sprite cache or layout edits. No dependency changes.
