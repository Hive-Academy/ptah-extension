# Phase B fix round 3 report

## Defects

- **D3 fixed.** The file settings manager increments a monotonic generation synchronously for either routing key at in-memory set, owned failed-persist restore, and cross-process reload (`libs/backend/platform-core/src/file-settings-manager.ts:133,155,176,524`). The coordinator captures it at admission and checks it before applying an assessment or pre-flight (`libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts:197,282,440`). An unseen off→on or A→B→A pair invalidates old work even when the value returns to its previous state. The event-counting tracker was deleted, so silent writes leave no event debt. Regression tests cover unseen toggles and a silent write (`host-routing.coordinator.spec.ts:839,852,866`), and an actual manager write with failed-persist restore (`file-settings-manager.spec.ts:108`).
- **D5 fixed.** Routing reminders carry their producing generation (`host-routing.coordinator.ts:365,481`; `libs/backend/agent-sdk/src/lib/helpers/next-turn-reminder.queue.ts:15,38`). The owner gate compares that generation with the live value and enablement (`host-routing.coordinator.ts:168`). It runs at queue drain (`next-turn-reminder.queue.ts:59`) and again after the hook awaits the handoff pointer, immediately before constructing additional context (`libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts:112-120,179-185`). Tests cover a queued and drained old-model reminder, the pointer, and another producer (`user-prompt-submit-hook-handler.spec.ts:146,178`), plus a coordinator model change (`host-routing.coordinator.spec.ts:882`).
- **D4 fixed.** The unused `HostRoutingSettingChange.switchChanged` type and payload were removed; the event now has no payload (`libs/backend/lane-routing/src/lib/scope/host-routing-setting.ts:42-52`; `libs/backend/lane-routing/src/index.ts:74`).

A late change event only observes the generation and does not cancel work admitted after the latest write (`host-routing.coordinator.ts:555-570`). Existing one-event and two-event regression tests pass (`host-routing.coordinator.spec.ts:915,944`).

## Files changed

Workspace root: `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing`. Every path below is relative to that root.

- `libs/backend/platform-core/src/file-settings-manager.ts`
- `libs/backend/platform-core/src/file-settings-manager.spec.ts`
- `libs/backend/platform-core/src/interfaces/workspace-provider.interface.ts`
- `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts`
- `libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts`
- `libs/backend/lane-routing/src/lib/scope/host-routing-setting.ts`
- `libs/backend/lane-routing/src/index.ts`
- `libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts`
- `libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.spec.ts`
- Deleted `libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing-config-tracker.ts`
- `libs/backend/agent-sdk/src/lib/helpers/next-turn-reminder.queue.ts`
- `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts`
- `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.spec.ts`
- `.ptah/specs/TASK_2026_857_f660/phase-b-fix-round3-report.md`

## Decisions

- **Optional method on the existing host-neutral workspace port.** Options: a new DI token with registrations and guards; an optional method on `IWorkspaceProvider`. Evidence: all three host providers already own the same file settings manager for both keys (`file-settings-keys.ts:133-134`), and `HostRoutingSetting` already receives that port. Electron, VS Code, and CLI delegate the method to their manager (`workspace-provider.interface.ts:41`; provider lines 90, 75, 84). No new DI token or guard was needed. Reversible: yes.
- **Generation replaces event counting.** Options: retain the live-value stamp and event count; use the write-time generation. Evidence: no-event writes made the count incorrect; the manager now increments at every relevant effective write and rollback. Late events see the already observed generation. Reversible: yes.
- **Optional reminder metadata on the current queue.** Options: add a separate routing queue; extend the existing queue entry and owner gate. Evidence: the queue already retains owner metadata across rekeying and the hook already checks the gate after the pointer. Optional metadata preserves other producers. Reversible: yes.
- **Skill discovery was unavailable in this lane.** A skill search tool is listed, but no skill-loading tool is available. No task-assigned skill was loaded or reconstructed.

## Verification

- Scoped `ptah_get_diagnostics` on changed source and specs: 0 errors, 0 warnings.
- Library verification: `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/platform-electron,@ptah-extension/platform-vscode,@ptah-extension/platform-cli,@ptah-extension/lane-routing,@ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`. **22 tasks: 20 passed, 2 failed; exit 1.** Only the two known non-task Windows test targets failed. Agent SDK: 194 suites passed, 1 failed, 2 skipped; 4483 tests passed, 1 failed, 5 skipped. RPC handlers: 192 suites passed, 4 failed; 5262 tests passed, 12 failed, 7 skipped.
- RPC handlers' 12 known failures: `chat-session-resume-activate.spec.ts` (stored lineage; legacy parent); `chat-session-agent-child.spec.ts` (physical ancestor identity; source root and ancestors; immediate root; nested source chain; same-root handoff); `session-folder.spec.ts` (symlink escape; physical alias; unreadable directory; dangling symlink); `chat-session-session-folder.spec.ts` (child immediate lineage). Causes are Windows path separators, symlink EPERM, and Windows permission behavior, matching the disclosed origin/main failures.
- Agent SDK's known failure: `plugin-loader.service.capabilities.spec.ts`, “deduplicates canonical and same-root aliases for policy and fingerprint”: symlink EPERM.
- Host typechecks: `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`: **4/4 passed; exit 0**.
- Degradation audit: `npm run verify -- -t lint -p degradation-audit`: **1/1 passed; exit 0**.
- `npx prettier --check` on every changed extant file: **passed; exit 0**.
