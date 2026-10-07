Verdict: REVISE

# Code Logic Review — Round 2 — `TASK_2026_621_3d5c`

## Prior blocking findings

| Finding | Status | Evidence |
| --- | --- | --- |
| Boot scan converted `failed` to `ran`, advancing the watermark and silently losing the session. | **NOT RESOLVED** | The under-seven-day case now correctly stops below the failed item (`libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.ts:208-221`), but a failed item with `mtime` at least seven days old is still explicitly advanced past at `:223-230`. `memory-trigger.service.ts:1059-1065` passes the curator's `failed` outcome through, so this is a reachable non-network extract/resolve failure rather than a dead branch. |
| Migration 0039 deletes unprocessed `observation_queue` rows. | **RESOLVED** | The migration SQL now contains only the skill-synthesis delete (`libs/backend/persistence-sqlite/src/lib/migrations/0039_reap_orphaned_queue_rows.ts:96-105`); the upgrade-path test seeds a 60-day unprocessed observation and asserts all observation ids survive (`0039_reap_orphaned_queue_rows.spec.ts:345-383`). Applied migrations are version-keyed, so changing the unapplied migration protects upgrades that have not yet recorded version 39. |

## New findings

1. **Major — file age is used as a retry expiry, so an older session can still be silently discarded after its first failed pass.**
   - File: `libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.ts:208-230`
   - Scenario: a persisted watermark makes an 8-day-old session eligible (for example, the prior boot stopped before it). Its extract/resolve call returns `failed`. Because `now - item.mtime >= COLD_START_LOOKBACK_MS`, the runner logs a warning, advances `maxMtime`, and writes a watermark beyond it; later boots exclude it via `mtime > watermark` (`boot-scan-runner.ts:149-152,250-260`).
   - Impact: the failed session receives zero retry attempts despite the failed-pass safety goal. More generally, the expiry measures mutable session-file mtime, not the time or count of failures, so it cannot implement the required bounded-per-session retry policy. The current “bound” test proves this intentional pass-through rather than protecting against it (`memory-trigger.boot-scan-budget.spec.ts:470-494`).
   - Required change: retain per-session boot-scan failure state (failure count and first/last failure time) independently of file mtime; hold/retry through the defined bound, then record an explicit terminal disposition and surface it before advancing the global watermark. If product policy genuinely permits discarding historical failed scans, document and explicitly approve that exception to the failed-outcome contract.

2. **Moderate — the activity feed hides the new failure count, so the intentional head-of-line delay is not visible in its diagnostics surface.**
   - File: `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.ts:115-121`
   - Scenario: a failed session younger than seven days stops the sorted scan and prevents every later healthy session from being scanned until a later boot (`boot-scan-runner.ts:163-169,208-221`). The backend emits `failed` after `scanned`, `succeeded`, `skipped`, and `stalled` (`memory-trigger.service.ts:1071-1077`), but the UI serializes only the first three stats entries.
   - Impact: the event is rendered as an informational boot scan showing only `scanned`, `succeeded`, and `skipped`; neither `failed` nor `stalled` is displayed. The backend warning is useful to log readers, but the user-facing activity feed does not reveal why later healthy sessions are delayed for up to the chosen age window.
   - Required change: render boot-scan `failed`/`stalled` explicitly and at warning severity, including an “stopped early” indication; add a UI/event-mapping test. Prefer a per-session retry design from finding 1 so healthy sessions do not remain behind a global watermark barrier.

## Review conclusions

- The change correctly prevents the immediate original loss for a failed session younger than seven days, and the new tests are real controls: removing the `failed` stop makes the no-watermark assertion fail (`memory-trigger.boot-scan-budget.spec.ts:409-432`); restoring migration 0039's observation delete makes its old-unprocessed-row assertion fail.
- `now` is injectable in `BootScanRunnerOptions` and is used for the age comparison (`boot-scan-runner.ts:53-58,116-117,210`), so the boundary is testable. It is not, however, a reliable failure timestamp: it is compared to filesystem `stat.mtimeMs` (`boot-scan-runner.ts:144-152`), which describes file modification rather than failure history.
- No typed `BootScanResult` consumer was missed in the backend: the only production runner call is the memory trigger, which maps `result.failed` into the generic activity stats (`memory-trigger.service.ts:972-1077`). The RPC event shape accepts generic stat records (`libs/backend/memory-curator/src/lib/diagnostics.types.ts:23-32`), so no consumer type break was found. The UI omission above is a visibility failure, not a type/runtime break.

## Check results

- Scoped TypeScript diagnostics: unavailable after 45 seconds; the tool left its check running. The requested Nx typecheck completed successfully below.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/memory-curator @ptah-extension/persistence-sqlite --parallel=1`: **passed** (6/6 targets; 2 cache hits). Nx Cloud emitted an unrelated disabled-organization 401 after successful targets.
- `npx prettier --check` on the six round-two changed files: **passed**.
