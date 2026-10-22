# Batch 51 report

## Files changed or deleted

- Deleted `thoth/skills-lane-pickers.e2e.spec.ts`: its scenarios exercised removed lane pickers.
- Deleted `thoth/thoth-feed-visual.e2e.spec.ts`: its screenshots and assertions exercised removed Skills Activity and Settings subviews, candidate counts, and pipeline feed.
- Changed `thoth/activity-ticker.e2e.spec.ts`: kept the `activity:event` shell scenario and removed references to the deleted spec.
- Changed `settings/settings.fixtures.ts`: removed lane RPC stubs and judging fixture fields; retained the settings fixture, including enhancement timeout, and other RPC stubs.
- Changed `settings/settings-orchestration.e2e.spec.ts`: removed background role and Judge lane scenarios; retained CLI matrix, provider, and Cursor key scenarios.
- Changed `settings/settings-reachability.table.ts`: removed deleted lane dependent entries `#83` and `RUX-12`, their kept selector, and adjusted the capability count to 139.

## Acceptance search

`rg -n "skillSynthesis:listCandidates|getLanes|setLanes|lanes: \{|judgeProvider|judgeModel|refreshJudging|skills-lane-picker" libs/frontend/webview-e2e-harness` found **zero live hits**. It found seven stale comment references to the deleted lane picker spec in files outside the allowed edit list, detailed below. No test, typecheck, lint, build, serve, or e2e command was run. `git diff --check` reported no whitespace errors.

## Decisions

- Retained the activity ticker scenario because it covers `activity:event` from Cron, not `skillSynthesis:event`.
- Removed reachability entry `#83` because its only route was the deleted background roles UI; removed `RUX-12` because it asserted the removed Judge lane picker. Their baseline/count metadata was updated accordingly.
- Left enhancement-related settings data and unrelated Memory, Gateway, Cron, provider, and CLI coverage in place.

## Clarifications Needed

The deleted spec is not listed in an index or registry found by the scoped search. Seven out-of-scope comments still name it and cause raw acceptance `rg` output:

- `libs/frontend/webview-e2e-harness/src/lib/scenarios/boot/boot-progress.e2e.spec.ts:17`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/vscode-shell/vscode-host.ts:9`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/vscode-shell/config-menu-absent.e2e.spec.ts:9`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts:11,88`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace-routes.e2e.spec.ts:7`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/lock-popover-stacking.e2e.spec.ts:17`
