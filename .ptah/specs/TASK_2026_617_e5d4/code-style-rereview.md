# Code Style Re-review — `TASK_2026_617` Phase 1 (after revise round)

Base path `A` = `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/acp`. Reviewed `git diff HEAD` (8 files, uncommitted) plus the sibling adapters for comparison.

| Metric   | Value          |
| -------- | -------------- |
| Score    | 8.5/10 (was 7) |
| Verdict  | APPROVED       |
| Blocking | 0              |
| Serious  | 0              |
| Minor    | 2 (non-gating) |

## Resolution of the earlier findings

| ID                                                                            | Status   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 dead `alwaysApproveFlag`                                                   | RESOLVED | Field removed from `A/acp-vendor-profile.ts` (diff hunk at old :62-67); `grep alwaysApproveFlag` over the lib returns nothing, including the spec literal.                                                                                                                                                                                                                                                                                                    |
| S2 spawn contract has no env channel; `authenticate`/`set_model` undocumented | RESOLVED | `buildSpawn` now returns the new `AcpSpawnSpec { args, env? }` (`A/acp-vendor-profile.ts` ~:63-72), exported as a type from `A/index.ts:17`. Session handle forwards `spawnSpec.env` to the transport (`A/acp-session-handle.ts` ~:210-214). `AcpSpawnOptions.env` is now `Readonly<Record<string,string>>` and documented as merged by `spawnCli`. The header lists the unsupported `authenticate` and `session/set_model                                    | set_mode` (`A/acp-vendor-profile.ts:7-12`). |
| S3 fixture compiled into the lib                                              | RESOLVED | `tsconfig.lib.json` exclude adds `src/**/__fixtures__/**`. Specs reach the fake agent through ts-jest, which does not use the lib tsconfig.                                                                                                                                                                                                                                                                                                                   |
| S4 no injected Logger                                                         | RESOLVED | Optional `logger?: Logger` on `AcpSessionHandleConfig` and `AcpSpawnOptions`. Logging sits where detail was swallowed: ACP request failure with `readAcpErrorDetail`, resume attempts, turn failure, unexpected `done` catch via the shared `onUnexpectedTurnError`, process end, transport spawn and live-child errors. Messages carry `[AcpSessionHandle]` / `[AcpProcessTransport]` prefixes and a `{ vendor }` context, as in `codex-cli.adapter.ts:330`. |
| Minor: `isExtensionNotification` required                                     | RESOLVED | Optional, called as `profile.isExtensionNotification?.(method)`.                                                                                                                                                                                                                                                                                                                                                                                              |
| Minor: Grok examples in docs                                                  | RESOLVED | `-32003` and `_x.ai/*` examples replaced with neutral ones.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Minor: mutable arrays                                                         | RESOLVED | `buildMcpServers` returns `readonly McpServer[]`; `sessionConfig` returns `readonly AcpSessionConfigEntry[]`. The copies `[...mcpServers]` at the SDK call sites are needed because the SDK types are mutable, and are minimal.                                                                                                                                                                                                                               |
| Minor: barrel                                                                 | RESOLVED | `AcpSpawnSpec` added with `export type`; internals stay unexported.                                                                                                                                                                                                                                                                                                                                                                                           |

## Logic fixes: style and boundary check

- **Live-child error keeps pid and tree-kill.** The `onChildError` split (`A/acp-process-transport.ts` ~:254-290) is readable and each branch is commented. Listener detachment is split into `detachStreamListeners` (removed at start failure or close) and `detachLifecycleListeners` (removed on close only). The reason is documented at the declaration and avoids an unhandled `error` crash. The naming reads in the domain's terms. No boundary change.
- **Readable closes 500 ms after exit.** `EXIT_DRAIN_GRACE_MS` is a named, exported constant with its rationale. The timer is cleared in `onChildClose` via `clearDrainTimer`, so it has a release path. It is one-shot and per transport, which is fine for the runtime-cost rule.
- **1.5 s cancel grace.** `ACP_CANCEL_GRACE_MS` is a named constant. `stopAfterCancelGrace` races `transport.exited`, `promptSettled` and a timer. `finally { clearTimeout(timer) }` releases it. The `runPrompt` / `runPromptTurn` split records `promptSettled` in one place. The function declaration `onUnexpectedTurnError` is hoisted below its first use (`const done = ...` follows it, but `continue` references it earlier). That works and is commented, so it is only a minor readability nit (M1).

No `console`, `any`, `@ts-` or suppression was added. The SDK boundary is unchanged: the loader remains the only value-import point.

## Judgment: type-only `Logger` import from `@ptah-extension/vscode-core`

Acceptable here. Use `import type { Logger } from '@ptah-extension/vscode-core'` as written. Reasons, concretely:

1. There is no platform-core alternative. `grep` over `libs/backend/platform-core/src` finds no `Logger` or `ILogger` port. Choosing "a platform-core type" would mean inventing a new port in another library for this task, which is scope creep and violates the simplicity rule for a single consumer.
2. It mirrors the exact precedent in the same directory tree: `codex-cli.adapter.ts:21,330` and `cursor-cli.adapter.ts:21,208`. Both are type-only, both are optional constructor/config injections, and the adapter at the wiring site (Batch 9) already holds the same `Logger`. A different type would make `Logger` instances non-assignable or force an adapter shim.
3. A type-only import is erased at compile time. It adds no runtime dependency edge from the ACP layer to vscode-core and cannot pull `vscode` into a platform-agnostic bundle. The "never add new vscode-core imports" guidance is about value coupling. I found no rule text in the repo's CLAUDE.md files or the Nx tags that forbids it, and `cli-agent-runtime` already imports vscode-core in the router, buffer and process-manager services.
4. Keep it optional and never construct a logger inside the layer, as done. That keeps every ACP unit testable without vscode-core.

Follow-up, not a gate: when a platform-core logging port is introduced, move all three adapters (codex, cursor, ACP) together in one change. Do not diverge ACP alone.

## Minor remaining (non-gating)

- M1: `onUnexpectedTurnError` is a hoisted function declaration among `const` arrows (`A/acp-session-handle.ts` near the end). Define it as a `const` above `continue` for consistency. No behaviour cost.
- M2: `A/acp-process-transport.ts:~101` and the session handle both log `command`/`error` text. Confirm in Batch 9 that argv or env values are never added to log context, since `env` now flows through this layer and could carry API keys. Current logs include only `command`, `pid`, `error.message`, which is safe.

## Pattern compliance

| Rule                                                 | Status | Evidence                                                             |
| ---------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| Injected optional Logger, no `console`               | PASS   | `acp-session-handle.ts` config; `codex-cli.adapter.ts:330`           |
| `import type` for vscode-core                        | PASS   | `acp-process-transport.ts:29`, `acp-session-handle.ts:28`            |
| No dead or Grok-shaped fields on the neutral profile | PASS   | grep clean                                                           |
| Test helpers outside the library build               | PASS   | `tsconfig.lib.json` exclude                                          |
| Timers and listeners have release paths              | PASS   | `clearDrainTimer`, `clearTimeout(timer)` in `finally`, detach arrays |
| Barrel exports types with `export type`              | PASS   | `A/index.ts:17`                                                      |
| SDK runtime import only in the loader                | PASS   | unchanged                                                            |

## Maintenance debt

- Introduced: two named timing constants, an `AcpSpawnSpec` type, optional logger plumbing.
- Retired: `alwaysApproveFlag`, the compiled fake agent, the silent `.catch(() => 1)` swallows.
- Net: positive. The profile is now neutral enough to take a second vendor without an interface break, apart from the documented `authenticate`/`set_model` gap.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none gating. Keep M2 in mind when Batch 9 wires lane env.
- What a 10/10 would do: a `const`-ordered `onUnexpectedTurnError`, and a shared platform-core log port used by all three ACP/codex/cursor adapters (a repo-wide change, out of scope for this task).
