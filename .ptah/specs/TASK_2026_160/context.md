# TASK_2026_160 — Integrate opencode & PI as CLI agent providers

**Type**: FEATURE (with RESEARCH spike)
**Workflow**: Partial
**Created**: 2026-07-17

## User Request

> Similar to cursor and codex, integrate **opencode** and **PI (pi.dev)** as CLI agent providers.
> Docs: https://pi.dev/docs/latest/sdk , https://opencode.ai/docs/sdk/

## Goal

Add two new `CliAdapter` implementations (`opencode`, `pi`) to
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/`, wired into
`CliDetectionService`, the shared `CliType` union, the barrel, and the
`agent-rpc.handlers.ts` surfaces in both the VS Code and Electron apps — matching
the parity of the existing Codex / Cursor / Antigravity adapters.

## Integration Surface (target contract)

`CliAdapter` (cli-adapter.interface.ts): `detect()`, `supportsSteer()`,
`parseOutput()`, `runSdk()` → `SdkHandle`, optional `listModels()`,
`ensureTokensFresh()`, `supportsMcp`.

Extension points that must change:

- `cli-adapters/<tool>.adapter.ts` (+ `.spec.ts`)
- `cli-adapters/index.ts` barrel
- `cli-detection.service.ts` (adapter map + startup log; possibly refreshCliTokens)
- `libs/shared/src/lib/types/agent-process.types.ts` — `CliType` union
- `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`
- `apps/ptah-extension-vscode/.../agent-rpc.handlers.ts`
- `apps/ptah-electron/.../agent-rpc.handlers.ts`

## Reference adapters

- SDK/JSONL event flavor: `codex-cli.adapter.ts`
- Spawn / plain-text-print flavor: `antigravity-cli.adapter.ts`, `cursor-cli.adapter.ts`

## Open questions for research

1. opencode headless invocation — `opencode run`? server + `@opencode-ai/sdk`? JSON/JSONL event stream?
2. PI (pi.dev) headless invocation + SDK shape.
3. Session-ID recovery / resume flags for each.
4. MCP server config location + format for each.
5. Model listing command.
6. Auth model (OAuth token refresh vs API key).

## Status

- [x] Research (opencode) — spawn `opencode run --format json`
- [x] Research (PI) — spawn `pi --mode json` (Earendil `@earendil-works/pi-coding-agent`)
- [x] Checkpoint / plan approval — user: "ship both, document limits"
- [x] Implement adapters + wiring (backend-developer)
- [x] Frontend model selectors for opencode + pi (frontend-developer)
- [x] Verify — cli-agent-runtime 386 tests pass; typecheck clean on all affected
      projects EXCEPT pre-existing `editor/monaco-loader.service.ts:79-80` error
      (unrelated, on-branch before this task).

## Notes for reviewer

The working tree also contains changes NOT part of this task that were
already-in-progress branch work (antigravity feature completion +
canvas-tile background-agent-tray session-scoping). See implementation-report.md.
Stage the opencode/pi commit deliberately if you want it isolated.
