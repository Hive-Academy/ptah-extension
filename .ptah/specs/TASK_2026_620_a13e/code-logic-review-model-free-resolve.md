# Code Logic Review: Model-Free Resolve

**Verdict:** REVISE (Score: 4/10)

## Defects

### 1. Replay applies network faults to model-free early returns
- **Severity:** Moderate
- **Location:** `tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.ts:198-201`
- **Description:** In replay mode, the double evaluates `this.faultFor(key)` *before* checking the model-free conditions (`drafts.length === 0` and `related.length === 0`). If a liveness suite configures a fault (e.g., `throw` or `timeout`) for a model-free resolve call, the double simulates a network/provider failure. This diverges from the product code, which would synchronously return `[]` without ever reaching the provider or network.
- **Fix:** Move the fault check block to execute *after* the `drafts.length === 0` and `related.length === 0` early returns in replay mode.

### 2. Failed `recording-rejection.json` write swallows the actual error and leaks staged cassettes
- **Severity:** High
- **Location:** `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:667, 703, 714`
- **Description:** If `writeRecordingRejection` throws an exception (e.g., `ENOSPC` disk full, or missing permissions), execution immediately jumps out or propagates the filesystem error. This bypasses the subsequent `discardStagedCassettes(paths)` call, leaving unaccepted recordings indefinitely on disk. Furthermore, the newly thrown filesystem error completely eclipses the original `RecordingRejectedError`, hiding the true cause of the rejection from the test runner.
- **Fix:** Wrap all calls to `writeRecordingRejection` in a `try...catch` block to suppress filesystem errors. This ensures the cleanup runs and the original `RecordingRejectedError` is correctly thrown.

### 3. Aggregate provenance counting allows an unprovenanced entry to steal a retry dispatch
- **Severity:** High
- **Location:** `tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:241-246` and `269-274`
- **Description:** The provenance gate validates dispatches globally via aggregate counts (`dispatchCount >= entryCount` and `matching >= entryCount`). If `skill-lane` records one entry that retries (producing 2 dispatches) and a second entry that makes no model call (an unprovenanced entry), we get `entryCount = 2` and `dispatchCount = 2`. The validation passes because the total counts align. Then, `writeProvenanceSidecar` blindly maps dispatches to entries by chronological index, permanently granting the unprovenanced second entry a success-looking sidecar record derived from the first entry's retry dispatch.
- **Fix:** The provenance tap must include the cassette key in the `ModelDispatchProvenance` event. `provenanceProblems` and `writeProvenanceSidecar` must then strictly match dispatches to entries by key, eliminating the aggregate counting flaw.

## Orchestrator disposition (2026-10-09)

- **Defect 1 — accepted (minor).** Faults are suite-configured and today target extract keys, but moving
  the fault check after the two model-free returns matches the product exactly and costs nothing. Fixed
  in the follow-up round.
- **Defect 2 — accepted.** Already noted by the orchestrator when committing 11e8afa1e. Fixed in the
  follow-up round (rejection write best-effort; discard and the original error always win).
- **Defect 3 — valid gate-design limitation, not a defect of 11e8afa1e; deferred.** The gate counts
  dispatches in aggregate, so a retry dispatch can cover an entry that made no call. The proposed fix
  (cassette key in the product's provenance event) is a product change. A bench-only alternative: the
  double snapshots the collector's dispatch count around each inner call and rejects an entry with zero
  dispatches. It only matters when recording, so it moves to the recordings follow-up task
  (`follow-up-recordings.md`) and must land before the b18 / scope-write / funnel recordings.

## Checked and OK

- **Double mirror accuracy:** The double's record mode correctly skips recording when `drafts.length === 0` or `related.length === 0`, exactly matching the product's model-free conditions (`recorded-curator-llm.ts:213-216` vs `sdk-internal-query.curator-llm.ts:367-370`).
- **Backward compatibility for cassettes:** Replaying cassettes recorded before this change does not cause a crash or mismatch. Old model-free entries in the cassette are safely bypassed by the early returns in replay mode (`recorded-curator-llm.ts:202-205`), returning `[]` without attempting a `store.lookup()`. The `callCounts` re-scan invariant remains unbroken.
- **Data leak prevention:** The redacted `recording-rejection.json` file does not leak prompt text, response text, or secret content. It strictly extracts only a 12-character prefix of the cryptographic key hash (`keyPrefix`), an operation literal (`'extract'`, `'resolve'`, or `'unknown'`), and a boolean flag (`memory-skills-host.ts:738-755`).
