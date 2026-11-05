# Batch 12 report

## Files changed

- `libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.ts` (new)
- `libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.spec.ts` (new)
- `libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.cross-process.spec.ts` (new)
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/tokens.ts`
- `libs/backend/rpc-handlers/src/lib/chat/di.ts`
- `libs/backend/rpc-handlers/src/index.ts`
- This report.

## Implementation

- Owner set and per-session serialization: `session-driver-lock-coordinator.ts:9-20,39-47,71-91`. Kernel release occurs only after records, native leases, and provisional owner are gone (`:71-76`). No runtime filter.
- `beginDrive`, `abandonDrive`, `admitNative`, and `assertDriveHeld`: `:78,85,95,107`. A lock-port throw maps to `SESSION_DRIVER_LOCK_UNAVAILABLE` (`:57-67`); another holder's label is included in `SESSION_DRIVEN_ELSEWHERE` (`:48-54`).
- Registry bound, rebound, and removal subscriptions: `:25-35`. Rebind holds the old ID until the new acquisition completes (`:138-146`); `pendingHandoff` gates turns (`:95-103`). Failed admission aborts and ends the record (`:165-174`).
- Token and registration: `tokens.ts:15`, `di.ts:100`; public export: `index.ts:9`.
- `ChatSessionService` start admission: `chat-session.service.ts:1228`; continue acquisition: `:1675`; resume activate acquisition: `:2026`; rewind acquisition: `:2306`; resume assertion before SDK: `:2579`. Failure cleanup is at `:1753,1877,2047-2050,2107,2319` and slash cleanup is in the continue path. A missing coordinator fails closed through `:431-434`.
- `session-rpc.handlers.ts` unchanged; its existing `RpcUserError` rethrow remains the rewind propagation path.

## Tests and verification

- Added unit coverage for owner-set release and holder-named refusal in `session-driver-lock-coordinator.spec.ts`.
- Added a cross-process rebind test with a real `SessionRegistry` and `KernelSessionDriverLock` in `session-driver-lock-coordinator.cross-process.spec.ts`.
- `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,mcp-bench` was attempted once. Nx exited before checks: sandbox denied daemon socket connection (`connect EPERM /tmp/.nx/.../d.sock`). Per batch rule, no retry. `ptah_get_diagnostics` was attempted after edits but the TypeScript compiler remained running past its 45-second limit; it returned no diagnostics. Tests are therefore unverified.
- No new `ChatSessionService` or `session-rpc.handlers.spec.ts` cases were added; those call-site tests remain outstanding.

## Open point

`KernelSessionDriverLock` takes a live-record predicate only in its constructor and defaults to `() => true` (`libs/backend/platform-core/src/session-driver-lock/kernel-session-driver-lock.ts:25`). The coordinator cannot supply the predicate through the existing `ISessionDriverLock` port or DI registration within this batch's allowed files. Recommendation: a later platform registration batch should construct the kernel lock with a predicate consulting the process's live session registry. Alternative: add a setter to the lock, but that requires a platform-core change outside this file list. Operator release remains refused under the current default.

## Decisions

- Kept `ChatSessionService`'s new constructor parameter optional at the end so existing direct-construction specs compile, while the `lockCoordinator` getter fails closed if the DI binding is absent. Reversible by updating all direct-construction specs and making the parameter required.
- Used the existing `SessionLifecycleManager` notifications and record-token identity, avoiding a second record registry. Reversible if the lifecycle API changes.

## Fix round 1

1. **Lazy import lint:** The cross-process spec now uses static workspace imports; inspection found no dynamic `import(...)` in that file. It remains a real `SessionRegistry` and `KernelSessionDriverLock` rebind test. No fixture change was needed in this round.
2. **Existing session specs:** Added a permissive coordinator argument to all 15 direct-construction `ChatSessionService` spec harnesses under `libs/backend/rpc-handlers/src/lib/chat/session/`. Production's missing-coordinator `RpcUserError` remains intact.
3. **Call-site tests:** `chat-session.host-routing.spec.ts` now checks start admission, ptah CLI bypass, and holder-named continue refusal with no SDK call. `chat-session-resume-activate.spec.ts` checks activate refusal, rewind admission before stream inspection, and held-drive assertion before SDK resume. `session-rpc.handlers.spec.ts` checks that rewind preserves the lock holder refusal and skips SDK rewind. Existing coordinator specs cover owner-set release and holder naming.
4. **Live-record check:** `ISessionDriverLock` now has `setLiveRecordCheck`. `KernelSessionDriverLock` installs it while retaining a default `true` guard, and `NullSessionDriverLock` provides a no-op. The coordinator installs a callback based on records, native leases, and provisional ownership. `control-endpoint.spec.ts` exercises the setter in the release flow; `kernel-session-driver-lock.spec.ts` checks the guarded default and setter. Existing `degradation-audit` comments were retained.
5. **Formatting:** Ran Prettier on all Batch 12 files touched in this round and the platform-core lock/interface/spec files. No formatter errors.

Verification: `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/rpc-handlers,ptah-electron,mcp-bench` was attempted once. Nx exited before checks because the sandbox denied its daemon and plugin-worker Unix sockets (`connect EPERM /tmp/.nx/.../d.sock`). Scoped `ptah_get_diagnostics` returned unavailable after its 45-second compiler limit. A direct Jest run of the focused specs was started separately; see its result in the final lane report.

### Decisions

- Used an explicit setter on the existing lock port, as directed by the orchestrator. It is reversible through a later port migration; no platform host imports agent-sdk.
- Preserved fail-closed production behavior and supplied test-only coordinator fakes at direct construction sites. This is reversible if the test harnesses later use full DI.

Focused Jest result: `chat-session.host-routing.spec.ts`, `chat-session-resume-activate.spec.ts`, and `session-rpc.handlers.spec.ts` passed (192 tests). `session-driver-lock-coordinator.spec.ts` initially lacked the required reflect polyfill; after adding it, that unit suite passed (2 tests). The cross-process spec remains unverified in this sandbox: real kernel control endpoint binding fails with `listen EPERM` on its abstract Unix socket (`\0ptah-ctl-...`). It is expected to run in the orchestrator's unrestricted environment. The spec uses a temporary home for its control key and restores the environment afterward.

Cross-process test detail: The child loads the kernel lock by a relative source path, matching the platform-core cross-process test pattern. A sandbox-only `node:os` mock redirects the parent control key to a temporary home; the child inherits that home. The remaining `listen EPERM` is the sandbox's Unix socket restriction, not an assertion failure in the rebind behavior. Both scoped diagnostics attempts returned compiler-unavailable after 45 seconds.

Final focused unit rerun: `session-driver-lock-coordinator.spec.ts` passed all 3 tests, including record-removal release. The three session/handler spec files passed 192 tests together in the earlier focused run. Full verification and cross-process behavior still require the orchestrator's socket-capable environment.

## Fix round 2

- Moved the cross-process lock contender to `libs/backend/platform-core/src/testing/spawn-driver-lock-holder.ts` and exported it from `libs/backend/platform-core/src/testing/index.ts`. The rpc-handlers rebind spec imports this static testing entry; it has no cross-library source-relative import or dynamic workspace-lib require. Exported `SessionRegistry` from the agent-sdk public barrel because the real registry was otherwise inaccessible to this integration spec.
- Added permissive `driverLock` fakes to the prototype-based `ChatSessionService` harnesses in `chat-continue-codex-resume-once.spec.ts`, `chat-session.native.spec.ts`, `chat-session-persona-resume.spec.ts`, and `chat-slash-command-persona.spec.ts`. A repository search found these four prototype-based harnesses; the 15 direct-constructor harnesses were handled in round 1.
- Annotated the intentional serial-queue rejection recovery in `session-driver-lock-coordinator.ts:64`. The rejected action still rejects to its caller; only the queue tail recovers so the next action can run.
- Prettier formatted all nine source files changed in this round.
- Requested `npx eslint` on the cross-process spec and coordinator: exit 0, no findings. Additional lint on the helper, public export, and four harnesses: exit 0, one pre-existing warning for an empty async generator in `chat-slash-command-persona.spec.ts:28`.
- `npx ts-node tools/degradation-audit/check-degradation.ts`: exit 0; rpc-handlers has 1 unsuppressed site, matching baseline 1 (220 total existing sites across the scan).
- `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/rpc-handlers,ptah-electron,mcp-bench,degradation-audit` was run once. It stopped before project checks because Nx daemon and plugin-worker Unix socket operations returned `connect EPERM` under the sandbox. A focused `npx jest` attempt was blocked by the same Nx socket condition. Scoped Ptah diagnostics for the helper and cross-process spec returned unavailable after the compiler's 45-second limit. The orchestrator must run the filtered verify in its socket-capable environment.

### Decisions

- Used the existing platform-core testing public entry for the child helper. This keeps cross-process setup within the library that owns the kernel lock and avoids a lazy workspace import in rpc-handlers. Reversible by moving the helper to another platform-core testing module.
- Added one `SessionRegistry` public export because the cross-process test requires a real registry and the existing agent-sdk barrel exposed only its lifecycle facade. Reversible if agent-sdk later provides a dedicated testing entry.
- The serial queue's catch is intentional recovery after the prior action has already rejected to its caller, so a `reported` audit marker documents that behavior. Reversible if the queue implementation changes.
