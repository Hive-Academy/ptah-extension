# Batch 10b.0b revise 1

## Fixes

- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:701`: The chat/lane isolation case now builds the lane branch from `laneProfile` and retains `contextId: 'other'`. Its original process and turn isolation assertions remain.
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1359`: The async-card lane case now opens `laneProfile`, so thread configuration passes before its presentation assertions. A scan of the other codex-runtime specs found no additional runtime opens with a lane consumer lacking lane settings; the other bare lane profiles are execution-profile fixtures.
- `libs/backend/codex-runtime/src/lib/codex-runtime.ts:33`: The pre-turn classifier now recognizes the legacy safe diagnostic forms for invalid overrides, unknown config keys or fields, and failed config/TOML parsing or deserialization. It remains limited to lane thread start/resume failures with stderr evidence.
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:2214`: Added RPC rejection cases for each newly recognized form. `codex-runtime.spec.ts:2235` covers a process close during thread/start with failed TOML deserialization. `codex-runtime.spec.ts:2253` keeps a model rejection text generic.

## Not done

- The lane profile bridge in batch 10b.0c and cli-agent-runtime were left untouched as directed.
- Tests, lint, typecheck, diagnostics, builds, and other verification commands were not run under the lane rules. Skill discovery found no invocable local runtime skill; targeted source reads used PowerShell because `rg` was blocked in this shell.
