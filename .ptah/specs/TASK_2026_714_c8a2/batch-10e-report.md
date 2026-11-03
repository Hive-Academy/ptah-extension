# Batch 10e — Removal B source

## Files changed

Worktree-relative paths below. No package metadata, main-chat code, MCP wiring, or native 10c/10d lane implementation was changed.

| File | Change |
| --- | --- |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts` | Removed legacy import and construction; absent factory now logs an `Error` and installs `unavailableCodexAdapter`. Updated constructor comment. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts` | Removed `CodexCliAdapter` export. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts` | Uses a typed factory double for Codex and asserts logged unavailable behavior without a factory. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-native-selection.spec.ts` | Replaced legacy fallback assertions with unavailable and native factory selection assertions. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts` | Supplies a native factory double to keep the seven-lane roster while exercising Claude account binding. |
| `apps/ptah-electron/src/di/container.smoke.spec.ts` | Packaged/gate-closed case now asserts the unavailable Codex slot. |
| `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts` | Production/gate-closed case now asserts the unavailable Codex slot and drops legacy import. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-config-rejection.ts` | Kept the native-used user-server and essential-entry filters; removed SDK exit parsing and stderr excerpt helpers. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-config-rejection.spec.ts` | Kept assertions for native-used filters; removed SDK-only parser and excerpt assertions. |
| `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts` | Comment points to native freshness check. |
| `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts` | Comment describes independent native auth validation. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts` | Updated auth-home comment. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts` | Removed obsolete SDK comparison and updated auth-home comment. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` | Comments point to its own native binary resolver. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts` | Updated auth-home comment. |
| `libs/backend/lane-routing/src/lib/matrix/seed-matrix.ts` | Comment points to native fallback model list. |
| `libs/shared/src/lib/utils/codex-token-freshness.ts` | Comment points to native freshness check. |
| `.ptah/specs/TASK_2026_714_c8a2/batch-10e-report.md` | This inventory and handoff. |

## Deleted files

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.tokens.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-exec-args.ts` (sole caller was the deleted adapter)

## Moved helpers

None required. Native code already uses `FileCodexLaneCredentialProbe` and shared `isCodexAccessTokenStale` for freshness; `NativeCodexLaneBinaryProbe` and host pin inspection for binary resolution; `CODEX_LANE_FALLBACK_MODELS` for fallback models; and host selected-home resolvers for auth paths. The exported event-formatting functions from the deleted adapter had no remaining caller. Native rejection code still imports `codexRejectionNamesUserServer` and `essentialCodexConfigEntries`, so their helper and spec remain.

## Legacy-spec-to-native coverage mapping

| Legacy assertion / behavior | Native or retained coverage | Disposition |
| --- | --- | --- |
| `codex-cli.adapter.tokens.spec.ts`: JWT expiry, API key, opaque-token age, missing/unreadable auth | `codex-app-server-lane-auth.spec.ts:21-58`; shared `isCodexAccessTokenStale` used by `codex-app-server-lane-auth.ts` and auth provider; adapter spec `:867` | Covered; native reads selected home without refresh. |
| Legacy `getAuthPath` / `CODEX_HOME` ordering and no default-home fallback | Native auth spec `:21-58`; adapter spec `:202`; host home resolvers in Electron, CLI and VS Code compositions | Covered in source/spec; live selected-home behavior remains PENDING-LIVE in parity proof. |
| Legacy binary layouts, packaged path, version, explicit path | `codex-app-server-lane-binary.spec.ts:25-101`; `codex-app-server-lane.adapter.spec.ts:849-881`; host pin inspection | Native pin-based resolution supersedes legacy SDK path override; live host pin remains PENDING-LIVE. |
| Legacy static model fallback, catalog cache, model advice | `codex-app-server-lane-models.ts` fallback list; adapter spec `:896-1020`; `codex-model-catalog.spec.ts` and native model rejection tests | Covered; live catalog/model rejection remains PENDING-LIVE. |
| Legacy effort whitelist and continuation effort | `codex-app-server-lane-rejection.ts` validates `low/medium/high/xhigh`; adapter spec `:587-599,695`; native profile and config specs | Covered; resumed effort remains PENDING-LIVE. |
| Legacy config rejection, one essential retry, user-server exception, second rejection | Native adapter spec `:612-790`; retained `codex-config-rejection.spec.ts` essential-entry and user-server assertions | Covered for typed App Server errors; SDK stderr-envelope assertions were legacy only. Live retry remains PENDING-LIVE. |
| Legacy output/event shapes, buffering, continuation, abort, role and MCP | `codex-lane-events.spec.ts`, `codex-app-server-lane.adapter.spec.ts:213-563`, `codex-lane-parity.spec.ts`, `codex-lane-activation.spec.ts`; preserve rows 22-67 in `p10-lane-parity-proof.md` | Native implementation retained; corresponding live observations remain as marked in signed proof. |

## Host factory registrations

| Host | Composition call / registration | Result |
| --- | --- | --- |
| Electron | `apps/ptah-electron/src/di/phase-2-libraries.ts:304`; `codex-lane-composition.ts:237` | Conditional: packaged builds require `CodexParityGate` at `:236`. **Blocker when gate is closed.** |
| ptah-cli | `libs/backend/cli-engine/src/lib/container.ts:769`; `codex-lane-runtime-composition.ts:278` | Registers native factory. |
| ptah-tui | `apps/ptah-tui/src/main.tsx:126` calls `withEngine`; shared CLI root `libs/backend/cli-engine/src/lib/container.ts:769` / `codex-lane-runtime-composition.ts:278` | Registers through shared CLI engine; no separate TUI DI root. |
| VS Code | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:263`; `codex-lane-runtime-composition.ts:247` | Conditional: production returns at `:97` unless `CodexParityGate` admits lane. **Blocker when gate is closed.** |

All four host paths call a native factory composition, but Electron packaged and VS Code production do not always bind the token. Per task scope, no composition was added or gate changed.

## Negative grep proof

Equivalent of requested `grep -rn "@openai/codex-sdk" W/libs/backend/cli-agent-runtime/src`: PowerShell `Get-ChildItem ... -Recurse -File | Select-String -SimpleMatch '@openai/codex-sdk'` returned **NO MATCHES** (all source files, including specs). `rg.exe` failed with Access is denied, so PowerShell was used. A scan of `apps` and `libs` TypeScript found no production references to `CodexCliAdapter`, `codex-cli.adapter` or `codex-exec-args`; one unrelated stale comment remains in `libs/shared/src/testing/fake-async-generator.ts:5`, outside the permitted file scope. `git diff --check` returned no whitespace errors. Required test/typecheck/lint/diagnostics commands were not run by instruction.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Missing factory yields logged unavailable Codex adapter | Legacy SDK fallback; unavailable adapter | Native-only objective and existing `unavailableCodexAdapter` path | Yes, by a later authorized composition change. |
| Keep native-used rejection helper and assertions | Delete all; keep all; trim SDK-only branches | `codex-app-server-lane-rejection.ts` imports two filters; SDK parser/excerpt had no native caller | Yes. |
| Delete exec argv helper without moving it | Keep dead helper; delete | Only deleted legacy adapter imported `codexExecArgs` | Yes. |
| Leave gated host registration untouched | Change gates; report condition | Task explicitly forbids adding composition and reopening native lane files | Yes, in a follow-up. |
| Leave dependency metadata for 10f | Remove now; defer | `plan-p10.md:117-121` assigns package metadata to 10f | Yes. |

## Proposed Removals

No additional parity removal proposed. SDK dynamic import, `codex exec` argument building, SDK stderr-envelope parsing, and legacy SDK event mapping were removed with their lane; native App Server equivalents remain. The unbound production factory cases above are an availability blocker for native-only release until the coordinator resolves the rollout gates.

## Clarifications Needed

Coordinator decision required before merging native-only removal: should Electron packaged and VS Code production register the native factory unconditionally, or is Codex intentionally unavailable while their parity gates are closed? This lane did not change either composition root. No clarification is needed to review the scoped edits. Skill discovery was available; the local catalog listed `impeccable` and `typesafe-ai`, neither matching this source removal, so no skill was invoked.

## LF/CR verification

PowerShell byte scan equivalent to `tr -cd '\r' < file | wc -c`: every written file has **0 CR bytes**. The scan covered each file individually:

| Written file | CR bytes |
| --- | ---: |
| `apps/ptah-electron/src/di/container.smoke.spec.ts` | 0 |
| `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts` | 0 |
| `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts` | 0 |
| `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-config-rejection.spec.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-config-rejection.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-native-selection.spec.ts` | 0 |
| `libs/backend/lane-routing/src/lib/matrix/seed-matrix.ts` | 0 |
| `libs/shared/src/lib/utils/codex-token-freshness.ts` | 0 |
| `.ptah/specs/TASK_2026_714_c8a2/batch-10e-report.md` | 0 |
