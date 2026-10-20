# Batch 2C — shell and ticker

## Files changed

- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`: removed the dock row, ticker, and dock trigger; gave the viewport the freed height; wired board notice, dismissal, and actual hero/footer anchors to the shared popover. The popover host is absolutely positioned outside viewport layout and has no cap-state host attributes. Kept the deferred needs-you chip and placeholder in viewport flow. Kept the populated-board keyboard handler and final create-cap check.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`: replaced dock/ticker expectations with absence, viewport, deferred chip, and popover host tests; completed persistence mock.
- `libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts`: updated board stub to the 2B event and notice contract; covered anchors, focus return after cancel and failed create, notice priority/dismissal/reentry/source refresh/workspace change, cap feedback, and keyboard behavior.
- `libs/frontend/chat-ui/src/index.ts`: removed ticker export.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/activity-ticker.e2e.spec.ts`: corrected stale dock/component comments only.
- Deleted `libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.ts` and `activity-ticker.component.spec.ts`.

## Dock parity and preservation

| Former dock capability | Result |
| --- | --- |
| New Session trigger and name popover | Board hero and rail footer emit their actual buttons; shell opens one named popover from that anchor. Name/default, Cancel/Escape/backdrop closure, focus return, and final running/tile cap recheck remain. Board/rail own focusable aria-disabled reason and title. |
| Running/tile bound feedback | `headerMessage` becomes the board's dismissible `cap` notice (`role=status` is owned by 2B). |
| Layout write failure | Exact existing text becomes a dismissible `write-failure` board notice (`role=alert` in 2B). Highest priority. |
| Newer-version read-only layout | Exact existing text becomes a dismissible `read-only` board notice (`role=alert` in 2B). Second priority. |
| Notice lifecycle | Dismissal masks only the current source key; source changes, workspace changes, and surface reentry advance that key. |
| Reserved dock height | Removed; session viewport fills the canvas and remains the measured element. |
| Back-office ticker and Thoth click | User-approved removal. Ticker component/spec/export and canvas injection removed. `BackOfficeActivityService` remains. Thoth remains available from its page. |
| Needs-you chip and permissions | Temporarily mounted in normal viewport flow with `@defer (on idle)` and placeholder. Queue files untouched pending phase 3 and TASK_2026_593. |
| Previous sessions and populated-board keyboard | Existing rail control and shell `onRailKeydown` retained. |

## Verification

- Confirmed project names in the three `project.json` files. Nx reported “Running target typecheck for 2 projects” and “Running target lint for 3 projects”.
- Typecheck canvas + chat-ui: passed 2/2.
- Canvas tests: passed 22 suites, 416 tests. After the final rail test addition, targeted rail spec passed 18/18.
- Chat-ui tests: 78 suites passed, 1 failed; 1449 tests passed, 3 failed in `setup-status.store.spec.ts` (“offers safe failure and retry”). That file is outside 2C ownership; it was not edited.
- Lint canvas + chat-ui + webview-e2e-harness: passed 3/3.
- No-alpha-base-content Jest spec: passed 11/11.
- Degradation audit: 294 unsuppressed sites, down from the stated 295 baseline; no new site in 2C files.
- Scoped `ptah_get_diagnostics`: no diagnostics in requested 2C files. Six sibling diagnostics remain in `core/src/testing/mock-rpc-service.ts` and `shared/src/lib/types/capability-id-codec.ts`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Position this shared popover's host absolutely in the shell to keep the initially unpositioned panel out of layout flow. | Edit `floating-ui.service.ts`; position the 2C host. | N2 requires no session-area shift, but the scope explicitly forbids editing files outside 2C. A positioned ancestor containing the panel prevents flow displacement; the component spec checks the host location. | Yes. |
| Use source-change revision keys for notice dismissal reset. | One permanent dismissed kind; revision per source change. | 2B notice contract has `key`, and the plan requires a dismissal to reset on source refresh, workspace change, or board entry. | Yes. |
| Keep the needs-you chip above the board in viewport flow. | Dock carryover; flow row in viewport. | 2C explicitly requires the temporary chip in `session-viewport`, clear of hero and notice. | Yes. |

## Remaining limits

`floating-ui.service.ts` remains unchanged because it is outside this batch's ownership. The shell's positioned host addresses the 2C popover's layout shift; any broader service-level change needs its owning batch. The unrelated chat-ui test failures and sibling diagnostics are reported for their owners. No 2B-owned files were changed.

