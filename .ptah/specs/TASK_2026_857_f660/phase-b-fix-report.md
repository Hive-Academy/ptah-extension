# Phase B review fix round 1 - TASK_2026_857_f660

Scope: decisions.md row 28 items A-D only. Everything else in row 28 is untouched. No git was run
that writes anything.

Root `$WT` = `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing`.

## A. Codex F1: a setting change cancels old work with no admitted turn

**Mechanism.** The platform port already offers a change event:
`IWorkspaceProvider.onDidChangeConfiguration` (`platform-core/src/interfaces/workspace-provider.interface.ts:57`).
Electron fires it on every `setConfiguration`, and file-based keys fire it too
(`electron-workspace-provider.ts:212-240`). No new port was needed.

- `libs/backend/lane-routing/src/lib/scope/host-routing-setting.ts`
  - :15 `HostRoutingSettingChange { switchChanged }`.
  - :40-60 `onDidChange(listener)` subscribes to `onDidChangeConfiguration`. It fires only for
    `ptah.agentOrchestration.hostRouting` (`switchChanged: true`) or
    `ptah.agentOrchestration.decisionModel` (`switchChanged: false`).
  - The type is exported from the barrel at `lane-routing/src/index.ts:73-76`.
- `libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts`
  - :167-170 the constructor subscribes, and `dispose()` releases the subscription with the
    others.
  - :507-521 `onSettingChanged` runs on any write to the switch, whatever the setting reads now. A
    decision-model write only triggers it when it leaves routing off. It does the following:
    - calls `cache.clear()`;
    - runs `disableReset` on every tab, which bumps the per-tab epoch and clears `inFlight` and
      the attempted, routed and nudged marks;
    - drops this coordinator's queued reminders (item B).
  - Treating every switch write as a reset covers the coalesced case where off and on both land
    before the listener runs and it already reads "on". Old assessments and old pre-flights fail
    the existing epoch check (`applyAssessment` / `settlePreflight`) before any state, cache or
    queue mutation.
  - The existing settle-time `isEnabled()` re-check is unchanged. A failure in the handler is
    reported by class only, with the new stage `'setting-change'`.
- Header comment updated (:15-21).

## B. Codex F2: a queued reminder is not injected after routing turns off

- `libs/backend/agent-sdk/src/lib/helpers/next-turn-reminder.queue.ts`
  - :14-17 each entry now carries `owner: string | null`.
  - :29-38 `put(sessionKey, text, owner = null)`. The parameter is optional, so existing callers
    are unchanged.
  - :57-62 the new `discardOwned(owner)` removes every entry with that owner, under any tab key or
    resolved SDK key. Untagged entries and other owners' entries stay, so unrelated hook context is
    preserved.
- In the coordinator, :75 `REMINDER_OWNER = 'host-routing'`. Both the nudge put (:343) and the
  `Routing:` reminder put (:439) are tagged. `onSettingChanged` calls
  `queue.discardOwned(REMINDER_OWNER)` (:517).
- No new Nx edge: agent-sdk knows only an opaque owner string, and the hook handler is unchanged.

## C. Electron lifecycle

- `apps/ptah-electron/src/di/phase-4-handlers.ts`: removed the `app.once('will-quit', ...)` block,
  the `import { app } from 'electron'`, and the now-unused `CHAT_TOKENS` /
  `type HostRoutingCoordinator` imports. Phase 4 only calls `registerHostRouting(container)` again.
- `apps/ptah-electron/src/activation/boot-coordinator.ts`
  - :149-155 new `BootRefs.hostRouting: { dispose(): void } | null`, documented like its siblings.
  - :204 `hostRouting: null` in `createEmptyBootRefs`.
- `apps/ptah-electron/src/activation/wire-runtime.ts`
  - :651-671 the coordinator is captured eagerly beside `chatSessions`, while the container is
    healthy, and only `if container.isRegistered(CHAT_TOKENS.HOST_ROUTING_COORDINATOR)`.
  - A failed resolve sets the ref to `null` and logs a warning, following the local `console.warn`
    sibling convention. The warning carries the error name only, and the swallow carries
    `degradation-audit: reported`.
  - Imports were merged into the existing `@ptah-extension/rpc-handlers` import.
- `apps/ptah-electron/src/activation/shutdown.ts:254-256`
  - `nonFatal('Host routing dispose', () => refs.hostRouting?.dispose())` runs in
    `disposeBeforePersistence`, after the gateway chat bridge stop and before the gateway drain and
    session disposal, so the producers are still alive.
  - `nonFatal` catches a throw, so it cannot skip `flushWorkspacePersistence`,
    `flushSessionMetadataStores` or the LIFO chain. Nothing is resolved at quit.
- `container.smoke.spec.ts` needed no change.

## D. Prettier

`npx prettier --write` was run on the files below, then `--check` passed on all of them.

Source files:

- `next-turn-reminder.queue.ts`
- `user-prompt-submit-hook-handler.ts`
- `route-decide.service.ts`
- `preflight-reuse-cache.ts`
- `scope-check.service.ts`
- `host-routing-setting.ts`
- `host-routing.coordinator.ts`
- `wire-runtime.ts`

The six spec files:

- `next-turn-reminder.queue.spec.ts`
- `user-prompt-submit-hook-handler.spec.ts`
- `host-routing-setting.spec.ts`
- `preflight-reuse-cache.spec.ts`
- `scope-check.service.spec.ts`
- `subagent-hook-handler.spec.ts`

I identified the sixth spec with `prettier --list-different` over the branch's changed `.ts` files
in agent-sdk, vscode-lm-tools, rpc-handlers, lane-routing scope/route-decide and ptah-electron.
`subagent-hook-handler.spec.ts` was the only one left.

`main.quit-path.spec.ts` was formatted after my edit. The other touched files were already clean.

## Tests added

| Test                                                                                                             | Location                                      |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Off then on before an old assessment settles: no decide call, no reminder, no cache entry                        | `host-routing.coordinator.spec.ts:751`        |
| Off then on before an old pre-flight settles: no reminder, no cache entry, and the next settled turn routes anew | `host-routing.coordinator.spec.ts:764`        |
| A switch write whose listener already reads "on" still cancels earlier work                                      | `host-routing.coordinator.spec.ts:786`        |
| A queued reminder plus a toggle off leaves the hook drain (`take`) empty, and another owner's entry survives     | `host-routing.coordinator.spec.ts:798`        |
| A queued nudge is dropped on toggle off                                                                          | `host-routing.coordinator.spec.ts:811`        |
| Dispose also releases the setting listener                                                                       | `host-routing.coordinator.spec.ts:836`        |
| `onDidChange` fires only for the two keys and stops after dispose                                                | `host-routing-setting.spec.ts:58`             |
| `discardOwned` removes only the owner's entries, across tab and resolved keys                                    | `next-turn-reminder.queue.spec.ts:104`        |
| A real queue with an owner-discarded reminder: the hook yields only the handoff pointer                          | `user-prompt-submit-hook-handler.spec.ts:108` |
| `hostRouting` sits in the LIFO order after `chatBridge`                                                          | `main.quit-path.spec.ts:113`                  |
| A throwing `hostRouting.dispose` still runs both flushes and the rest of the chain                               | `main.quit-path.spec.ts:290`                  |

In the coordinator tests, "no admitted turn" means none between the toggles. The tests drive the
toggle through `__state.fireConfigurationChange`, the same event that a real settings write fires.

## Checks

| Command                                                                                                    | Result                                                          |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk,@ptah-extension/lane-routing` | 9 tasks: 9 succeeded (3 projects x lint/test/typecheck), exit 0 |
| `npm run verify -- -p ptah-electron`                                                                       | 9 tasks: 9 succeeded, exit 0                                    |
| `npm run verify -- -t typecheck -p ptah-extension-vscode,ptah-cli,ptah-tui`                                | 3 tasks: 3 succeeded, exit 0                                    |
| `npm run verify -- -t lint -p degradation-audit`                                                           | 1 task, exit 0                                                  |
| `npx prettier --check` on every touched file                                                               | All matched files use Prettier code style                       |

The dynamic Nx output prints no "Running target" header line. The counts come from the summary
line: 9 = 3 projects x 3 targets.

`ptah_get_diagnostics` was unavailable: its TypeScript check was still running after 45 s. The
typecheck targets above cover it.

## Decisions

- **Which events reset.** Any write to the switch resets every tab, whether it reads off or on. A
  decision-model write resets only when routing ends up off.
  - Options: reset only when the read is "off"; reset on every write to either key.
  - Evidence: two settings writes that are not awaited can both fire after the value is already
    back on (`electron-workspace-provider.ts:229-240` sets the value before the persist `await`).
    Model switches while routing stays on already miss the cache through the fingerprint, so
    dropping their reminders would cost work for nothing.
  - Reversible: yes.
- **Owner tag instead of clearing the whole queue.** The owner is an optional third `put`
  argument.
  - Evidence: the task asked for owner-scoped removal. It keeps unrelated producers safe and adds
    no Nx edge.
  - Reversible: yes.

## Left undone / out of scope

- Seven files under `apps/ptah-electron/src/activation/` that this task did not touch fail
  `prettier --check`, for example `bootstrap.ts` and `shutdown.spec.ts`. They are pre-existing and
  were not changed.
- Six non-Phase-B lane-routing specs also fail `--check`, for example
  `decision-model.catalog.spec.ts` and `local-derivation.spec.ts`. They were not changed.
- All row-28 deferrals (F3, F4, F5, the lane-review moderates, the style minors) are untouched.

## Files touched (absolute)

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/lib/scope/host-routing-setting.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/lib/scope/host-routing-setting.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/index.ts`
- MODIFIED (prettier only) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/lib/route-decide.service.ts`
- MODIFIED (prettier only) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/lib/scope/preflight-reuse-cache.ts`
- MODIFIED (prettier only) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/lib/scope/preflight-reuse-cache.spec.ts`
- MODIFIED (prettier only) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/lib/scope/scope-check.service.ts`
- MODIFIED (prettier only) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-routing/src/lib/scope/scope-check.service.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/agent-sdk/src/lib/helpers/next-turn-reminder.queue.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/agent-sdk/src/lib/helpers/next-turn-reminder.queue.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.spec.ts`
- MODIFIED (prettier only) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts`
- MODIFIED (prettier only) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/apps/ptah-electron/src/di/phase-4-handlers.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/apps/ptah-electron/src/activation/boot-coordinator.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/apps/ptah-electron/src/activation/wire-runtime.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/apps/ptah-electron/src/activation/shutdown.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/apps/ptah-electron/src/main.quit-path.spec.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/phase-b-fix-report.md`
