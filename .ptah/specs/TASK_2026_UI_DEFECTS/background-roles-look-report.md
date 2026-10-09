# Background model roles look report

## Files changed

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.spec.ts`
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_UI_DEFECTS\background-roles-look-report.md`

## Result

The six background roles are now responsive cards rather than a table. Each card uses the CLI matrix row surface treatment: `surface-2` when idle, `surface-3` while its assignment editor is open, `rounded-lg`, and compact `p-3` spacing. The control area stacks on narrow widths and aligns horizontally from `sm` upward.

The existing provider/model picker, save callbacks and test IDs are unchanged. Provider marks now appear with the selected provider (or the main route provider for inherited assignments), model labels use available row width before truncating, and their existing full-route `title` remains. Tier labels reuse the CLI tier-chip classes: `badge badge-xs border-base-300 bg-base-300 text-[9px] text-base-content`.

The enhancement limit is preserved beneath Judging & enhancement as its own `surface-2` settings card; its saved value, editor, validation, scope display and Edit limit action are unchanged.

## Checks

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.spec.ts --coverage=false --maxWorkers=2` — passed, 1 suite / 52 tests.
- Scoped diagnostics for both changed source files — no diagnostics in requested files. The chat project reports unrelated pre-existing sibling errors; none are in this change.

## Decisions

- Reused the CLI matrix's surface ladder and compact tier-chip classes rather than creating any new token or shared primitive.
- Kept provider/model reassignment as the existing accessible dialog-trigger button, so the RPC-backed persistence keys and save behavior stay intact.
- Used `sm` as the row breakpoint: role details and controls form a vertical card layout below it, avoiding a horizontal scroll/table layout.
- Did not edit `orchestration-settings.component.ts`, preserving the other lane's anchor work and the existing collapsed header/count/summary.

## Proposed Removals

None.
