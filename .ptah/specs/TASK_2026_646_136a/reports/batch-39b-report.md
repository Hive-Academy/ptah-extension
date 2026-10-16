# Batch 39b report

## Changed files

All paths below are absolute under `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-outcome-rpc.handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\rpc-handlers\src\lib\handlers\agent-outcome-rpc.handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\services\skill-clones-state.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\services\skill-clones-state.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-outcome-signals.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-detail-drawer.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-detail-drawer.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.ts`

## Evidence by item

1. **S-1:** Before, `agent-outcome-rpc.handlers.ts:90-96` rethrew the reader error, and `rpc-handler.ts:241-251` forwarded its message. After, `agent-outcome-rpc.handlers.ts:89-98` logs the real `Error` and throws fixed `RpcUserError('Outcome signals are unavailable.', 'PERSISTENCE_UNAVAILABLE')`. `agent-outcome-rpc.handlers.spec.ts:148-174` supplies an error containing `/secret/ptah.db`, checks the fixed message and code, and checks that the logger received the original Error.
2. **Style S3:** Before, `agent-outcome-rpc.handlers.ts:33-42` copied reader methods. After, `agent-outcome-rpc.handlers.ts:37-40` uses `Pick<LaneOutcomeQueries, 'agentSignals' | 'isPersistent'>` from the lane-outcomes public API (`lane-outcomes/src/index.ts:52`).
3. **S-2 and m-7:** Before, `skill-clones-state.service.ts:112-121` replaced figures with `{}` on read failure and ignored `persistent`; `agent-outcome-signals.ts:38-47` rendered a missing result as “no data yet.” After, `skill-clones-state.service.ts:53-57,107-130` tracks loading, ready, unavailable, and not-persistent states, counts read failures, and retains the last successful figures/window on failure. `agent-outcome-signals.ts:18-56` formats safe loading/unavailable metrics; `skill-clones-view.component.ts:317,360,539` passes status to both presentations. `clone-card.component.ts:192-206,339-342,456-460` and `clone-detail-drawer.component.ts:181-198,473-476,614-621` show notices while keeping existing metrics markup and test ids.

New test ids: `clone-metric-outcome-loading`, `clone-metric-outcome-unavailable`, `clone-outcome-unavailable`, `clone-outcome-not-persistent`, `drawer-outcome-unavailable`, `drawer-outcome-not-persistent`. A first read shows loading; a failed read with no figures shows unavailable; a failed refresh with figures keeps them and adds the unavailable note; `persistent: false` shows the durable-storage note.

## Spec cases added or updated

- `returns a fixed coded error and logs the real reader Error` (updated), `agent-outcome-rpc.handlers.spec.ts:148`.
- `records unavailable outcome data without exposing the read error` (updated), `skill-clones-state.service.spec.ts:413`.
- `keeps displayed outcome figures after a failed refresh`, `skill-clones-state.service.spec.ts:430`.
- `marks outcome data as not persistent when the host has no durable store`, `skill-clones-state.service.spec.ts:452`.
- `marks the first outcome read as loading until it finishes`, `skill-clones-state.service.spec.ts:467`.
- `shows loading instead of no data while the first outcome read is pending`, `clone-card.component.spec.ts:335`.
- `shows a safe unavailable state without raw errors`, `clone-card.component.spec.ts:345`.
- `keeps figures visible with an unavailable note after a failed refresh`, `clone-card.component.spec.ts:358`.
- `shows a non-durable host note for outcome data`, `clone-card.component.spec.ts:367`.
- `shows loading while the first drawer outcome read is pending`, `clone-detail-drawer.component.spec.ts:375`.
- `shows unavailable without replacing existing drawer figures`, `clone-detail-drawer.component.spec.ts:385`.
- `shows a non-durable host note in the drawer`, `clone-detail-drawer.component.spec.ts:397`.

## Decisions

- **Reader type:** Use the lane-outcomes public type. Both projects have `scope:extension` and `type:feature` (`libs/backend/rpc-handlers/project.json:6`, `libs/backend/lane-outcomes/project.json:6`); the `scope:extension` rule permits other extension libs (`eslint.config.mjs:289-293`) and the `type:feature` rule permits feature libs (`eslint.config.mjs:406-415`). The handler already imported `LANE_OUTCOME_TOKENS` from the package (`agent-outcome-rpc.handlers.ts:14-17`). Reversible by changing this type-only import.
- **RPC code:** Use the existing `PERSISTENCE_UNAVAILABLE` code (`libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:13`) for a failed outcome read. A dedicated `OUTCOME_READ_FAILED` code would require editing that shared union, while this batch permits shared changes only if the response type needs a field. The response already has `persistent` (`skill-synthesis-rpc.service.ts:627-639`). This choice is reversible if the shared-code scope opens later.
- **Failure record:** Keep a failure counter and safe status without retaining a raw RPC error (`skill-clones-state.service.ts:53-57,126-129`). A degradation-audit comment records the intentional local catch (`:126`); existing data survives a transient failure. Reversible.

## Verification and remaining work

Ran `npx prettier --write` on the ten changed source/spec files; it completed successfully. Nx, Jest, tsc, eslint, builds, and `ptah_get_diagnostics` were prohibited by this batch because a heavy build is in flight, so behavior and type checks remain for the orchestrator. No other work remains in this batch.
