# S4a fix: curator watermark (M2)

Files (libs/backend/memory-curator/src/lib):
- memory-curator.service.ts: `start()` (~250-292) now stamps via new `stampPreCompact()` in a `.then` only when the pass returned `outcome === 'ran'`; a thrown, stalled or deferred pass leaves the watermark unset so the next PreCompact retries. `coalescePreCompact()` (~315) is read-only and returns false for `trigger === 'manual'`.
- memory-curator.service.spec.ts (PreCompact coalescing describe): harness exposes `extract` and `fire(sessionId, trigger)`; two specs added.

Trigger: the hook payload already carries `data.trigger: 'manual' | 'auto'`, used as is. A successful manual pass also stamps the watermark, so an auto compact right after is coalesced.

Specs added:
1. failed (stalled) pass does not stamp; next PreCompact runs (read x2, no skip log).
2. manual compaction within the interval after an auto one is not skipped.

Checks:
- `nx run-many -t typecheck,lint -p memory-curator`: pass.
- `nx run memory-curator:test --maxWorkers=2`: 47 suites, 866 tests, all pass.
- `nx run degradation-audit:lint`: reports pre-existing catch-return-sentinel findings in other files. None are in lines I added (memory-curator.service.ts:926 is pre-existing code).

Notes: the window runner absorbs a thrown extract, so "failure" in practice surfaces as a stalled/deferred outcome. A provider-unreachable stall also opens the separate network back-off (C14 f), which defers the next background pass. A pass that finishes after `forgetSession` re-adds one small watermark entry (negligible).
