# Batch 8i-2b: probe type fixes

Modified `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/scripts/codex-start-probe.ts` only, plus this required report.

- `scripts/codex-start-probe.ts:123`: added an explicit process handle adapter, typed as the return type of `IProcessSpawner.spawnProcess`. It supplies stdin/stdout/stderr, whenSpawned, required pid/killed/exitCode getters, and kill/on/once/off delegating to the child, without casts.
- `scripts/codex-start-probe.ts:145`: the refused child uses the adapter at line 150, preserving deferred error/close events and a null whenSpawned result.
- `scripts/codex-start-probe.ts:160`: the spawned child uses the same adapter, preserving its spawn/error promise.
- `scripts/codex-start-probe.ts:216`: captured the runtime in `const openedRuntime`; line 223 retains the cleanup reference and line 224 opens via the const, removing the non-null assertion.

Everything else in the probe is unchanged. Existing changes in other files were left untouched; the config and runtime index were not modified.

No probe, Codex binary, typecheck, tests, build, or diagnostics command was run. Typecheck confirmation remains with the team leader.

Files written:
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/scripts/codex-start-probe.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8i-2b-report.md`
