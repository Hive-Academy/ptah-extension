# Summary

Added an injected Codex adapter factory. Without a host binding, the detector constructs the legacy `CodexCliAdapter`. A selected factory supplies the sole Codex adapter for detection, capabilities, model listing, and `runSdk`; native failures are not retried through legacy. Native routing remains inactive until host wiring in 10d.

# Files changed

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10c-report.md
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-native-selection.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-rejection.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\di\tokens.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\di\register.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\index.ts

# Spec case list

- Absent and explicit null factory retain the legacy Codex adapter.
- Optional DI resolution uses legacy when the token is unregistered and native when a host binds it.
- A provided factory selects the native adapter for detection, models, capabilities, and `runSdk`.
- A selected native `runSdk` rejection surfaces unchanged. A factory construction error leaves peers available, reports Codex unavailable, and rejects Codex runs with the cause.
- Selected native `detect` and `listModels` rejections produce failed Codex detection or omitted Codex models without legacy fallback.
- Detection and model caches use the selected adapter and refresh together on invalidation.
- Non-Codex adapters retain their existing instances and calls.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `CodexAdapterFactory.create(): CliAdapter` as the host port and select once when the detector is constructed. | Eager native instance injection; per-call selection. | Existing detector owns one adapter map and both caches; one selection keeps all four paths on the same adapter. | Yes: 10d may bind or unbind the factory without changing callers. |
| Use `@inject(token, { isOptional: true })` with the constructor null default. | Register a null factory in the library. | The repository uses optional injection for unbound tokens; a child-container spec now resolves the detector without a factory binding. | Yes: hosts can bind the token in 10d. |
| Contain a factory construction failure in an unavailable Codex adapter. | Let the detector constructor throw. | The detector is shared by all CLI lanes; the unavailable adapter reports `installed: false`, empty models, and a run error naming the cause while peers remain usable. | Yes. |
| Export the native adapter and its runtime, profile, identity, binary, credential, and profile-input types from the package root. | Deep imports from hosts. | Host composition in 10d needs these constructor contracts through the public alias. | Yes. |

## Proposed Removals

None.

## Clarifications Needed

None.

## Host guard impact for 10d

The factory token is optional and unregistered in 10c, so existing hosts keep the legacy route. Each 10d host registration that supplies a native factory should update its own DI smoke or surface guard to assert the selected adapter and required ports. No `apps/*` files were changed in this batch.

## Not done

- Tests, typecheck, lint, builds, Nx and npm commands were not run, per the hard rules. The coordinator owns verification.
- Host factory bindings and native activation are reserved for 10d.
- No locally invocable matching skill was available; the skill search returned only a non-invocable registry listing.

## Revision 1

| Item | Fix and spec case | Files |
| --- | --- | --- |
| 1. TS2352 mocks | Both suites now use an `AuthSecretsService` prototype with `getProviderKey` defined as a Jest mock. The Cursor resolver case keeps its mock handle. | D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.spec.ts; D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-native-selection.spec.ts |
| 2. TS4111 access | `CODEX_API_KEY` and `OPENAI_API_KEY` reads use bracket access. The adjacent native adapter spec's key read, write, and cleanup also use bracket access. A read-only scan found no remaining environment dot access in the Codex adapter directory. | D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-rejection.ts; D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.spec.ts |
| 3. Factory failure | The detector logs the real error, captures it, installs an unavailable Codex adapter, and continues constructing peers. Spec checks failed detection, absent models, peer availability, and a run rejection naming the cause. | D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts; D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.spec.ts; D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts |
| 4. Optional injection | Added tsyringe's `isOptional: true` and removed the null registration. A child-container spec resolves an unregistered token to legacy and a bound token to native. | D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts; D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\di\register.ts; D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-native-selection.spec.ts |
| 5. Native rejections | Added selected-native `detect` rejection case (failed row and captured error) and `listModels` rejection case (Codex omitted, peer models retained); both assert no legacy construction. | D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-native-selection.spec.ts |

Verification remains with the coordinator under the hard rule; no test, lint, typecheck, build, Nx, or npm command was run in this revision.
