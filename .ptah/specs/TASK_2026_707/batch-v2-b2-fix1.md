# Batch B2 usage layout: review fix 1

## Fixes

- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-kpi-strip.component.ts:18`: the six-tile group now announces “Usage totals for the selected range,” covering cost, tokens, and activity.
- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-kpi-strip.component.ts:28`: output tokens appear as a visible Processed tokens subline. The redundant cost tooltip clause was removed at line 68; savings and unpriced details remain there.

## Spec and verification

- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.spec.ts:163-166`: checks the group label and visible output-token paragraph (`Output 700 tokens`).
- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.spec.ts --coverage=false --maxWorkers=1 --silent`: **passed**, 1 suite and 35 tests.
- Scoped `ptah_get_diagnostics`: no errors in edited files. Six errors remain in sibling files outside this batch's ownership.

## Decisions

- Kept output tokens as a second compact subline on Processed tokens. The approved six-tile strip already uses small sublines for secondary counts, and this places the count with its matching total. Reversible.

## Not done

- No changes outside the two permitted source/spec files.
