# CLI reasoning-effort report

| CLI                             | Supported                  | Mechanism and values                                                                                                                                                          | Evidence                                                                                                    | Change                                                                                        |
| ------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Codex                           | Yes                        | SDK/config: low, medium, high, xhigh; Ptah maps minimal→low and max→xhigh                                                                                                     | Existing `CLI_REASONING_EFFORT_VALUES`                                                                      | Existing path                                                                                 |
| Grok                            | Yes                        | ACP `session/set_config_option` `reasoning_effort`: low, medium, high, xhigh                                                                                                  | Local `grok 1.0.46 --help`: `--reasoning-effort <EFFORT>`; [Grok CLI](https://docs.x.ai/docs/grok-code/cli) | `agent-spawn-environment.service.ts:112`, `grok-acp-profile.ts:141`, `cli-matrix-rows.ts:195` |
| Antigravity                     | Yes                        | `agy --effort`: low, medium, high, xhigh, max                                                                                                                                 | Local `agy 1.3.0 --help`: `--effort ... (low                                                                | medium                                                                                        | high  | xhigh                                                                                                                 | max)`; [CLI reference](https://antigravity.google/docs/cli/reference) | `lane-spawn-policy.ts:202`, `antigravity-cli.adapter.ts:99`, `cli-matrix-rows.ts:177` |
| Copilot                         | Yes                        | `--effort` / `--reasoning-effort`: none, minimal, low, medium, high, xhigh, max                                                                                               | Local `copilot 1.0.83 --help` lists values                                                                  | Existing path                                                                                 |
| Pi                              | Yes                        | `--thinking`: off, minimal, low, medium, high, xhigh, max                                                                                                                     | Adapter contract and [Pi RPC docs](https://pi.dev/docs/latest/rpc)                                          | Existing `pi-cli.adapter.ts:359`                                                              |
| OpenCode                        | Version-dependent          | Current local `opencode 2.0.12 run --help` has no variant/effort argument. Current docs describe model variants (`provider/model#variant`) and `--variant` in later CLI docs. | [OpenCode CLI](https://opencode.ai/docs/cli/), [models](https://opencode.ai/v2/docs/models)                 | Left `n/a` for installed version; no safe spawn flag to emit.                                 |
| Cursor                          | No verified CLI control    | Cursor is not installed locally; no supported effort parameter verified from this adapter's SDK path.                                                                         | Local agent inventory: not installed                                                                        | Remains `n/a`.                                                                                |
| Ptah CLI (Anthropic-compatible) | SDK supports it; not wired | Claude Agent SDK declares `effort?: low                                                                                                                                       | medium                                                                                                      | high                                                                                          | xhigh | max`in installed`sdk.d.ts`. Per-instance persistence/RPC and matrix instance editor are not implemented in this pass. | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:89-91`          | Not done.                                                                             |

## Files changed

- Shared RPC effort properties: `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`
- Resolution and Antigravity argv: `libs/backend/cli-agent-runtime/src/lib/cli-agents/`
- RPC validation/persistence: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
- Settings matrix effort capability: `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts`
- Regression tests: Antigravity adapter and matrix-row specs.

## Verification

`npx nx run-many -t typecheck,lint,test -p @ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers,@ptah-extension/chat,@ptah-extension/shared,@ptah-extension/agent-sdk --parallel=2` was started and remained running without output at handoff. Diagnostics were unavailable because the TypeScript checker was still running.

## Decisions

- Grok and Antigravity now use the same selectable matrix UX as Codex.
- Antigravity now preserves its documented `xhigh` and `max` values rather than clamping to `high`.
- OpenCode remains unavailable for effort selection on the locally installed CLI because its help does not expose the current-docs variant flag.

## Not done

- Ptah CLI instance effort needs its own persisted config field, `ptahCli:update` contract, SDK `query()` option, and instance-row popover path.
- Cursor has no verified effort control.
