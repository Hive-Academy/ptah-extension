# Display panel follow-ups report

## Completed

- Responsive display containers: container-mode card, section, and accordion bodies now establish their own `dp` inline-size container and use 8rem auto-fit tracks for stat and avatar children. Other body children keep a full row. Nested grids consequently resolve their existing `@container dp` rules from the nearest card body. Viewport mode remains on its existing flex/grid path. Implementation: `surface-layout.component.ts:63-69, 139-145, 166-171, 193-197`. Coverage: `surface-layout.component.spec.ts` verifies the container-only structure and CSS contract.
- Accessibility landmarks: code-output labels include their per-instance block number (`code-output.component.ts:201-205`); the turn summary detail region receives a different meaningful name (`turn-summary-chip.component.ts:179, 342-345`). Coverage updated in each component spec.
- Closed chat tabs release display state: added `DisplayDockState.forgetTab` (`display-dock.state.ts:136-140`) and call it before `TabManagerService.closeTab` (`tab-bar.component.ts:318`). Coverage in `display-dock.state.spec.ts` and `tab-bar.component.spec.ts`.
- Avatar acceptance-title correction: R4.8/R4.7 labels corrected to R4.5 in `dashboard-avatar.component.spec.ts:16,30`.
- R1.10: added the unit assertion that `setSummaries` leaves the dock closed in `display-dock.state.spec.ts`.
- Collapsed transcript headers: preview text removes single inline-code delimiters without changing fenced code, and one-count badges use singular file/tool labels. Implementation: `message-summary.utils.ts:68`, `message-bubble.component.html:65,70`; coverage added in `message-summary.utils.spec.ts`.

## Verification

- `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.spec.ts libs/frontend/declarative-dashboard/src/lib/components/dashboard-avatar.component.spec.ts --coverage=false --maxWorkers=2` — 2 suites, 26 tests passed.
- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.spec.ts libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts --coverage=false --maxWorkers=2` — 2 suites, 72 tests passed.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/utils/message-summary.utils.spec.ts libs/frontend/chat/src/lib/components/organisms/tab-bar.component.spec.ts libs/frontend/chat/src/lib/services/display-dock/display-dock.state.spec.ts --coverage=false --maxWorkers=2` — 3 suites, 60 tests passed.
- `npx nx typecheck @ptah-extension/declarative-dashboard --parallel=1` — passed.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1` — passed. Nx reported its disabled-cloud warning after the successful local target.
- Scoped TypeScript diagnostics for all changed source files — no diagnostics in requested files. The tool also surfaced existing errors in unrelated sibling specs in `chat` and `chat-ui`.

## Not completed

- R2.10 needs an integration assertion spanning message copy and code-block copy with a real display fence; it is not covered by the focused unit surfaces changed here.
- R9.6 is a rendered-width/wrapping behavior that jsdom cannot measure; it remains a visual/e2e concern.
- NFR Security requires the transcript/display-fence integration path to assert that literal chip-looking agent markup cannot instantiate a surface; it is outside the focused unit components changed here.
- Items 3, 4, 6, 7, 8, and 9 from `TASK_2026_630_2250` were explicitly skipped as directed. The turn-summary collapsed-by-default behavior was not changed.

## Changed files

- `.ptah/specs/TASK_2026_623_3492/followups-report.md`
- `.ptah/specs/TASK_2026_630_2250/context.md`
- `libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.ts`
- `libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.spec.ts`
- `libs/frontend/declarative-dashboard/src/lib/components/dashboard-avatar.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.spec.ts`
- `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts`
- `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html`
- `libs/frontend/chat/src/lib/utils/message-summary.utils.ts`
- `libs/frontend/chat/src/lib/utils/message-summary.utils.spec.ts`
