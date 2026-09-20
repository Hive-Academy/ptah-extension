# Batch E Report

## Outcome

Subagent costs now preserve the difference between a known zero and an unknown price. A tree containing any node with an unknown cost returns `null`, per-agent breakdown rows carry `null`, and a session summary remains unknown when any included agent is unpriced. The compact and full session-stat surfaces reuse `CostBadgeComponent`, so a nullable total is displayed as `cost unavailable` while a genuine zero remains `$0.0000`.

## Consumer and Type-Ripple Check

Repository-wide TypeScript searches found `AgentCostBreakdown` and `agentBreakdown` production use only in `libs/shared/src/lib/utils/subagent-cost.utils.ts`; the remaining direct references are its unit tests. The two named UI consumers call `calculateSessionCostSummary` and read `SessionCostSummary.totalCost`; neither reads individual breakdown rows. Widening `AgentCostBreakdown.cost` from `number` to `number | null` therefore has no ripple beyond the shared utility, its tests, and the nullable total already modeled by `SessionCostSummary`.

`calculateSessionCostSummary` does not add subagent rows to `message.cost`, because that could double-count a message total that already includes subagent work. It uses an unknown agent row only to poison the displayed aggregate; known message totals continue to be summed exactly once.

## Changes

### `libs/shared/src/lib/utils/subagent-cost.utils.ts`

- Widened `AgentCostBreakdown.cost` to `number | null`.
- Changed `calculateTotalTreeCost` to return `null` when the root or any descendant has no known cost.
- Preserved unknown agent row costs as `null` in `getAgentCostBreakdown`.
- Made `calculateSessionCostSummary` all-or-unknown across explicit null message costs and unknown agent rows.

### `libs/shared/src/lib/utils/subagent-cost.utils.spec.ts`

- Changed `returns 0 when cost is undefined` to `returns null when the root cost is unknown`.
- Added `returns null when one nested node has an unknown cost`.
- Added `sums a tree with no agent nodes as before`.
- Updated the default breakdown-row test to expect `null` cost.
- Added `returns an unknown total when an agent cost is unknown`.

### `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.ts`

- Replaced the local session-total formatter with `CostBadgeComponent`.
- Kept the summary signal protected so Angular's strict template checker can bind the nullable total without making it part of the component's public API.

### `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`

- Reused `CostBadgeComponent` for the collapsed and expanded session-total displays.

## Patch

```diff
--- a/libs/shared/src/lib/utils/subagent-cost.utils.ts
+++ b/libs/shared/src/lib/utils/subagent-cost.utils.ts
@@
-  readonly cost: number;
+  readonly cost: number | null;
@@
-export function calculateTotalTreeCost(node: ExecutionNode): number {
-  let total = node.cost ?? 0;
+export function calculateTotalTreeCost(node: ExecutionNode): number | null {
+  if (node.cost === null || node.cost === undefined) return null;
+  let total = node.cost;
   for (const child of node.children) {
-    total += calculateTotalTreeCost(child);
+    const childCost = calculateTotalTreeCost(child);
+    if (childCost === null) return null;
+    total += childCost;
@@
-      cost: node.cost ?? 0,
+      cost: node.cost ?? null,
@@
+  let hasUnknownCost = false;
@@
-    if (message.cost !== null && message.cost !== undefined) {
+    if (message.cost === null) {
+      hasUnknownCost = true;
+    } else if (message.cost !== undefined) {
@@
+      if (agents.some((agent) => agent.cost === null)) {
+        hasUnknownCost = true;
+      }
@@
-    totalCost: hasCostContribution ? totalCost : null,
+    totalCost: hasCostContribution && !hasUnknownCost ? totalCost : null,
--- a/libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.ts
+++ b/libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.ts
@@
+import { CostBadgeComponent } from '../../atoms/cost-badge.component';
@@
+  imports: [CostBadgeComponent],
@@
-        <span class="text-success tabular-nums">{{ formattedCost() }}</span>
+        <ptah-cost-badge [cost]="summary().totalCost" />
@@
-  readonly formattedCost = computed(() => { ... });
--- a/libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts
+++ b/libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts
@@
+import { CostBadgeComponent } from '../../atoms/cost-badge.component';
@@
+  imports: [CostBadgeComponent],
@@
-                  formatCost(summary().totalCost)
+                <ptah-cost-badge [cost]="summary().totalCost" />
@@
-                {{ formatCost(summary().totalCost) }}
+              <ptah-cost-badge [cost]="summary().totalCost" />
```

The test-file changes are enumerated by exact test name above.

## Verification

All commands completed successfully. Each Nx header reports 6 projects, matching the requested project count. Lint completed with 0 errors; the warnings shown below are pre-existing repository warnings.

### Tests

```text

 NX   Running target test for 6 projects:

- @ptah-extension/shared
- @ptah-extension/chat-ui
- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/agent-sdk



> nx run @ptah-extension/chat-state:test


Test Suites: 18 passed, 18 total
Tests:       394 passed, 394 total
Snapshots:   0 total
Time:        23.484 s, estimated 48 s
Ran all test suites.

> nx run @ptah-extension/shared:test

A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 60 passed, 60 total
Tests:       1550 passed, 1550 total
Snapshots:   0 total
Time:        23.444 s, estimated 54 s
Ran all test suites.

> nx run @ptah-extension/chat-ui:test


Test Suites: 27 passed, 27 total
Tests:       187 passed, 187 total
Snapshots:   0 total
Time:        21.099 s
Ran all test suites.

> nx run @ptah-extension/chat-streaming:test

A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.

Test Suites: 24 passed, 24 total
Tests:       1 skipped, 505 passed, 506 total
Snapshots:   0 total
Time:        25.685 s
Ran all test suites.

> nx run @ptah-extension/chat:test


Test Suites: 82 passed, 82 total
Tests:       2 skipped, 1316 passed, 1318 total
Snapshots:   0 total
Time:        23.603 s
Ran all test suites.

> nx run @ptah-extension/agent-sdk:test


Test Suites: 2 skipped, 111 passed, 111 of 113 total
Tests:       3 skipped, 2007 passed, 2010 total
Snapshots:   0 total
Time:        74.189 s, estimated 98 s
Ran all test suites.



 NX   Successfully ran target test for 6 projects


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

### Typecheck

```text

 NX   Running target typecheck for 6 projects:

- @ptah-extension/shared
- @ptah-extension/chat-ui
- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/agent-sdk



> nx run @ptah-extension/shared:typecheck

> tsc --noEmit --project libs/shared/tsconfig.lib.json


> nx run @ptah-extension/chat-state:typecheck

> npx ngc --noEmit --project libs/frontend/chat-state/tsconfig.lib.json


> nx run @ptah-extension/agent-sdk:typecheck

> tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json


> nx run @ptah-extension/chat-streaming:typecheck

> npx ngc --noEmit --project libs/frontend/chat-streaming/tsconfig.lib.json


> nx run @ptah-extension/chat-ui:typecheck

> npx ngc --noEmit --project libs/frontend/chat-ui/tsconfig.lib.json


> nx run @ptah-extension/chat:typecheck

> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json




 NX   Successfully ran target typecheck for 6 projects


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

### Lint

```text

 NX   Running target lint for 6 projects:

- @ptah-extension/shared
- @ptah-extension/chat-ui
- @ptah-extension/chat
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/agent-sdk



> nx run @ptah-extension/chat-state:lint


Linting "@ptah-extension/chat-state"...

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat-state\src\lib\tab-manager.cross-workspace.spec.ts
  115:29  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat-state\src\lib\tab-manager.service.ts
  1515:1  warning  File has too many lines (1326). Maximum allowed is 700  max-lines

✖ 2 problems (0 errors, 2 warnings)

✖ 2 problems (0 errors, 2 warnings)


> nx run @ptah-extension/shared:lint


Linting "@ptah-extension/shared"...

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\shared\src\lib\connectors\ptah-connectors.catalog.ts
  777:1  warning  File has too many lines (810). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\shared\src\lib\types\rpc.types.ts
  759:1  warning  File has too many lines (3201). Maximum allowed is 700  max-lines

✖ 2 problems (0 errors, 2 warnings)

✖ 2 problems (0 errors, 2 warnings)


> nx run @ptah-extension/chat-ui:lint


Linting "@ptah-extension/chat-ui"...

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-activity.component.ts
  806:1   warning  File has too many lines (840). Maximum allowed is 700  max-lines
  959:42  warning  Forbidden non-null assertion                           @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-header.component.ts
  7:31  warning  'Zap' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts
  830:1  warning  File has too many lines (725). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\mcp-directory-browser.component.ts
  818:1  warning  File has too many lines (867). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\plugin-browser-modal.component.ts
  973:1  warning  File has too many lines (856). Maximum allowed is 700  max-lines

✖ 6 problems (0 errors, 6 warnings)

✖ 6 problems (0 errors, 6 warnings)


> nx run @ptah-extension/agent-sdk:lint


Linting "@ptah-extension/agent-sdk"...

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\helpers\sdk-model-service.ts
  802:47  warning  Unexpected empty async generator function  @typescript-eslint/no-empty-function

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts
  1287:1  warning  File has too many lines (949). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.spec.ts
   919:21  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
   920:21  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
   921:21  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
   988:13  warning  'rec' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  1117:14  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
  1123:14  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion
  1123:37  warning  Forbidden non-null assertion                                                    @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.spec.ts
  456:9  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\permission\ask-user-question.service.spec.ts
  131:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  165:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  193:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  237:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  238:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  341:11  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  400:31  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  496:11  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\permission\exit-plan-mode.service.spec.ts
   99:18  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  125:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
  990:1  warning  File has too many lines (913). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\sdk-permission-handler.spec.ts
   128:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   163:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   193:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   235:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   236:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   271:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   272:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   315:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   381:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   416:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   445:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   893:8   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
   987:9   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  1227:7   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  1258:9   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  1306:9   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  1420:13  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts
  895:1  warning  File has too many lines (896). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts
  951:1  warning  File has too many lines (883). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\session-metadata-store.ts
  1036:1  warning  File has too many lines (885). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\backend\agent-sdk\src\lib\session-stats\session-stats-reader.perf.spec.ts
  223:9  warning  Unused eslint-disable directive (no problems were reported from 'no-console')

✖ 42 problems (0 errors, 42 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

✖ 42 problems (0 errors, 42 warnings)

  0 errors and 1 warning are potentially fixable with the `--fix` option.


> nx run @ptah-extension/chat-streaming:lint


Linting "@ptah-extension/chat-streaming"...

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts
  1145:1  warning  File has too many lines (1179). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat-streaming\src\lib\streaming-event-cascade-clean.spec.ts
  8:11  warning  'SeedTextDelta' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)

✖ 2 problems (0 errors, 2 warnings)


> nx run @ptah-extension/chat:lint


Linting "@ptah-extension/chat"...

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts
  911:1  warning  File has too many lines (1063). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts
  807:1   warning  File has too many lines (928). Maximum allowed is 700  max-lines
  932:37  warning  Forbidden non-null assertion                           @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts
   70:35  warning  'SessionId' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  370:22  warning  Unexpected empty arrow function                                              @typescript-eslint/no-empty-function

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts
  1229:5  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
  1065:1  warning  File has too many lines (923). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat\src\lib\components\templates\chat-view.keepalive.spec.ts
  200:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  212:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  213:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  221:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts
   995:1   warning  File has too many lines (977). Maximum allowed is 700  max-lines
  1356:43  warning  Unexpected empty async method 'createNewSession'       @typescript-eslint/no-empty-function

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat\src\lib\settings\ptah-ai\agent-orchestration-config.component.ts
  739:1  warning  File has too many lines (988). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-stats-validation-ceilings-099254c3ce53\libs\frontend\chat\src\lib\settings\ptah-ai\ptah-cli-config.component.ts
   787:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function
   789:1   warning  File has too many lines (1034). Maximum allowed is 700  max-lines
  1014:49  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function

✖ 17 problems (0 errors, 17 warnings)

✖ 17 problems (0 errors, 17 warnings)




 NX   Successfully ran target lint for 6 projects


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```
