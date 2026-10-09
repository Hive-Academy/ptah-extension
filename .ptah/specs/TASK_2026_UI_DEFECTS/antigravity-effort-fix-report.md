# Antigravity effort fix report

## Root causes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:302-306` passed both `--model` and `--effort`. Current `agy` rejects that combination when the selected model already encodes effort.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.ts:203-215` mapped the unsupported spawn effort `minimal` to `low` for Antigravity, so the host sent `--effort low` even when the caller requested a value that `agy` does not accept.
- The stale `claude-sonnet-4-6` value is a persisted model setting/request value, not a current backend/shared static Antigravity default. The adapter previously passed it through at `antigravity-cli.adapter.ts:269-271`, although it is absent from the live catalogue.

## Fixes

- The adapter now omits `--effort` whenever a model is supplied.
- For known current base model families, it converts `base + effort` into the catalogue-style id (for example, `claude-sonnet-5-5` plus `high` becomes `claude-sonnet-5-5-high`). A model already ending in `-low`, `-medium`, `-high`, `-xhigh`, or `-max` stays unchanged.
- With no model, an allowlisted effort is still passed as `--effort`; the live help probe accepted this parser form.
- Unknown models are passed unchanged and never paired with `--effort`, avoiding a conflicting invocation.
- A saved `claude-sonnet-4-6` is migrated at the Antigravity boundary to the live `claude-sonnet-5-5-medium` model id.
- Antigravity no longer coerces `minimal` to `low`; the lane policy records it as ignored and supplies no effort.

## Final argv examples

- Suffixed selection: `agy --model claude-sonnet-5-5-low` (requested `high` is deliberately not sent separately).
- Base selection plus effort: `agy --model claude-sonnet-5-5-high`.
- No model plus effort: `agy --effort low`.
- Unsupported spawn effort: no `--effort` argument.
- Stale saved value: `agy --model claude-sonnet-5-5-medium`.

## Live proof

Read-only probes on 2026-10-08:

- `agy models` exited successfully and listed `gemini-3.8-flash-{low,medium,high}`, `gemini-3.1-pro-{low,high}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}`, and `gpt-oss-120b-medium`. It did not list `claude-sonnet-4-6`.
- `agy --effort low --help` exited successfully and displayed the normal CLI help, including `--effort` as `low|medium|high|xhigh|max`. This proves the no-model parser form is accepted without starting a task.

## Other adapters checked

- Grok uses ACP `session/set_config_option` entries (`grok/grok-acp-profile.ts:132-145`), and applies the effort only if the active session advertises that option. No model/argv conflict was found.
- Ptah CLI passes model and effort as SDK query options (`ptah-cli-registry.ts:806-815`), not a shared CLI argument pair. No model-dependent command conflict was proven.
- Codex supplies model to the SDK thread and reasoning effort to its lane configuration (`codex-cli.adapter.ts:477-521`); no comparable rejected `--model`/`--effort` argv combination exists.

## Files changed

- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\antigravity-cli.adapter.ts`
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\antigravity-cli.adapter.spec.ts`
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-spawn-policy.ts`
- `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-spawn-policy.spec.ts`
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_UI_DEFECTS\antigravity-effort-fix-report.md`

## Checks

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-spawn-policy.spec.ts --coverage=false --maxWorkers=2` was started once. The command runner returned before final stdout/exit status; the corresponding Jest process was subsequently no longer running, so a pass/fail result was not available to record.
- `npx nx typecheck cli-agent-runtime --parallel=1` was started once. The Nx process subsequently exited, but the command runner returned before final stdout/exit status; its result is therefore not asserted as passing.
- Targeted TypeScript diagnostics were requested after editing. The diagnostics service did not complete within its 45-second service limit and reported all four changed files as unchecked.

## Decisions

- Used a current, explicit catalogue-derived base-family allowlist so only known valid suffixed ids are generated. This avoids manufacturing invalid combinations such as a non-existent `gpt-oss-120b-high`.
- Kept `--effort` only for the no-model form because the live help probe accepts it; model selection always owns the effort otherwise.
- Preserved persisted user configuration by migrating only the known removed historical default at the adapter boundary, rather than adding a second settings-default path or changing unrelated Claude provider catalogue entries.
