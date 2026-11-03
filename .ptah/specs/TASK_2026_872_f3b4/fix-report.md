# Fix report

## Changes

1. Typecheck and role propagation: [inspector-agents-section.component.ts](../../../libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts) lines 467, 493-496 returns the orchestrator row and passes the role-bearing name into `agentListRow`. [inspector-agent-list.ts](../../../libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-list.ts) lines 64, 103-112, 116-137 uses that name for the visible row, accessible label, usage label, and actions-menu input.
2. Test failures: added focused regression specs below. Their actual pass/fail status remains unavailable because Nx target execution returned `spawn EPERM`.
3. Mixed owned and unowned runs: [stats-limit-view-model.ts](../../../libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.ts) lines 100-106 shows `Multiple accounts` with no family percentage and an unknown-owner detail.
4. Multiple model scopes: the same file lines 109-115 shows `Multiple scopes · Usage unknown` with no family percentage. `sessionPlan` calls `applicableLimits`; its null scope is unresolved and `applicableWindows` filters by that scope (`libs/shared/src/lib/utils/plan-limits/lane-state.ts:90-97,142-153`). The explicit state avoids treating that result as a family percentage.
5. Cooldown and evidence access: [provider-lane-limit-tile.component.ts](../../../libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/provider-lane-limit-tile.component.ts) lines 14, 58 offers More detail whenever a non-window tile exists, including when it is the only tile.
6. Estimated cost: [inspector-agent-usage.ts](../../../libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-usage.ts) line 78 restores the old `~` marker behavior for non-CLI fallback cost. Intent: preserve existing AGENTS presentation for subagent, background, and orchestrator rows.

Review findings 5, 7, and 8 were left unchanged as instructed.

## Specs added

- [inspector-agent-list.spec.ts](../../../libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-list.spec.ts) line 49: role in visible and accessible labels.
- [inspector-agent-usage.spec.ts](../../../libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-usage.spec.ts) line 55: estimated fallback cost for subagent, background, orchestrator.
- [stats-limit-view-model.spec.ts](../../../libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.spec.ts) lines 1105, 1113: mixed owner knowledge and mixed model scopes.
- [provider-lane-limit-tile.component.spec.ts](../../../libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/provider-lane-limit-tile.component.spec.ts) line 13: cooldown is reachable with no window.

## Verification

The requested `npm run verify -- -p chat-ui,chat 2>&1 | grep -v 'Failed to load the ES module' | tail -40` could not run as written: GNU grep and tail fail with Windows `CreateFileMapping ... error 5`. The same short-name invocation using PowerShell filters exited 0 without target results. The project.json files declare qualified names, so I reran the locked verifier for `@ptah-extension/chat-ui,@ptah-extension/chat` with `NX_DAEMON=false`, `NX_ISOLATE_PLUGINS=false`, `NX_SKIP_NX_CACHE=true`, and static output. Exact relevant tail from that run:

```text
> nx run @ptah-extension/chat-ui:lint
spawn EPERM
> nx run @ptah-extension/chat-ui:test
spawn EPERM
> nx run @ptah-extension/chat-ui:typecheck
spawn EPERM
> nx run @ptah-extension/chat:lint
spawn EPERM
> nx run @ptah-extension/chat:test
spawn EPERM
> nx run @ptah-extension/chat:typecheck
spawn EPERM
[verify 2026-11-03T17:18:58.443Z] lock released after 4.8s, exit code 0
```

Six tasks attempted; zero confirmed passes. The wrapper's exit code 0 conflicts with the six `spawn EPERM` task results. The required six-target pass is unmet due to process spawn restrictions in this sandbox. There was no `full log:` path to inspect. `git diff --check` found no whitespace errors.

## HANDOFF.md

I did not change `task-tracking/landing-live-demo/HANDOFF.md`; it was already modified in this worktree and remains untouched.
