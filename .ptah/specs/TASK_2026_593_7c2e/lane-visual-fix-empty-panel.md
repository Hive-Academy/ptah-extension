# Bell panel empty-state visual fix

## Changes

- `libs/frontend/notification-center/src/lib/notification-center.component.ts:42`: Kept the sticky Notifications header and `w-80` panel width. Moved Clear all notices into the header with a Trash2 icon, accessible name, existing `canClearAll()` disabled state, and unchanged `store.clearAll()` action.
- `libs/frontend/notification-center/src/lib/notification-center.component.ts:56`: Added one centered All clear state with a Check icon and readable “Nothing needs your attention.” text when both lists are empty. The two section headers and their empty lines are absent in that state.
- `libs/frontend/notification-center/src/lib/notification-center.component.ts:63`: Retained both sections when either list has items and added the Needs you count beside its heading.
- `libs/frontend/notification-center/src/lib/notification-center.component.spec.ts:78`: Checked populated sections and the Needs you count. Added an all-empty regression case, and checked that the header Clear all notices button calls the same store method while preserving Needs you rows.

## Decisions

- Kept the header Clear all notices button visible and disabled when there is nothing clearable, matching the approved prototype. This is reversible. Evidence: `prototype/notifications.html` uses a header button and disables it in the empty state; `design-spec.md` permits the disabled state.
- Kept short per-section empty lines when only one list has items, while suppressing both section wrappers when both lists are empty. This is reversible. Evidence: the defect concerns the all-empty state, and the task explicitly permits short empty lines in a partially populated panel.
- Kept `w-80` as explicitly approved in the task and `design-spec.md:162`.

## Projects to check

- `@ptah-extension/notification-center` test target. No test, Nx, Jest, build, or e2e command was run, as instructed.
- Scoped `ptah_get_diagnostics` found no errors in either changed file. It reported five pre-existing BigInt target errors in `libs/shared` sibling files outside this lane's ownership.
