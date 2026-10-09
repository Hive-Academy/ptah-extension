# Review notes fixes report

## 1. Provider-specific token labels

**Still present:** Yes. The lane summary rendered `in` and a cache fallback even when the respective usage field was absent.

**Fix:** Each input, output, cache-read and cache-write label now renders only when its specific field is reported. The generic `cache not reported` label was removed.

**Files/spec:** `cli-lane-usage-summary.component.ts`; its component spec now asserts absent fields render no input or cache labels.

## 2. Ptah CLI token and cost scope

**Still present:** Yes. `PtahCliStreamLoop.turnUsage` used main-loop-only `result.usage` with pipeline-wide `total_cost_usd`.

**Fix:** It now totals SDK `modelUsage` (the same pipeline scope as `total_cost_usd`) and emits the delta from the prior cumulative snapshot so the UI's incremental fold remains correct. Results from older SDKs without `modelUsage` retain the former usage fallback.

**Files/spec:** `ptah-cli-stream-loop.service.ts`; its spec verifies cumulative multi-model usage produces the expected second-result token delta and cumulative cost.

## 3. Duplicated `cacheReported` logic

**Still present:** Yes. The store and component independently tested cache-read/write presence.

**Fix:** Added shared `hasReportedCliCacheTokens`, exported from `@ptah-extension/shared`, and used it in both call sites.

**Files/spec:** `cli-usage.utils.ts`, `utils/index.ts`, `agent-monitor.store.ts`, `cli-lane-usage-summary.component.ts`; shared utility spec covers absent and zero-valued reported fields.

## 4. Empty budget-handoff body

**Still present:** Yes. A handoff-stage budget with zero compactions and a failed/missing write produced only the pause sentence.

**Fix:** The banner now supplies the current used/limit budget sentence before the pause warning when no compaction or successful-handoff copy is available.

**Files/spec:** `session-budget-banner.component.ts`; banner spec covers zero compactions plus `writeError`.

## 5. Timers created outside `NgZone`

**Still present:** Yes. Recovery and advisory timeout callbacks could be scheduled by an outside-zone stream chunk, then mutate state outside Angular.

**Fix:** `CompactionLifecycleService` and `CompactionAdvisoryCorrelator` re-enter `NgZone` only in delayed callbacks (including stale-retry completion). The high-frequency stream dispatch remains outside the zone.

**Files/spec:** `compaction-lifecycle.service.ts`, `compaction-advisory-correlator.service.ts`; lifecycle spec asserts the safety timeout enters Angular before UI-state mutations.

## Checks

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/utils/cli-usage.utils.spec.ts --coverage=false --maxWorkers=2` — 18 passed.
- `npx jest -c libs/frontend/chat/jest.config.ts ...cli-lane-usage-summary... ...session-budget-banner... ...compaction-lifecycle... --coverage=false --maxWorkers=2` — 108 passed.
- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts --coverage=false --maxWorkers=2` — 22 passed.
- `npx nx typecheck @ptah-extension/shared --parallel=1`, `@ptah-extension/chat`, `@ptah-extension/chat-streaming`, and `@ptah-extension/cli-agent-runtime` — passed. Chat reports one pre-existing NG8107 warning in `peer-session-send-dialog.component.ts`.
- `npx nx lint` for each changed project — passed with existing warnings only (shared 5, chat 34, chat-streaming 2, cli-agent-runtime 45); no lint errors.
- Scoped editor diagnostics were unavailable because the TypeScript compiler did not finish its 45-second tool window; the project typechecks above passed.

## Decisions

- Model-usage snapshots are cumulative, so the stream loop emits deltas rather than re-emitting totals to avoid double counting in the existing incremental UI fold.
- Cache value `0` means the provider reported that field and remains visible; only `undefined` hides a label.
- Zone re-entry is deliberately confined to timeout callbacks to preserve the perf-batch stream-chunk optimization.
