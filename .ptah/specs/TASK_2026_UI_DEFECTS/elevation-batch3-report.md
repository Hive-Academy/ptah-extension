# Design elevation — Batch 3 report

## Delivered

| Section                              | Before → after                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings page                        | Legacy `bg-base-100` page canvas → `bg-surface-0` at `libs/frontend/chat/src/lib/settings/settings.component.html:16`.                                                                                                                                                                                            |
| Session budget                       | Local `bg-base-100`/border shell → `ptah-surface-section` (`tone="subtle"`, compact padding) at `ptah-ai/session-budget-settings.component.ts:155-325`. Compact bounded controls and `50M tokens` readouts are unchanged.                                                                                         |
| Lane guards                          | Local `bg-base-100`/border shell → `ptah-surface-section` at `ptah-ai/lane-guards-settings.component.ts:55-152`. It remains directly rendered by its parent; its compact validation inputs are unchanged.                                                                                                         |
| Orchestration policy                 | Raw `bg-base-200` policy bar → `ptah-surface-section` at `ptah-ai/agent-orchestration-config.component.ts:54-138`.                                                                                                                                                                                                |
| CLI matrix                           | Raw section/table backgrounds → a subtle `ptah-surface-section` and `surface-2` table wrapper at `ptah-ai/cli-orchestration-matrix.component.ts:176-216`. Table semantics and provider icons remain intact. Rows use `surface-2`, while a row holding an open editor uses `surface-3` (`:275-283`, `:1157-1159`). |
| CLI model/effort and Cursor popovers | Floating roots now use `surface-3` at `cli-model-effort-popover.component.ts:107-117` and `cursor-credential-popover.component.ts:38-40`; Cursor’s removal confirmation is a nested `surface-2` card at `:90-91`.                                                                                                 |
| Add CLI instance modal               | Header/footer chrome use `surface-3` at `providers/add-cli-instance-modal.component.ts:62,145`.                                                                                                                                                                                                                   |

## Form fields

No existing validated budget, lane-guard, or modal field was converted to `ptah-field`/`ptahFieldControl` in this pass. Those controls already have stable native label, help, error, and `aria-describedby` IDs asserted by their validation specs; changing to the primitive would require restructuring those error announcements. Their required `input-sm`/`select-sm`, bounded 32px controls, readable token values, and accessible names remain intact.

## Test IDs and specs

- Added `settings-section-session-budget`, `settings-section-lane-guards`, `settings-section-orchestration-policy`, and `settings-cli-matrix`.
- Updated the orchestration-policy and matrix specs for the new stable section IDs.
- Updated the matrix row visual-intent spec to assert the surface ladder rather than retired raw background utilities.

## Verification

- Focused Jest: 191 passed / 191 total across agent orchestration, matrix, session budget, lane guards, both popovers, and add-CLI modal specs.
- `npx nx typecheck @ptah-extension/chat --parallel=1`: passed. Nx Cloud reported its organization-plan 401 after the successful local target; this did not affect typecheck.
- Scoped `git diff --check`: no whitespace errors.

## Not done

- Provider/model picker internals and unrelated settings sections were not restructured: their existing surface/field migration belongs to the overlapping controls lane and was left intact to avoid clobbering concurrent work.
- No visual/browser run was performed; the requested memory-safe verification commands were used.
