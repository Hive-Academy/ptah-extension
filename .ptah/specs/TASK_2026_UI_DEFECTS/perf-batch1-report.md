# Batch 1 — ingress scheduling

Date: 2026-10-07

## Result

`MessageRouterService` now dispatches an all-stream drain outside Angular. A
drain that contains any other message still enters `NgZone` exactly once; its
stream members are dispatched through nested `runOutsideAngular` calls. This
keeps FIFO order, BATCH in-place expansion, per-message error isolation, and
the synchronous RPC-response flush unchanged.

The installed Angular runtime is 22.1.7 (`node_modules/@angular/core/package.json`).
Its signal setter calls `signalSetFn` (`fesm2022/core.mjs:186-189`); template
signal consumers are notified by Angular's reactive-view scheduler, rather than
requiring the ingress handler to stabilize Zone. That is the basis for the two
audited stream types below.

## Handler audit

“Zone needed” means required for this Batch-1 ingress decision, not whether a
service may later schedule asynchronous work. Unknown/new types intentionally
default to **yes**.

| Handler                                                             |                                                            File:line | Zone needed? | Reason                                                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------: | ------------ | -------------------------------------------------------------------------------------------------- |
| ChatMessageHandler: `chat:chunk`                                    |                            `chat-message-handler.service.ts:111,458` | No           | Routes the continuous stream into signal-backed tab/stream state. Enabled outside Zone.            |
| ChatMessageHandler: `agent:summary-chunk`                           |                            `chat-message-handler.service.ts:111,563` | No           | Delegates to `ChatStore`/lifecycle signal-backed summary state. Enabled outside Zone.              |
| ChatMessageHandler: remaining 20 lifecycle/permission/session types |                            `chat-message-handler.service.ts:111,135` | Yes          | Includes dialogs, debounced timers, adoption and side effects; not proven signal-only as a group.  |
| ChangeSetStore                                                      |                               `chat/.../change-set.store.ts:263,377` | Yes          | Timers and RPC/reconciliation paths; not signal-only.                                              |
| AgentMonitorMessageHandler                                          |            `chat/.../agent-monitor-message-handler.service.ts:22,30` | Yes          | Delegates to process-store methods; contract not proven here.                                      |
| VoiceProviderErrorService                                           |                     `chat/.../voice-provider-error.service.ts:27,29` | Yes          | Direct signal write, but low-frequency and deliberately not widened in this stream-only allowlist. |
| VoiceDownloadProgressService                                        |                  `chat/.../voice-download-progress.service.ts:20,24` | Yes          | Direct signal write, but not a chat stream; retained conservatively.                               |
| UpdateDialogService                                                 |                            `chat/.../update-dialog.service.ts:40,82` | Yes          | Signal update with RPC hydration/dialog contract; low frequency.                                   |
| ClaudeRpcService                                                    |                              `core/.../claude-rpc.service.ts:99,101` | Yes          | Resolves pending promises; RPC ordering is load-bearing.                                           |
| BootStatusService                                                   |                             `core/.../boot-status.service.ts:81,151` | Yes          | Signal state plus watchdog timer.                                                                  |
| BackOfficeActivityService                                           |                   `core/.../back-office-activity.service.ts:104,149` | Yes          | Signal collection plus time/interval behavior.                                                     |
| AutopilotStateService                                               |                          `core/.../autopilot-state.service.ts:64,66` | Yes          | Not audited as stream-only.                                                                        |
| AppStateService                                                     |                              `core/.../app-state.service.ts:355,369` | Yes          | View switching has router/UI effects.                                                              |
| VSCodeService                                                       |                                      `core/.../vscode.service.ts:99` | Yes          | Legacy host/UI state contract not proven signal-only.                                              |
| PlanLimitsStore                                                     |                                  `core/.../plan-limits.store.ts:202` | Yes          | Not audited as stream-only.                                                                        |
| ElectronLayoutService                                               |                            `core/.../electron-layout.service.ts:111` | Yes          | Layout/browser side effects.                                                                       |
| WorkspaceIndexingService                                            |                                  `workspace-indexing.service.ts:162` | Yes          | Not audited as stream-only.                                                                        |
| GatewayStateService                                                 |                                       `gateway-state.service.ts:269` | Yes          | Gateway/UI state contract not proven.                                                              |
| TasksStore / TaskSessionLinks                                       |   `tasks-store.service.ts:1120`; `task-session-links.service.ts:139` | Yes          | Async reload/RPC paths.                                                                            |
| SetupWizardState / dispatcher                                       |  `setup-wizard-state.service.ts:369`; `wizard-message-dispatcher.ts` | Yes          | Analysis stream and wizard flow not audited as signal-only.                                        |
| VecEmbedderRecovery / ThothStatus                                   | `vec-embedder-recovery.service.ts:71`; `thoth-status.service.ts:286` | Yes          | Recovery/status work may trigger async effects.                                                    |
| HarnessWorkflow handler                                             |                             `harness-workflow-message.handler.ts:29` | Yes          | Workflow side effects.                                                                             |
| Marketplace HarnessHealth / SkillSynthesisLive                      |  `harness-health.store.ts:263`; `skill-synthesis-live.service.ts:92` | Yes          | Store/event contracts not proven.                                                                  |
| SurfaceUpdateInbox                                                  |                                 `surface-update-inbox.service.ts:79` | Yes          | Surface routing work; not proven.                                                                  |
| Git branch/file/output/diff/worktree/status handlers                |                    respective services `:208/:29/:40/:289/:325/:386` | Yes          | Git UI may issue reloads and side effects.                                                         |

The audit used all `handledMessageTypes`/`handleMessage` implementations under
`libs/frontend`; no handler registration code was changed. Only the two
high-frequency chat stream types meet the narrow Batch-1 proof bar.

## Design and changes

- `message-router.service.ts:78-82` defines a deliberately small
  `SIGNAL_ONLY_STREAM_TYPES` allowlist.
- `:211-264` checks each envelope recursively. A BATCH is outside-zone only
  when every member is an allowed stream; malformed BATCH envelopes stay in
  Zone for existing error reporting.
- `:217-223` enters Zone once only when the pending drain contains a
  zone-required item. An all-stream burst has zero `NgZone.run` entries.
- `:233-247` dispatches members in original order. In a mixed drain, nested
  `runOutsideAngular` keeps stream handlers outside while the one outer entry
  preserves order for neighboring Zone work.
- `message-router.service.spec.ts:377-423` proves a 1,000-message stream burst
  has zero zone entries, and proves a mixed drain has one entry, correct order,
  and correct inside/outside execution. Existing BATCH and RPC R-P8 tests
  continue to cover their semantics.

## Expected impact and risks

Continuous chat chunks no longer cause an `ApplicationRef` tick merely because
their MessageChannel drain settles. That removes the sampled dominant
Zone-tick path for all-stream drains; mixed drains are bounded to one entry.

The intentional risk is that a future change could add non-signal behavior to
either allowlisted chat type. The allowlist is type-specific, documented, and
defaults all new types to Zone to make that review explicit. A BATCH containing
any non-stream member remains a single zone entry, so mixed producer batches
do not obtain the full benefit. RPC responses remain zone-required and retain
their capture-phase synchronous flush.

## Verification

- `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/message-router.service.spec.ts --coverage=false --maxWorkers=2` — passed: 1 suite, 28 tests.
- `npx nx typecheck @ptah-extension/core --parallel=1` — passed. Nx Cloud emitted its pre-existing disabled-organization warning after the successful target.

PowerShell has no `tail`; the requested filtered commands were run with
`Select-Object -Last` as the equivalent output filter.
