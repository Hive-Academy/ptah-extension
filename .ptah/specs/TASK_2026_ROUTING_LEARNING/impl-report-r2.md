# Implementation report — R2

Status: done for the three assigned items. One production read is waiting on lane R1. Electron’s RPC-surface spec was not executed, because that test target builds the app.

`angular-frontend-patterns` was loaded before the settings components. Ptah symbol search had an empty index earlier in this lane; file lookup used ripgrep after that. `ptah_get_diagnostics` returned unavailable (the compiler was still running after 45s). Nx typecheck is the check that completed.

## Item 1 — settings key and Electron toggle

`agentOrchestration.laneRotation` is a file-backed boolean, default `true`. A write is a routing-configuration change, so `routingConfigurationGeneration` increments.

Files:

- `libs/backend/platform-core/src/file-settings-keys.ts` — key and default `true`
- `libs/backend/platform-core/src/file-settings-manager.ts` — `ROUTING_KEYS`
- `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` — `KNOWN_CONFIG_KEYS`
- `libs/frontend/chat/src/lib/settings/ptah-ai/lane-rotation-setting.component.ts` — Electron toggle, `settings:get` / `settings:set`, read-back, `SettingsSaveFeedbackService.saveGeneric`. Missing value reads as on.
- `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts` — mounted under `@if (isElectron)`, after host routing
- specs: `file-settings-keys.spec.ts`, `file-settings-manager.spec.ts`, `settings-export.types.spec.ts`, `lane-rotation-setting.component.spec.ts`, `orchestration-settings.component.spec.ts`

Not in this lane: the spread/route-decide reader, and `routing:getRotation`. `RotationStore` is not on the `@ptah-extension/lane-routing` public index.

## Item 7 — capability matrix RPC and Electron table

`agent:getCapabilityMatrix` takes no parameters. The handler resolves `LANE_ROUTING_TOKENS.CAPABILITY_MATRIX_STORE` per call and calls `readMergedView()` only when that method is present. The result is Zod-parsed. Unknown cells stay `{ kind: 'unknown' }`. A missing store, a missing method, a throw, or a schema mismatch is `RpcUserError` `PERSISTENCE_UNAVAILABLE` with message `Capability matrix is unavailable.` The handler does not return an empty profile list.

The method is on the shared manifest with `requires: []`, registered in `registerSharedRpcHandlers`, and allowed because `agent:` is already in `ALLOWED_METHOD_PREFIXES`. Electron’s `rpc-surface.spec.ts` asserts the name is served. It was not added to `EXPECTED_RESOLVABLE` (outcome handlers are not on that list either). `container.smoke.spec.ts` and `surface-composition.spec.ts` were left as they are. The VS Code app is not in this worktree. `cli-engine` `container.ts` already calls `registerSharedRpcHandlers`, so it was not edited. Its log line still says 19 handler classes; that count was already stale.

The Electron table is `capability-matrix-setting.component.ts`, mounted under `isElectron`, calling `ClaudeRpcService`. Unknown cells render as `unrated`.

Files:

- `libs/shared/src/lib/types/rpc/rpc-capability-matrix.types.ts`
- `libs/shared/src/lib/types/rpc.types.ts` — registry and allow-map
- `libs/backend/rpc-handlers/src/lib/handlers/capability-matrix-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/capability-matrix-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/index.ts`
- `libs/backend/rpc-handlers/src/index.ts`
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
- `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
- `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.spec.ts` — mock class so the barrel mock still loads
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`
- `libs/frontend/chat/src/lib/settings/ptah-ai/capability-matrix-setting.component.ts`
- specs: `capability-matrix-rpc.handlers.spec.ts` (6), `capability-matrix-setting.component.spec.ts`, orchestration mount spec

Until R1 adds `readMergedView`, a live call fails closed. The handler spec uses a fake reader.

## Item 8 — Enhance server guards

Manual preview and apply both enforce the 5-use floor (`MIN_INVOCATIONS_TO_ENHANCE`), the 24-hour cooldown (`ENHANCE_COOLDOWN_MS`), and a scored verdict (`status === 'scored'`, score not null, score at least `minJudgeScore`, still 6 via `MANUAL_PREVIEW_JUDGE_SETTINGS`). `unscored` and `disabled` are `judge-rejected` and are not cached. A thrown registry or stats read is `error` and does not generate. `applyProposal` peeks the proposal, repeats the floor, cooldown, and score check, and returns `{ applied: false, skipReason }` without deleting the cache and without writing. `enhance()` treats `applied: false` as not changed.

`skillSynthesis:previewEnhancement` still passes `manual: true`. The comment no longer says that bypasses the gates. The preview RPC already returns `skipReason`.

Files:

- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`
- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.spec.ts` — 32 passed, including the new floor, cooldown, unscored, disabled, score-6, apply-cooldown, unscored-cache, and stats-throw cases
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` — comment only
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts` — `it.each` for `below-threshold`, `cooldown`, `judge-rejected`

The Enhance drawer still saves through `saveCloneBody` after a preview that already passed these gates. A direct `saveCloneBody` of a body that was returned earlier is not checked again. That method was not in the assigned fix.

## Needs from R1

Export, on the DI instance registered as `LANE_ROUTING_TOKENS.CAPABILITY_MATRIX_STORE`, a method:

`readMergedView(): Promise<{ profiles: Array<{ family: string; model: string; cells: Record<OutcomeTaskKind, Cell> }> }>`

Merge order is the one the view document already uses (user, then local, then seed). A value cell is `{ kind: 'value', score, source: 'seed' | 'user' | 'local', sourceRef: string | null, asOf: string, stale: boolean, sampleCount: number | null, note?: string }`. An unknown cell is `{ kind: 'unknown' }`, not score 50. With no installed lanes, return the seed view: one `z-ai` / `glm-5` profile, `implement` value score 80 source `seed`, and the other five kinds `unknown`. Do not make the handler read `capability-matrix.view.json`. `load().resolve()` is the wrong shape because it substitutes the neutral score.

`RotationStore` entries are also not on the public index. This lane did not add `routing:getRotation`.

## Decisions

- Item 1 is the setting and the Electron toggle only. The last-pick RPC waits on `RotationStore`. Reversible.
- A missing matrix reader is `PERSISTENCE_UNAVAILABLE`, not an empty table. Reused the existing error code. Reversible.
- `agent:getCapabilityMatrix` stays on the `agent:` prefix. The manifest entry has `requires: []`, so Electron and the CLI both serve it. Reversible.
- Item 8 gates live in `SkillEnhancerService`. Apply repeats them before the write and does not consume the proposal on refusal. The score bar on apply is `MANUAL_PREVIEW_JUDGE_SETTINGS.minJudgeScore` (6). A null `judgeScore` is `judge-rejected`. Reversible.
- `saveCloneBody` was not gated. The assigned methods are preview and `applyProposal`.

## Not done

- `routing:getRotation` and any change under `libs/backend/lane-routing/**`.
- Live matrix data, until R1 adds `readMergedView`.
- `apps/ptah-electron` test. `ptah-electron:test` depends on `build-main` and the worker builds. Typecheck of `ptah-electron` passed. `rpc-surface.spec.ts` was not executed.
- VS Code DI specs. `apps/ptah-extension-vscode` is not in this worktree.
- `scenario-sanitizer` allow-list. Replay of the new method stays stripped until that list gains `agent:getCapabilityMatrix`.
- Re-checking `saveCloneBody`.
- The two `skills-synthesis-rpc.handlers.spec.ts` failures under `sub-folder workspace`. `resolveHarnessWorkspaceRoot` prefers an ancestor `.ptah` over the fixture’s `.git`, and `%TEMP%\.ptah` exists on this machine, so the harness root becomes `C:\Users\abdal\AppData\Local\Temp`. Those tests do not call the enhance path. The handler edit is a comment. They were not “fixed” by deleting that directory.

## Verification

This worktree had no `node_modules`. Jest’s `marked` mapper points at `<worktree>/node_modules/marked/lib/marked.umd.js`. A directory junction was created to `D:\projects\ptah-extension\node_modules` so the suites could load. It is gitignored. It is not a source change.

Jest 30 rejects `--testPathPattern`. The runs below use `--testPathPatterns`, which `CLAUDE.md` documents.

Typecheck, exit 0:

`npm run verify -- -t typecheck -p @ptah-extension/platform-core,@ptah-extension/agent-sdk,@ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/skill-synthesis,@ptah-extension/chat,ptah-electron`

```
NX   Running target typecheck for 7 projects:
NX   Successfully ran target typecheck for 7 projects
[verify 2026-11-06T02:20:31.853Z] lock released after 193.3s, exit code 0
```

Tests, exit 0:

`npm run verify -- -t test -p @ptah-extension/platform-core,@ptah-extension/agent-sdk,@ptah-extension/chat,@ptah-extension/skill-synthesis -- --testPathPatterns=file-settings-keys.spec|file-settings-manager.spec|settings-export.types.spec|lane-rotation-setting|capability-matrix-setting|orchestration-settings.component.spec|skill-enhancer.service.spec --coverage=false --maxWorkers=2 --output-style=static`

```
NX   Running target test for 4 projects:
platform-core: Test Suites: 2 passed, 2 total. Tests: 203 passed, 203 total.
agent-sdk: Test Suites: 1 passed, 1 total. Tests: 9 passed, 9 total.
  √ exports the lane rotation key
chat: Test Suites: 3 passed, 3 total. Tests: 14 passed, 14 total.
skill-synthesis: Test Suites: 1 passed, 1 total. Tests: 32 passed, 32 total.
NX   Successfully ran target test for 4 projects
[verify 2026-11-06T02:43:45.481Z] lock released after 171.5s, exit code 0
```

RPC handlers, exit 1 because of the two Temp-root tests above:

`npm run verify -- -t test -p @ptah-extension/rpc-handlers,@ptah-extension/skill-synthesis -- --testPathPatterns=capability-matrix-rpc|skill-enhancer.service.spec|skills-synthesis-rpc.handlers.spec|register-shared-rpc-handlers.spec --coverage=false --maxWorkers=2`

```
NX   Running target test for 2 projects:
√ nx run @ptah-extension/skill-synthesis:test
PASS capability-matrix-rpc.handlers.spec.ts
PASS register-shared-rpc-handlers.spec.ts
FAIL skills-synthesis-rpc.handlers.spec.ts
  lists the harness-root agents ... Expected TEMP\b13-scope-..., received TEMP
  rebases an agent clone ... workspaceRoot TEMP
Test Suites: 1 failed, 2 passed, 3 total
Tests: 2 failed, 154 passed, 156 total
```

`@ptah-extension/shared:test` was not re-run after the Jest flag correction. Its typecheck passed. The new types have no spec of their own.
