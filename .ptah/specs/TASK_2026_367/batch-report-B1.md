# TASK_2026_367 — Batch B1 Report

**Batch**: B1 (C1 shared stderr classifier + C2 headless agent spawn model logging)  
**Project**: `@ptah-extension/cli-agent-runtime`  
**Date**: 2026-09-02

---

## 1. Files Created and Modified

### Created Files

- [`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.ts`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.ts)
  - Pure module defining `CliStderrSeverity = 'error' | 'info'` and `classifyCliStderr(line: string): CliStderrSeverity`.
  - Encapsulates private `STDERR_ERROR_REGEX = /\b(error|fail(ed)?|exception|denied|unauthorized|refused|timeout|abort|crash|panic|fatal)\b/i`.
  - Returns `'info'` for empty/whitespace lines and non-matching lines; returns `'error'` on matching error keywords.
- [`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.spec.ts`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.spec.ts)
  - Full unit test suite covering benign notices, error keywords, word boundaries, empty/whitespace strings, and case insensitivity.

### Modified Files

- [`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts)
  - Replaced inline regex with `classifyCliStderr(cleaned)`.
- [`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts)
  - Replaced inline regex with `classifyCliStderr(cleaned)`.
- [`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts)
  - Replaced inline regex with `classifyCliStderr(cleaned)`.
- [`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts)
  - Replaced inline regex with `classifyCliStderr(line)`.
- [`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts)
  - Introduced named callback `handleChildStderr(data: string)` in `spawnAgent` using `classifyCliStderr`: routes `'error'` to `this.logger.warn` and all other output to `this.logger.debug`. Never calls `this.logger.error`.
  - Wired `stderr: handleChildStderr` in the SDK query options.
  - Removed lines 813-815 recomputation of `effectiveTiers` / `providerModel`.
  - Updated spawn completion log to honest resolution: `with model ${model || '(unresolved)'} (tier: ${tier})`.
- [`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts)
  - Updated `SpawnHarness` to expose `logger` and `getCapturedOptions()`.
  - Added test suite for C1 stderr classification.
  - Added test suite for C2 headless agent spawn logging.

---

## 2. Spec Assertions Added

### `cli-stderr-severity.spec.ts`

1. Benign notices return `'info'`:
   - `[claude-code:unrecognized_model] {"model":"glm-5.2:cloud"}` -> `'info'`
   - `claude.ai connectors are disabled because ANTHROPIC_API_KEY is set` -> `'info'`
2. Error keyword lines return `'error'`:
   - `Error: ENOENT`, `fatal:...`, `panic:...`, `timeout`, `denied`, `refused`, `exception`, `unauthorized`, `crash`, `failed`, `fail`, `abort`
3. Word boundaries respected:
   - `process terminated` -> `'info'`
   - `disinformative content` -> `'info'`
   - `refusedness is not a word` -> `'info'`
4. Empty or whitespace lines return `'info'`: `''`, `'   '`, `'\t\n'`.
5. Case-insensitivity: `FATAL ERROR`, `TIMEOUT OCCURRED`, `DENIED` all return `'error'`.

### `ptah-cli-registry-spawn-model.spec.ts`

1. C1 — `stderr` callback routing:
   - Never calls `logger.error`.
   - Benign line (`[claude-code:unrecognized_model] {"model":"glm-5.2:cloud"}`) routes to `logger.debug`.
   - Matching error line (`Error: ENOENT no such file or directory`) routes to `logger.warn`.
   - Even on matching error line, `logger.error` is never called.
2. C2 — Headless agent spawn model logging:
   - Spawning with `{ modelTier: 'opus' }` against configuration with tiers `{ sonnet: 'kimi-k2.7-code:cloud', opus: 'glm-5.2:cloud' }`.
   - Asserts the "Spawned headless agent" info log message contains `glm-5.2:cloud` and `tier: opus`.
   - Asserts the log message does **not** contain `kimi-k2.7-code:cloud`.

---

## 3. Test and Lint Results

### Test Execution

```bash
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime
```

- **Test Suites**: 43 passed, 43 total
- **Tests**: 533 passed, 533 total
- **Snapshots**: 0 total
- **Time**: 25.975 s

### Lint Execution

```bash
npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime
```

- **Result**: 0 errors, 35 warnings (35 baseline warnings, 0 new warnings/errors).

---

## 4. Deviations from the Plan

None. `resolveEffectiveTiers` was retained in `ptah-cli-registry.ts` because it remains actively used by other methods (e.g. lines 408, 614, 1213) and is verified by `ptah-cli-registry-tiers.spec.ts`.

---

## 5. Anything Left Undone

None. All tasks for Batch B1 are complete and verified against the implementation plan.

DONE: B1 — shared stderr classifier and honest headless spawn model logging
