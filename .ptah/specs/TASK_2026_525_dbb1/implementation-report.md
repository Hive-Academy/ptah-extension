# Implementation Report — TASK_2026_525_dbb1

## Changes

| File | What changed | Why | `file:line` |
|---|---|---|---|
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` | Removed unused `readFile` from `fs/promises`, `homedir` from `os`, and `{ join }` from `path` imports | Dead imports after removing obsolete `authPaths()` reading `auth.json` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:46-47` |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` | Added `probeCommandOnce` helper capturing stdout, exitCode, timedOut, and errored flags | Provides robust outcome detection distinguishing clean exit 0 with empty stdout from errors/timeouts | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:310-357` |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` | Updated `probeModels` with cold-daemon retry logic (retrying once on exit 0 + empty stdout; no retry on timeout/error/non-zero exit) | Defect 1: opencode 2.x background server starts on cold call and exits 0 with empty stdout; models appear on second invocation | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:359-399` |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` | Removed `authPaths()` and replaced `auth.json` reads in `ensureTokensFresh` with `probeAuthList` running `opencode auth list` | Defect 2: opencode 2.x stores credentials in SQLite DB instead of `auth.json`. Probing `auth list` confirms signed-in status (`OpenCode Default stored` vs `No authenticated integrations`) with env var fallback | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:401-447` |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts` | Added tests for cold-start retry, consecutive empty probes without looping, error/exitCode non-retry, and `ensureTokensFresh` credential detection | Verifies Defect 1 and Defect 2 fixes under all probe and auth conditions | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts:212-357` |
| `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts` | Added `await this.loadCliModels()` inside `redetectClis()` following successful detection | Defect 3: re-detecting CLIs invalidated backend cache but never refreshed frontend models, leaving stale empty arrays | `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:1071` |

## Tests

### Specs Added

In `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts`:
1. `retries once and returns parsed model list when a cold first probe exits 0 with empty stdout` — verifies cold first probe (exit 0, empty stdout) triggers a second probe that parses models.
2. `returns an empty list when two consecutive probes produce no output without looping` — verifies two consecutive empty probes resolve `[]` without looping.
3. `does not retry when the probe encounters a spawn error` — verifies spawn errors do not trigger retry.
4. `does not retry when the probe exits with a non-zero code` — verifies non-zero exit codes do not trigger retry.
5. `ensureTokensFresh() returns true when opencode auth list reports stored credentials` — verifies `OpenCode Default stored` reports fresh tokens.
6. `ensureTokensFresh() returns false when opencode auth list reports no authenticated integrations` — verifies `No authenticated integrations` reports false when no env keys are present.
7. `ensureTokensFresh() returns true when auth list reports no authenticated integrations but a provider env var is present` — verifies fallback env key check.
8. `ensureTokensFresh() returns false when auth list fails and no provider env var is present` — verifies failure resilience without env keys.

### Target Verifications and Verbatim Summary Lines

- `npx nx test @ptah-extension/cli-agent-runtime`
  ```
  Test Suites: 63 passed, 63 total
  Tests:       1 skipped, 1005 passed, 1006 total
  Snapshots:   0 total
  Time:        29.208 s, estimated 69 s
  Ran all test suites.
  NX   Successfully ran target test for project @ptah-extension/cli-agent-runtime
  ```

- `npx nx test @ptah-extension/chat`
  ```
  Test Suites: 86 passed, 86 total
  Tests:       2 skipped, 1344 passed, 1346 total
  Snapshots:   0 total
  Time:        29.943 s, estimated 51 s
  Ran all test suites.
  NX   Successfully ran target test for project @ptah-extension/chat
  ```

- `npx nx lint @ptah-extension/cli-agent-runtime`
  ```
  ✖ 42 problems (0 errors, 42 warnings)
  NX   Successfully ran target lint for project @ptah-extension/cli-agent-runtime
  ```

- `npx nx lint @ptah-extension/chat`
  ```
  ✖ 18 problems (0 errors, 18 warnings)
  NX   Successfully ran target lint for project @ptah-extension/chat
  ```

- `npx nx typecheck @ptah-extension/cli-agent-runtime`
  ```
  NX   Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime
  ```

- `npx nx typecheck @ptah-extension/chat`
  ```
  NX   Successfully ran target typecheck for project @ptah-extension/chat
  ```

## Not done

none
