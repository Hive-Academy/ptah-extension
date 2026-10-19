# Electron console errors: read-only triage

## 1. Angular NG0956

**Root cause: not established from the supplied console line.** NG0956 means an `@for` using an identity key received replacement object references for every item. The warning contains no component/template stack, and the active chat/inspector candidates inspected here do **not** meet that predicate:

- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:40,62` tracks newly built plan/lane tile objects by `tile.id`; `plan-limits/lane-usage-tile.component.ts:123,130,175` tracks group/run/window keys. `plan-limits/plan-limit-tile.component.ts:200,303` and `plan-window-detail.component.ts:85` track `sourceChips`, which are `readonly string[]` (`plan-limits/stats-limit-sections.ts:24` and `plan-limits/stats-limit-view-model.types.ts:95,117,189`). A one-chip collection is possible, but strings do not acquire new identity on recomputation.
- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.ts:64` tracks `part.track`, a string assigned from segment ordinals at lines 124-147. The `$limits` block has no identity-tracked object loop.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-task-section.component.ts:129` tracks `doc`, a document path string; `inspector-agents-section.component.ts:141` tracks `view.key`. The chat view tracks tab IDs at `chat-view.component.html:102`.
- The shared skeleton's `@for (row of rowIndexes(); track row)` at `libs/frontend/chat-ui/src/lib/atoms/skeleton-block.component.ts:30` uses numeric indexes produced at line 60, including the default one-row case. The canvas rail's `track side` at `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:171` uses the constant string tuple at line 282.

**On `main`: occurrence unknown.** `git show main:<path>` confirms the inspector document loop, the tile-key loops, and the ptah-ui part-key loop exist on `main`; those loops still do not explain this warning. The observed runtime warning cannot be assigned to a branch without the emitting template/stack.

**Size: LARGE / unsized pending emitter identification.** An exact source edit would be guesswork. Proposed change after capture of the emitting template, in diff form:

```diff
- @for (item of recomputedObjects(); track item) {
+ @for (item of recomputedObjects(); track item.stableId) {
```

Capture the warning's Angular template stack (or pause on `console.warn`) and confirm that `stableId` is unique and stable before applying. If the collection has no semantic key and keeps order, `track $index` is a possible local alternative. **Risk:** changing the wrong loop hides the warning without fixing the emitting view; an unstable or duplicate key can reuse DOM for the wrong item. No frontend-only ≤30-line fix can be responsibly identified from this console line alone.

## 2. `agent:getLanePlanLimits` RPC timeout

**Root cause:** The `$limits` adapter sets a **10,000 ms** RPC deadline at `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts:17-18,129-135`. `ClaudeRpcService` logs and fails at that deadline (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:135,154-167`), producing the subsequent adapter warning at line 137. The Electron handler awaits `agent.list()` **then** `agent.limits(rows)` serially at `libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts:105-110`. The latter waits for all lane reads (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:128-138`); a Codex or Antigravity lane is allowed **12,000 ms** by `libs/shared/src/lib/utils/plan-limits/evidence-precedence.ts:17-37`, and the lookup explicitly notes the whole response can take 12 seconds (`lane-limit-lookup.service.ts:9-16`). Enumeration and IPC add time. Thus a healthy cold/expired slow-provider lookup can outlast the client deadline; the console alone cannot prove which provider was slow in this run.

**Alternatives checked:** `PlanUsageService` has a 30-second per-owner cache and joins in-flight reads (`libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:83-86,175-193`), so this is not a missing provider cache. Electron enables `lanePlanLimits` (`apps/ptah-electron/src/rpc-host-profile.ts:46-48`), and `apps/ptah-electron/src/di/container.smoke.spec.ts:968-987` asserts registration. `agent.list()` invokes cached CLI detection but also awaits registry enumeration (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:464-483`), which is not covered by the provider deadline. The timeout does not cancel the handler's already-started work.

**Why repeated:** The adapter watches `PlanLimitsStore.snapshot()` while `$limits` has a holder, re-reading after every new snapshot reference (`ptah-ui-lane-limits.source.ts:93-107`), including following a failure. It serializes requests and queues one follow-up during an in-flight read (`:110-126`); it does **not** retry on a timer (`:54-60`). `PlanLimitsStore.apply()` installs each accepted snapshot as a new reference (`libs/frontend/core/src/lib/services/plan-limits.store.ts:235-241`). Repeated host pushes/loads or repeated block acquire bursts therefore reproduce the timeout. The visible inspector Plan Limits cards alone do not call this RPC; the `$limits` ptah-ui block is the caller.

**On `main`: yes, the same timeout path exists.** `git show main:libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts` has `10_000` and the snapshot watcher. `git show main:libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts` has the sequential list/limits calls; `git show main:libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts` documents the 12-second lane deadline. `git show main:apps/ptah-electron/src/rpc-host-profile.ts` has the enabled capability.

**Size: SMALL** (one frontend-only line in `@ptah-extension/chat-ui`; no RPC contract or DI guard change). Proposed edit:

```diff
// libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts
-export const LANE_PLAN_LIMITS_TIMEOUT_MS = 10_000;
+export const LANE_PLAN_LIMITS_TIMEOUT_MS = 15_000;
```

This leaves three seconds beyond the slowest designed lane deadline for cached enumeration, formatting, and IPC. **Risk:** an unusually slow `agent.list()` or overloaded host can still exceed 15 seconds; the unavailable state takes five seconds longer to appear. A hard end-to-end bound would require a larger handler/transport change and cancellation, outside this small fix.

No source files were changed and no tests were run as part of this read-only triage.
