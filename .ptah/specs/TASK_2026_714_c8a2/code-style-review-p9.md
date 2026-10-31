## Verdict

REVISE — 6/10. Review family: kimi-code. Implementer families: mostly grok, with some codex.

The public-import, dependency-direction, DI, host-neutrality, and type-safety rules hold. Round P9 nevertheless adds substantial responsibilities to two oversized orchestration units and duplicates a runtime-identity default that already has an owner.

## Findings

1. **Serious — the Codex host factory now owns another large approval subsystem.** `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:240-747` grew from 581 to 748 raw lines. `createCodexChatHostPorts` now spans 508 lines and combines profile preparation, MCP mapping, pending-request correlation, lifecycle publication, deny timers, and presentation. The new timer and lifecycle machinery at `codex-chat-host-ports.ts:244-355` and `codex-chat-host-ports.ts:544-632` makes future approval changes require edits inside an already broad closure. Extract pending approval presentation into a focused sibling such as `codex-chat-approval-presentation.ts`, with explicit ports for lifecycle, timers, and responses. Keep this factory as composition, consistent with the existing Codex event, sink, and turn-stream splits.

2. **Serious — gateway turn orchestration grew instead of gaining a focused collaborator.** `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:426-749` is a 324-line `runTurn`; the file grew from 1098 to 1283 raw lines. P9 adds identity resolution at `gateway-chat-bridge.ts:511-531` and `gateway-chat-bridge.ts:1020-1047`, native preparation at `gateway-chat-bridge.ts:793-824`, and native resume policy at `gateway-chat-bridge.ts:1118-1175` to the same class that owns queueing, watchdogs, delivery, typing, and notices. A future consumer change must now cross several unrelated turn concerns. Move turn preparation and bound-session identity mapping into focused sibling functions or a small injected collaborator. Leave `runTurn` responsible for sequencing and cleanup.

3. **Medium — legacy Claude identity construction has two owners.** `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:177-193` reproduces the fallback inside `storedChatRuntimeIdentity` at `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:68-85`. These values decide whether an existing thread resumes as Claude or starts native. The copies can drift in provider, workspace, or version defaults without a shared contract test. Put the fallback factory beside `resolveSessionRuntimeIdentity` in `libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-identity.ts:30-60`, and call it from both consumers. Both libs already depend on agent-sdk, so this adds no dependency cycle.

4. **Low — the new lifecycle API documentation is stale or absent.** `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:83-86` says `promptLifecycle` is optional “until Electron binds” it in batch 9b-6, although this round adds that binding. `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:229-231` exposes `publishPromptLifecycle` without the contract documentation given to the adjacent subscription method. A new caller cannot tell whether publication is a general event API or the native-host bridge, or why the dependency remains optional. Replace the batch-status comment with the actual host contract, and document the publication purpose and listener-error behavior.

5. **Low — a positional policy flag makes the approval-sink call opaque.** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:476-483` passes `undefined, consumer === 'chat'` into the trailing parameters declared at `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts:85-97`. The call does not show that `undefined` means the default system root or that the boolean controls read-only auto-accept. Another optional parameter would make order mistakes more likely. Use a small named options object for the trailing environment and policy options.

## Checked

- Reviewed the nine commits and the combined diff for all 41 files. Read the main gateway bridge, Codex host ports, native gateway spec, runtime-profile service, and session identity helper in full. Inspected the remaining production and specification diffs.
- **Six-month change:** findings 1–3 identify where consumer, approval, and identity changes would acquire multiple edit sites.
- **New-team-member reading:** findings 4–5 identify the stale lifecycle comment and the opaque sink arguments.
- **Maintenance cost:** findings 1–3 cover the larger closures and duplicated identity default.
- **Repository consistency:** findings 1–3 contrast this growth with the existing focused Codex siblings and the existing identity helper.
- **Preferred shape:** extract approval presentation and gateway preparation, share the identity fallback in agent-sdk, and name sink options.
- Imports use public package aliases or local relative paths. No new cross-lib dependency or cycle was found. Deleted gateway files explain the removed direct Zod dependency; no remaining Zod import exists in that lib.
- No new `vscode` or `electron` import entered a host-neutral lib. No new `any`, `@ts-ignore`, `as unknown as`, `eslint-disable`, or `console.*` was found.
- Public exports are named consistently. `CodexDevRouteOverride` readers use the new `consumers` shape and `codexDevRouteCovers`; no old `devRoute.consumer` reader remains.
- The host-port specs restore fake timers at `codex-chat-host-ports.spec.ts:1139-1141`. The native gateway spec awaits its zero-delay timers at `gateway-chat-bridge.native.spec.ts:325-333`. No pending real timer or readonly mock assignment was found in the additions.
- `git diff --check` passed. Raw line counts above are growth measurements, not claimed ESLint `max-lines` counts; that rule skips comments and blank lines.
- Per instruction, no tests, lint, typecheck, build, diagnostics, or other verification command ran.
