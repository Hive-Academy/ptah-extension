# Code Style Review — `TASK_2026_617` (Phase 1, Batches 1-4)

Base path `A` = `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/acp`.

## Summary

| Metric          | Value                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------- |
| Overall score   | 7/10                                                                                          |
| Assessment      | NEEDS_REVISION                                                                                |
| Blocking issues | 0                                                                                             |
| Serious issues  | 4                                                                                             |
| Minor issues    | 4                                                                                             |
| Files reviewed  | 12 source/config files read in full or by targeted section; specs and ndjson fixtures sampled |

Scope examined: `acp-vendor-profile.ts`, `index.ts`, `acp-sdk-loader.ts` (whole); `acp-session-handle.ts` (lines 1-215, 585-636 plus grep over the rest); transport, mapper, policy headers/exports/imports; `fake-acp-agent.ts` header; the app manifests, `jest.config.ts`, `tsconfig.spec.json`, `tsconfig.lib.json`. Not re-read line by line: spec bodies, the middle of the session handle. Grep sweeps over the non-spec ACP sources found no `console.`, no `any`, no `@ts-`, no `eslint-disable`.

## Five style questions

### 1. What breaks in six months?

The profile cannot carry the next vendor without a runner change. Opencode and codex-acp commonly need per-lane environment (opencode's inline config, API keys the lane should not inherit). `buildSpawn` returns argv only and `AcpSpawnOptions` has no env (`A/acp-vendor-profile.ts:69-73`; Batch 4 deviation 1 admits it). The runner calls only `initialize`, `new/resume/load` and `set_config_option` (`A/acp-sdk-loader.ts:55-70`). It has no `authenticate` and no `session/set_model`/`set_mode`. Agents that advertise `authMethods`, or that select models through `models.availableModels`, hit a wall in the shared runner, not in a profile. The "new vendor = new profile only" promise (`A/acp-vendor-profile.ts:2-3`) holds for Grok-like agents only.

### 2. What would a new team member misread?

`alwaysApproveFlag` (`A/acp-vendor-profile.ts:67`). Its comment says the runner answers prompts through the policy either way and "a profile reads this in `buildSpawn`". But `buildSpawn` receives only `CliCommandOptions`, and nothing in the runner reads the field (grep: only the declaration and a spec literal at `acp-session-handle.spec.ts:65`). It reads as a runner switch but is a no-op. It is also a required field, so every future profile must set it for nothing.

### 3. What does this cost to maintain?

Six runtime modules plus a profile is a reasonable split by responsibility. The cost is that the runner owns all diagnostics by emitting segments only. There is no logger, so the full rejection payload and the transport's failure detail never reach the log (see Serious 2). `acp-session-handle.ts` is 636 lines holding handshake, resume ladder, config application, prompt loop and failure reporting. It is cohesive but is the one file likely to attract vendor branches.

### 4. Where is this inconsistent with the rest of the repository?

- Siblings take an optional injected `Logger` (`codex-cli.adapter.ts:21,330`, with `[CodexCliAdapter]`-prefixed `warn/info/error`). The ACP layer has none.
- Test data under siblings is non-TS data only (`codex/__fixtures__/*.txt|jsonl`). The ACP layer places a compiled TypeScript helper in `src` (Serious 3).
- Naming and layout otherwise match: kebab file names, `acp-` prefix, co-located specs, barrel with `export type`.

### 5. What would you have done differently?

Make the profile minimal and honest: drop `alwaysApproveFlag`, let `buildSpawn` return `{ args, env? }` (or add `buildEnv?`), make `isExtensionNotification` optional, and move `fake-acp-agent.ts` out of the library compile. Each change is cheap now, while there is one profile and no consumer. Each becomes a breaking change once three vendors depend on it.

## Blocking issues

None. No stated invariant is broken: no `vscode-core` value import, the SDK runtime is reachable only through the loader, and no `any` or suppression was found.

## Serious issues

### S1. `AcpVendorProfile` has a dead, Grok-shaped field

- File: `A/acp-vendor-profile.ts:62-67`
- Problem: `alwaysApproveFlag: boolean` is a Grok CLI concept (a flag that disables prompts). The runner never reads it, and the doc admits a profile consumes it only inside `buildSpawn`, which cannot see it. Some vendors have no such flag.
- Tradeoff: A required interface member with no consumer is exactly the speculative surface the simplicity rule forbids. It forces every later vendor to invent a value.
- Recommendation: Delete it. If Grok needs the flag, it is a constant inside the Grok `buildSpawn`. Update `acp-session-handle.spec.ts:65`.

### S2. Spawn contract cannot express per-vendor environment (extension-point gap)

- File: `A/acp-vendor-profile.ts:69-73`, `A/acp-process-transport.ts` (`AcpSpawnOptions`), `A/acp-session-handle.ts:196-201`
- Problem: The child always inherits `process.env`. That is acceptable for Grok (`XAI_API_KEY`) but not neutral. Sibling adapters that already exist (opencode, copilot) pass lane-specific env. The shape is fixed to Grok's needs and recorded only as a Batch 9 reminder.
- Tradeoff: Adding `env?` now touches one interface and one forwarding line. After opencode or copilot lands it is a breaking change to every profile and every transport spec.
- Recommendation: Change `buildSpawn` to return `{ args: readonly string[]; env?: Readonly<Record<string, string>> }`, or add an optional `buildEnv(options)`. Forward it through `AcpSpawnOptions` to `spawnCli`. The same reasoning covers `authenticate`: at least document in the profile or plan that auth-method negotiation is unsupported, so later vendors do not discover it at integration time.

### S3. Test helper is compiled into the library build

- File: `A/__fixtures__/fake-acp-agent.ts:1-9`; `libs/backend/cli-agent-runtime/tsconfig.lib.json` (exclude lists only `*.spec.ts`/`*.test.ts`); `tsconfig.spec.json` include (specs and `.d.ts` only)
- Problem: The header admits "compiled by the library build". The 347-line fake agent therefore ships as `.js` plus `.d.ts` in the published output. It is kept out of the barrel (`A/index.ts` does not export it), but it is still in `dist`. Codex's `__fixtures__` are data files only.
- Tradeoff: Excluding the folder costs one `exclude` line. Shipping a fake peer in a published runtime lib is dead weight and a leak of test surface.
- Recommendation: Add `"src/**/__fixtures__/**/*.ts"` to the `exclude` in `tsconfig.lib.json`. Specs still import it through ts-jest, which does not use the lib tsconfig. Check that `typecheck` of the spec project picks it up (it is reached through spec imports). Keep the SDK boundary spec walking it.

### S4. No injected `Logger`; failure detail is lost to logs

- File: `A/acp-session-handle.ts:54-80` (`AcpSessionHandleConfig`), whole ACP layer (grep for `logger`: no match)
- Problem: Codex and cursor adapters inject an optional `Logger` and log the full SDK rejection while showing users a summary (`codex-cli.adapter.ts:327-330, 649, 762`). The ACP runner turns every error into a user segment via `emitError` and collapses the rest through `.catch(() => 1)` (`acp-session-handle.ts:~213, ~365`). Raw JSON-RPC error data, transport exit codes and ignored extension methods never reach a log.
- Tradeoff: The adapter that wires the runner (Batch 9) is the one place that has a logger. An optional `logger?: Logger` on the config, typed with `import type` from vscode-core as codex does, costs one field and keeps the layer free of `console`.
- Recommendation: Add `readonly logger?: Logger` to `AcpSessionHandleConfig` and log at the places that currently swallow detail: the handshake failure, setup failure, non-zero exit, and unknown extension methods.

## Minor issues

- `A/acp-vendor-profile.ts:85` `isExtensionNotification` is required. A vendor with no extensions must write a stub returning false. Make it optional like the other hooks.
- `A/acp-vendor-profile.ts:60,84,98` doc examples name Grok (`_x.ai/*`, `-32003`). Harmless in comments, but `A/acp-permission-policy.ts:70` also cites Grok option ids. Keep vendor examples to one "for example" note.
- `A/acp-vendor-profile.ts:79,85` `sessionMeta` returns `Record<string, unknown>` and `sessionConfig` returns a mutable array while sibling hooks return `readonly` arrays (`buildSpawn`). Use `readonly AcpSessionConfigEntry[]` and `readonly McpServer[]` for consistency.
- `A/index.ts`: the barrel does not export the mapper or permission policy. That is fine (they are internal), but `AcpSessionUpdateMapper` types are used by no outside consumer, so none are needed. Confirm in Batch 9 that no adapter reaches into `./acp/acp-*.ts` directly.

## File-by-file

### acp-vendor-profile.ts

Score 6/10 — 0 blocking, 2 serious (S1, S2), 2 minor. Types are precise and the resume strategy, config entry and failure shape are genuinely vendor-neutral. The spawn contract and the dead flag are the weak spots.

### acp-sdk-loader.ts

Score 9/10 — 0/0/0. A model module: the only SDK runtime import (`:128`), a narrow `AcpConnectionApi` that decouples the layer from SDK classes, failure not cached, explicit return types, message cap with a reason. The SDK boundary is pinned by spec.

### acp-session-handle.ts

Score 7/10 — 0/1/0. Depends on abstractions (`IProcessSpawner`, `AcpTransportFactory`), uses `import type` throughout, no `console`. Missing logger (S4). Size is the future risk.

### acp-process-transport.ts, acp-session-update-mapper.ts, acp-permission-policy.ts

Score 8/10 — 0/0/0 each. Imports are boundary-clean (`platform-core`, `shared`, local utils only). Policy treats agent input as untrusted and selects by option kind. Transport documents its lifecycle rules and reuses `killProcessTree`.

### index.ts

Score 8/10 — 0/0/1. Types use `export type`; no SDK value re-exported; the fixture is not exported.

### **fixtures**/fake-acp-agent.ts

Score 6/10 — 0/1/0. Well written and SDK-free, but compiled into the library (S3).

### Config (package.json x3, project.json x3, jest.config.ts, tsconfig.spec.json)

Score 9/10 — 0/0/0. `1.7.0` is identical in the lib manifest, Electron and CLI (`apps/ptah-electron/package.json`, `apps/ptah-cli/package.json`, `libs/backend/cli-agent-runtime/package.json`). The `external` entry sits beside the codex precedent in all three bundle configs. The TUI declares no dependency, matching its codex precedent. `transformIgnorePatterns` and `allowJs` follow the `tool-output-reducers` pattern.

## Pattern compliance

| Repository rule or nearby convention                            | Status                                  | Evidence                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| No `vscode-core` runtime import in the layer                    | PASS                                    | import lists in `acp-*.ts`; none from vscode-core                                                                                             |
| `import type` for SDK types; only loader imports runtime values | PASS                                    | `A/acp-sdk-loader.ts:128`; `acp-session-update-mapper.ts:1`; `acp-permission-policy.ts:1-4`; boundary spec                                    |
| Barrel uses `export type` for types                             | PASS                                    | `A/index.ts:11-37`                                                                                                                            |
| Injected Logger, no `console`                                   | FAIL (no console, but no Logger either) | grep: no `logger`; compare `codex-cli.adapter.ts:330`                                                                                         |
| No `any`, explicit return types on public APIs                  | PASS                                    | grep clean; `createAcpSessionHandle(): SdkHandle`, `connectAcp(): Promise<AcpConnectionApi>`                                                  |
| Nx tag lattice (`scope:extension`, `type:feature`)              | PASS                                    | `libs/backend/cli-agent-runtime/project.json:6`; new imports are only `platform-core`, `shared` and local files, all already used by siblings |
| Naming and file layout match siblings                           | PASS                                    | kebab `acp-*.ts`, co-located `*.spec.ts`                                                                                                      |
| Test helpers stay out of the build                              | FAIL                                    | `__fixtures__/fake-acp-agent.ts`; `tsconfig.lib.json` exclude                                                                                 |
| SDK dependency declared at one version                          | PASS                                    | `1.7.0` in all three manifests                                                                                                                |
| Vendor-neutral extension point                                  | PARTIAL                                 | S1, S2                                                                                                                                        |

## Maintenance debt

- Introduced: a six-module ACP layer, one profile interface, a 347-line test peer, one new external runtime dependency in three hosts.
- Retired: nothing yet; Batch 9 should show the first adapter using it, and later vendors replace per-vendor transport code.
- Net: positive direction, provided S1 and S2 are fixed before the profile gains a second consumer.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on S1, S3 and S4 (direct file evidence); MEDIUM on S2 (depends on which vendors follow).
- Key concern: The profile is nearly vendor-neutral but carries a dead Grok-shaped flag and no env channel, and the fake agent ships in the library build. Fix both now, while the interface has one consumer.
- What a 10/10 version would do differently: delete `alwaysApproveFlag`; return `{ args, env? }` from `buildSpawn`; make `isExtensionNotification` optional; add an optional `Logger` to `AcpSessionHandleConfig`; exclude `__fixtures__` from `tsconfig.lib.json`; return `readonly` arrays from profile hooks; document the lack of `authenticate`/`set_model` support in the profile header.
