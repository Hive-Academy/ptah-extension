# Revision 1 report

## Defects addressed

1. **Error ordering and incomplete input:** `ptah-cli-stream-loop.service.ts:266-281,638` retains invalid JSON fragments in bounded `toolInput.__unparsed`, skips pending calls with no known input, and flushes pending calls before error output. Tests: `retains invalid partial JSON as distinguishable bounded input`, `flushes a partial call before a stream error`, `skips an unstopped call with no known input` (`ptah-cli-stream-loop.service.spec.ts:378-420`). The existing `degradation-audit: optional-capability` catch comment format is preserved.
2. **Result pairing:** `ptah-cli-stream-loop.service.ts:558,567` includes `block.tool_use_id` as `toolCallId` on both result segment types. Test: `tags successful and failed tool results with the call id` (`ptah-cli-stream-loop.service.spec.ts:456`).
3. **Turn boundaries:** The stream error and two-turn behavior are covered. Test: `clears emitted ids between turns while suppressing each turn assistant echo` (`ptah-cli-stream-loop.service.spec.ts:435`). It checks that a repeated ID emits in turn 2 and that neither assistant echo duplicates its turn's call.
4. **Reused block index:** `ptah-cli-stream-loop.service.ts:455` emits any pending call before replacing the entry. Test: `emits both calls when a second start reuses a pending index` (`ptah-cli-stream-loop.service.spec.ts:421`).

## Verification

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.spec.ts --coverage=false --maxWorkers=2` — **PASS: 8 suites, 116 tests** (`JEST_EXIT=0`). PowerShell used `Select-Object -Last 30` because `tail` is unavailable.
- `npx nx typecheck cli-agent-runtime --parallel=1` — **PASS: Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime** (`TYPECHECK_EXIT=0`). Nx Cloud also reported its disabled-organization notice.
- Scoped `ptah_get_diagnostics` — **PASS: 0 errors, 0 warnings**.

## Decisions

- A pending call with no fragments and empty start input is omitted because it has no distinguishable input. Valid start input is retained when no fragments arrived. Invalid fragments are retained up to 500 characters. This is reversible in the stream loop.

## Not done

- No other source files were changed in this revision.
