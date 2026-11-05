# Claude SDK native queue spike

## Result

**Verdict: unverified on both versions.** The requested real-session test could not reach `system/init`: this sandbox refuses SDK child-process creation with `spawn EPERM`. `0.3.318` could not be installed because npm is restricted to its offline cache and the version is absent. No claim that the SDK delivers, folds, or loses a mid-turn send follows from these runs. Keep Ptah's existing gates until the probe can run in an environment that permits child processes and package installation.

## Version update and verification

- Changed root `package.json:79` from exact `0.3.278` to exact `0.3.318`.
- Ran `node scripts/verify.mjs --exec --task npm-install -- npm install`: `ENOTCACHED`, fetching `https://registry.npmjs.org/@anthropic-ai%2fclaude-agent-sdk` in `only-if-cached` mode. The worktree has no `node_modules`. `package-lock.json` remains at `0.3.278`; the dependency update is **incomplete**. It would be misleading to hand-edit the lock without the new tarball integrity and dependency metadata.
- The requested `sdk.d.ts` diff and changelog comparison are **unavailable**: no `0.3.318` package was installed. The parent workspace's `D:\projects\ptah-extension\node_modules\@anthropic-ai\claude-agent-sdk\sdk.d.ts` is `0.3.278` (confirmed by its package.json). Breaking changes and update-caused compile errors therefore remain unknown. No compile fixes were made.
- Ran only `npm run verify -- -p @ptah-extension/agent-sdk`. Its header named exactly one project: `verify lint,typecheck (@ptah-extension/agent-sdk) then verify test (@ptah-extension/agent-sdk)`. Nx could not load its default and Jest/ESLint plugins because process spawning returned `EPERM`; the command exited 1. No project test or typecheck result was obtained.

## Direct SDK probe

`spikes/claude-sdk-queue-spike.mjs` imports the SDK directly, uses `haiku`, enables `includePartialMessages`, requests Bash with a 15-second sleep, and writes message metadata and events to JSONL. It assigns a UUID to each user message. Its S4 branch calls `query.streamInput` on a resumed query. Set `SDK_MJS` and `SDK_LABEL` to select each installation. The public `Query` type in `0.3.278` exposes `interrupt()` with no arguments and `streamInput`, but exposes neither `cancel_async_message` nor `interrupt({cancel_queued:true})`; the spike logs those API limitations rather than claiming they were tested.

| Scenario | Outcome | Raw evidence |
| --- | --- | --- |
| S1, `0.3.318` stream | Not run: package missing | `claude-sdk-queue-0.3.318.jsonl`: `"scenario":"setup","error":"Error [ERR_MODULE_NOT_FOUND]..."` |
| S2, cancel queued send | Not run: package/process unavailable; public cancel method absent in `0.3.278` | `0.3.278` declaration has internal `SDKControlCancelAsyncMessageRequest` (`sdk.d.ts:3669`) but no public `Query` method |
| S3, interrupt / cancel queued | Not run: process unavailable; `cancel_queued` is not a public `Query.interrupt` option in `0.3.278` | `sdk.d.ts:2685`: `interrupt(): Promise<SDKControlInterruptResponse | undefined>` |
| S4, resume with `streamInput` | Not run: no S1 session ID | Probe source uses `q.streamInput(input)` for resume |
| S5, `0.3.278` stream | SDK import succeeded; process creation denied before first turn | `claude-sdk-queue-0.3.278.jsonl`: `"scenario":"S5","action":"push-first"`; next event `"error":"Error: spawn EPERM","code":"EPERM"` |

No assistant, result, attachment, queue-counter, or `system/init` event was emitted. The `0.3.278` log also records `"limitation":"SDK process could not start; remaining scenarios skipped."` Authentication was **not reached**, so this is not evidence of an authentication failure.

### Capabilities

**Observed `system/init` capabilities:** none, because no session initialized on either version. The installed `0.3.278` declarations describe `capabilities` at `sdk.d.ts:5633` and name `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`, and `queued_notifications`. These are documented possible values, **not a runtime capability list**. The declarations also describe `user_message_uuid` stamps (`sdk.d.ts:3418,5181,5390`), `cancel_async_message` (`:3669`), `still_queued` (`:4363`), and `cancel_queued` (`:4353`); those types do not prove public API reachability or actual queue delivery. The list and types for `0.3.318` remain unknown.

## Ptah migration proposal (no implementation)

1. Gate adoption on a successful real S1–S5 run and runtime `system/init` capabilities. Add an SDK adapter capability check, not a version string. Require observed UUID lifecycle and interrupt receipt behavior before using the SDK queue. Keep the current path for older or unsupported CLIs.
2. For capable sessions, lift the one-message-per-turn hold in `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:82-84,132-138`. `sendMessage` currently pushes to `session.messageQueue` at `:283`, with the in-flight hold recorded at `:293`. Preserve per-session routing: send through the query bound to that session ID, and keep each client message ID and SDK UUID in a session-scoped map until a terminal event. `session-lifecycle-manager.ts:866-896` supplies the existing send/admission boundary; retain `admission: 'require-idle'` for commands whose semantics require an idle turn, even if ordinary user sends gain SDK queue admission.
3. Do not equate an SDK write with model delivery. Map SDK queued/accepted lifecycle to `queued`, `user_message_uuid` on assistant or partial frames to `delivered`, and cancellation lifecycle or receipt `cancelled` to `cancelled`; reconcile with result UUID and queue counters. The mapping needs explicit handling for UUIDs with no echo, process failure, and reconnect. Session ID plus message UUID must be the key; do not use tab content as an identity.
4. Change the frontend only after backend lifecycle events exist. `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:221-252` currently merges mid-turn text into `queuedContent`; `message-dispatch.service.ts:143-152,267,307-381` sends that content after streaming. For capable sessions, submit each message immediately with its own ID and render status from backend SDK events. Keep the local queue route for unsupported sessions and commands with idle admission. Never silently merge distinct UUID-bearing messages.
5. Stop should call SDK interrupt with queue cancellation when the runtime API and `interrupt_cancel_queued_v1` actually expose it; otherwise use plain `interrupt()` and reconcile `still_queued`, cancelling surviving UUIDs through a supported SDK operation or retaining Ptah's local hold. Withdraw should request `cancel_async_message` for one UUID only while still queued and wait for terminal lifecycle confirmation. Because `0.3.278` public `Query` exposes neither control, an adapter or upstream public API change is needed before Ptah can offer those semantics through the SDK.

Electron should be the first host checked when implementation begins. The same host-neutral adapter must continue to work for `platform-cli` and `cli-engine`; no host-specific import is needed in `agent-sdk`.

Tool check: Ptah workspace analysis and agent-report tools were available. This CLI session exposed no skill-invocation mechanism or task-matching SDK skill; the local `agent-lanes` skill file was readable, but it covers lane orchestration rather than this SDK probe.
