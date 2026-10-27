# Batch C - Metrics and copy

Implementation is written; required verification is PENDING behind the shared machine lock. This is not a verified-pass handoff. Stopping at the requested tool budget, leaving verification running.

## Files changed

- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts`: Shared missing-field copy and formatting-only compact metrics adapter; unavailable detail text.
- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.spec.ts`: New absent/zero/partial/estimated/full-accessible-value/time tests.
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts`: Removed Agents tile; muted accessible missing values; removed context helper repetition.
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.spec.ts`: Added missing-field accessibility and redundant-copy assertions.
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts`: Avoid empty provenance header when unresolved plan captions are blank.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts`: Central lane copy, missing usage dashes, suppressed unknown-limit face chip, non-synthetic subtotal.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts`: Central unresolved-plan copy; account explanation moved into detail lines.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.ts`: One unavailable usage explanation; muted, field-labeled missing run values; plain unknown limit detail.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.spec.ts`: Updated old missing-value assertions.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-subtotal-tile.component.ts`: Known subtotal label and muted accessible absent tokens.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts`: Unresolved plan status can disclose account detail; no empty reset separator.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts`: Added unresolved-plan disclosure test.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.spec.ts`: Updated existing adjacent lane/plan model copy assertions and subtotal markers.
- `libs/frontend/chat-ui/src/lib/molecules/agent-lane-stats/agent-lane-stats.component.ts`: Unknown cost is a muted dash; field-specific accessible names retained with partial markers.
- `libs/frontend/chat-ui/src/lib/molecules/agent-lane-stats/agent-lane-stats.component.spec.ts`: Updated missing cost tests for null and undefined.
- `libs/frontend/chat-ui/src/index.ts`: Exports compactSessionMetrics and CompactSessionMetric for Batch B.

## Compact metrics API for Batch B

Import `compactSessionMetrics`, `CompactSessionMetric`, and the existing `SessionStatsInputs` from `@ptah-extension/chat-ui`.

```ts
compactSessionMetrics(stats: SessionStatsInputs): readonly CompactSessionMetric[]
interface CompactSessionMetric {
  readonly id: 'context' | 'tokens' | 'cost' | 'time';
  readonly label: 'Ctx' | 'Tokens' | 'Cost' | 'Time';
  readonly value: string;
  readonly ariaLabel: string;
  readonly unavailable: boolean;
}
```

Order: context, tokens, cost, then time when known. Render `value`; use `ariaLabel` for the accessible name and focus/hover full-value text, and `unavailable` for muted ink. The adapter projects existing SessionStatsInputs/context/snapshot values through existing formatters and helpers. It does not sum model rows or lane usage. Partial tokens and known cost subtotal retain lower-bound markers; provisional token/cost values retain estimate markers. Accessible labels contain full counts, dollar values, and milliseconds. Missing time is omitted. Measured zero tokens/cost remain numeric values.

## Verification

Command launched from the worktree root: `npm run verify -- -p @ptah-extension/chat-ui`.

Result: PENDING, not pass or fail. No final suite/test pass/fail counts are available. Process session ID: `51779`; full output: `C:\Users\abdal\AppData\Local\Temp\ptah-batch-c-verify.log`. The first wait message reported queue position 6 behind PID 28164 in the claude-named-accounts worktree. The process has not been cancelled. Do not launch a duplicate verification; collect its completion/output.

Last captured output:

```text

> @ptah-extension/source@0.0.0 verify

> node scripts/verify.mjs -p @ptah-extension/chat-ui



[verify 2026-10-26T12:09:57.600Z] waiting on pid 28164 [verify lint,test,typecheck (@ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/core,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview)] in D:\projects\ptah-extension\.claude-worktrees\claude-named-accounts since 2026-10-26T12:04:46.803Z (queue position 6)

[verify 2026-10-26T12:10:58.199Z] waiting on pid 28164 [verify lint,test,typecheck (@ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/core,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview)] in D:\projects\ptah-extension\.claude-worktrees\claude-named-accounts since 2026-10-26T12:04:46.803Z (queue position 6)

[verify 2026-10-26T12:11:58.843Z] waiting on pid 28164 [verify lint,test,typecheck (@ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/core,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview)] in D:\projects\ptah-extension\.claude-worktrees\claude-named-accounts since 2026-10-26T12:04:46.803Z (queue position 6)

[verify 2026-10-26T12:12:59.836Z] waiting on pid 28164 [verify lint,test,typecheck (@ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/core,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview)] in D:\projects\ptah-extension\.claude-worktrees\claude-named-accounts since 2026-10-26T12:04:46.803Z (queue position 6)


```

Scoped `ptah_get_diagnostics` after edits: zero diagnostics in requested changed source files and the new compact metrics spec. Thirteen unrelated sibling errors remain: streaming-quotes spec (afterTick), compact-session activity/metrics fixtures, core mock-rpc-service mock casts, and shared BigInt compiler target diagnostics. No unrelated fixes were attempted. This check does not replace Angular template compilation or the required verification command.

## Decisions

- API shape: use an ordered typed metric array rather than new component/store state. Evidence: both inspector and rail consume existing SessionStatsInputs; the batch asks for a small view. Reversible.
- Unresolved plan account details: enable disclosure specifically for the unavailable plan status rather than leave details only in a title. Evidence: spec requires Account not resolved in expanded detail; existing status cards otherwise have no disclosure. Reversible.
- Keep unknown limit state and diagnostic reasons while suppressing its face chip; retain last-known evidence chips and warning chips. Evidence: spec forbids reinterpreting missing limits as healthy. Reversible.
- Updated stats-limit-view-model.spec.ts as the existing adjacent model test for lane-tiles/plan-limit-tiles; no shared fixture edits. Evidence: spec explicitly requests updating existing lane/plan unit specs together. Reversible.
- Keep measured zero pricing and token contributions; determine absence from contribution count, not the sum. Evidence: empty-state table distinguishes unknown from measured zero. Reversible.

## Not done / remaining

- Mandatory verification has not completed; pass/fail counts and compilation across dependents are not established. The coordinator must collect the running result and address any failures before accepting this batch.
- No screenshots (separate Electron visual review), builds, e2e, git operations, or unrelated source changes.

## Absolute paths written

- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-view.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-view.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\inspector-session-stats.component.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\inspector-session-stats.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\inspector-stats\inspector-limits-lanes.component.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-tiles.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tiles.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-usage-tile.component.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-usage-tile.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-subtotal-tile.component.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-limit-view-model.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\agent-lane-stats\agent-lane-stats.component.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\lib\molecules\agent-lane-stats\agent-lane-stats.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\libs\frontend\chat-ui\src\index.ts
- D:\projects\ptah-extension\.claude-worktrees\chat-layout-declutter\.ptah\specs\chat-layout-declutter\batch-C-report.md
