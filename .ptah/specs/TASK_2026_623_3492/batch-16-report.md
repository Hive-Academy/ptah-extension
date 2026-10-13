# Batch 16 report: C1 host-sources token and ptah-ui block

Executor: frontend-developer. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`. No git
commands were run.

## Task 16.1: host-sources token (component 9). Done.

- CREATED `libs/frontend/chat-ui/src/lib/services/ptah-ui-host-sources.ts`
  - `PTAH_UI_HOST_SOURCES = new InjectionToken<PtahUiHostSources>('PTAH_UI_HOST_SOURCES')`. It has no root
    factory, so consumers inject it as optional.
  - `PtahUiHostSources` has the shape in plan:982-983: `tabId`, `sessionId`, `turnFacts`, `turnIndexOf(messageId)`
    and `capacities`.
  - The file is eager-light. Its only `mcp-apps-contracts` import is `import type { TurnAgentFacts }`, and
    `ContextCapacity` is imported type-only from `@ptah-extension/shared`. Both imports are erased at build.
- MODIFIED `libs/frontend/chat-ui/src/index.ts`: exports `PTAH_UI_HOST_SOURCES` and `type PtahUiHostSources`, next to
  the `PtahUiLiveWindow` export.

## Task 16.2: the ptah-ui block uses compile/resolve, container layout and live inputs. Done, with one plan gap (see below).

- MODIFIED `libs/shared/src/mcp-apps-contracts/surface.index.ts` (#37a), next to the existing pipeline re-exports:
  - functions `compilePtahUiBlock` and `resolveCompiledPtahUiBlock`;
  - types `CompiledPtahUiBlock`, `CompilePtahUiBlockResult` and `ResolvePtahUiBlockInput`;
  - types `PtahUiLimitsInput`, `PtahUiLimitRow` and `PtahUiLiveSources`;
  - type-only `PtahUiAgentsInput` and `TurnAgentFacts`, from `ptah-ui-agents-source.ts`. These two are needed by the
    host-sources token and the block. No runtime symbol from that module is exported (#30, D6).
- MODIFIED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts`
  - `PTAH_UI_BLOCK_PIPELINE` is now `{ compile, resolve }`. Its root factory returns `compilePtahUiBlock` and
    `resolveCompiledPtahUiBlock`. The token keeps its name, so `ptah-ui.ts` (Batch 18's file) still compiles
    unchanged.
  - `compiled` is a `computed` over `body` and `surfaceId` only. Snapshot changes and live-source changes go through
    `resolve` and never parse again (#33).
  - `usedSources` controls every read (D5):
    - the snapshot is read only when the block names `$diff`, `$tests` or `$usage`;
    - `$agents` calls `hostSources.turnIndexOf` and the adapter's `agentsInput` only when the block names `agents`;
    - `$limits` is acquired only when the block names `limits`, and it is released on destroy, when the body stops
      naming it, and when a settled snapshot block retires.
  - The template passes `layoutWidth="container"` to `ptah-surface-renderer`.
  - The live cap is still `PTAH_UI_LIVE_CAP = 8`, and the snapshot and settle rules are unchanged.
  - When `compile` returns `ok:false` (`reserved-id` included), the fallback shows that `reason`. A `compile` or
    `resolve` that throws shows "internal error".
- MODIFIED `ptah-ui-block.component.spec.ts`: the pipeline stub now counts compile runs and resolve runs separately.
  The transcript host body names `$diff`, because a literal block no longer re-resolves on a snapshot change. Tests
  added:
  - `compile` throws and `resolve` throws, each showing "internal error";
  - a reserved-id compile failure shows its reason, with `aria-describedby` and no resolve;
  - the renderer gets `layoutWidth()==='container'` and the `dp-root` class;
  - one compile per body, with snapshot changes only re-resolving;
  - a block without sources does not re-resolve;
  - a `$diff`-only block reads no live source: no `turnIndexOf`, `agentsInput`, `acquireLimits` or `releaseLimits`
    call;
  - live `$agents` and `$limits` update in place: the same block and renderer instance, one block instantiated, one
    compile, one acquire and one release on destroy;
  - with no host sources, `$agents` is "unavailable" while `$limits` still resolves;
  - with no adapter, both are "unavailable" and the block stays valid;
  - the `$limits` read is held only while the body names it;
  - a settled snapshot block releases `$limits`.

### Plan gap (needs a team-leader ruling)

The plan has `ptah-ui-block` read `$agents`/`$limits` through `PtahUiAgentsSource` and `PtahUiLaneLimitsSource`
(component 4a, plan:636-637). Those adapters arrive in Batch 17, and no later batch lists `ptah-ui-block.component.ts`
among its files, so nothing would ever connect them to the block. I resolved this with a seam in the block file:
`PTAH_UI_BLOCK_LIVE_SOURCES` (an optional `InjectionToken<PtahUiBlockLiveSources>`). Its interface is exactly the
4a API: `agentsInput(hostSources, turnIndex): Signal<PtahUiAgentsInput>`,
`acquireLimits(): Signal<PtahUiLimitsInput>` and `releaseLimits()`. While the token is absent, both sources render
"unavailable". That matches the plan's failure behaviour (plan:988) and is what ships today. Recommendation: Batch 17
(or the transcript provider batch, H2) must provide `PTAH_UI_BLOCK_LIVE_SOURCES` from the two adapters. Otherwise
`$agents`/`$limits` stay unavailable in the app.

## Risks and edge cases handled

- **Eager-light token (16.1):** only type imports reach the main barrel; there is no `mcp-apps-contracts` runtime
  import.
- **Barrel eager reach (#37a/b):**
  - The new runtime exports (`compilePtahUiBlock`, `resolveCompiledPtahUiBlock`) come from `ptah-ui-pipeline.ts`, which
    the barrel already reached through `renderPtahUiBlock`, so the eager reach does not grow.
  - The agents-source exports are type-only.
  - The forbidden-eager pattern itself stays with Task 32.1.
- **`chat-ui/src/index.ts` edited again in Batch 27:** this batch adds one export block only.
- **Compile once / never re-parse (#33):** pinned by the compile counter in the spec.
- **Reserved `ptah.` display id (R2.5):** the fallback shows the reason, pinned by the spec. The inline block's own
  ids are always `ptah-ui-…`, so the reserved-id case reaches the block only through compile.
- **Streaming or re-applied body:** `compiled` depends only on body and surface id, so the same body is never compiled
  again.
- **`$limits` RPC failure or VS Code host (no capability):** with the adapter or host sources absent, the source
  resolves to "unavailable" and the block stays valid (pinned).
- **No timers.** The `$limits` reference is released on destroy, on body change and on retire.
- **The 610 live-cap and settle behaviour are unchanged:** the existing live-cap, frozen and settle tests pass.

## Verification (one at a time, memory-safe)

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'`
  → 1 suite, 37 tests passed. The override was needed, because `marked` did not resolve without it. chat-ui's jest
  config defines no mappers of its own.
- `npx nx typecheck @ptah-extension/shared --parallel=1` → passed.
- `npx nx lint @ptah-extension/shared --parallel=1` → 0 errors, 6 warnings. This is the baseline recorded for Batch 5,
  and none of the warnings are in `surface.index.ts`.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: the first run failed with TS2322, because the
  `INTERNAL_ERROR` constant had too wide a type. I fixed the type and the re-run passed.
- `npx nx lint @ptah-extension/chat-ui --parallel=1` → 0 errors, 10 warnings, all in pre-existing files and none in a
  batch file.
- I ran `npx prettier --write` on the five batch files; it changed formatting only. The Jest spec was re-run
  afterwards and all 37 tests passed.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\services\ptah-ui-host-sources.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\index.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.index.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-block.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-block.component.spec.ts`
