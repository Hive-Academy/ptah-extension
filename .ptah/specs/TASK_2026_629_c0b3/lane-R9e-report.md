# R9e implementation report

## Files changed

- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:76,636,736-824` — gate exact owner equality on injected `SESSION_CONTEXT`; filter CLI agents, workflow and session subagents, permissions, and retained terminal selection. Keep the ordinary main-panel selectors tolerant even when its session ID is resolved.
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.scope.spec.ts:19,75,128-205` — cover owned, unowned and foreign agents in scoped groups; global and resolved main-panel tolerance; unowned selected terminal exclusion.
- `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.spec.ts:117` — cover close isolation while preserving the other tab's pin, section and width.
- `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.spec.ts:438` — cover tab switching restoring pin and active section.

## Cases covered

A Rail-scoped panel shows only exact-session CLI agents and workflow/session subagents; its counts and permissions follow that filtered set. An unresolved owner never enters a scoped group, including through retained selection. The main panel continues to show unresolved agents with or without a resolved session ID. Dock pin, close, active section and width remain tab-specific.

## Spec results

All commands ran from the worktree through `.ptah/tmp/check-run.mjs`, one at a time, with `--coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`:

- `node .ptah/tmp/check-run.mjs R9e -- npx nx test @ptah-extension/chat --testFile=agent-monitor-panel.scope.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — 14 passed (final run).
- `node .ptah/tmp/check-run.mjs R9e -- npx nx test @ptah-extension/chat --testFile=display-dock.state.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — 26 passed.
- `node .ptah/tmp/check-run.mjs R9e -- npx nx test @ptah-extension/chat --testFile=display-dock.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — 22 passed.

`ptah_get_diagnostics` after the final edit reported no diagnostics in the four requested files. It reported 262 existing errors in sibling chat files; no broad check was run, per batch instructions.

## Decisions

`sessionId` alone cannot indicate Rail scope: ordinary ChatView also supplies a resolved ID. Presence of `SESSION_CONTEXT` is the existing scoped-host marker, matching R9d. The store's tolerant selectors remain the source for the main panel; scoped results are filtered at the panel boundary using exact `parentSessionId` equality. No display-dock implementation or R9d file was changed.

## Risks

`DisplayDockComponent`'s Agents badge reads its `agents()` input, which currently comes from ChatView's tolerant `sessionAgents()`. This batch's permitted implementation file is the panel only, so the scoped panel content/count is strict, but the dock badge may still include unresolved CLI agents until ChatView supplies a strict list in its later batch. The other dock behavior is covered by passing specs.
