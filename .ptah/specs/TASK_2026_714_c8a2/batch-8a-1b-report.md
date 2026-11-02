# Batch 8a-1b — factories and focused specs; incomplete acceptance

Implemented the scoped rpc-handlers factories and tests. This is **not a completed production composition**: strict one-physical-write permission persistence needs a settings transaction API; initial native snapshots, resume lookup, and event callback composition still require host/library integration. Verification was **not run: lock**. Do not treat the authored tests as passing evidence.

## Files (absolute)

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/native-session-controls.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/native-session-controls.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8a-1b-report.md

Only these six files were written. No Electron, fenced config handler, SDK, settings-core, or auth-provider file was modified. No Git mutation or application launch was performed.

## Exported API

All entry-point exports are at `libs/backend/rpc-handlers/src/index.ts:143`. Internal profile and broadcaster classes are not exported.

1. `createCodexChatHostPorts(deps: CodexChatHostPortsDeps): CodexChatHostPorts` (`codex-chat-host-ports.ts:110`). Bind the result to `SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS`.
   - Requires workspace execution resolver, workspace provider, extension/storage paths, host capabilities, webview broadcaster, logger, parity platform, provider info, injected per-session createScope, metadata writer, approval router, per-session event callbacks, resume identity reader keyed by chat session id, ChatStreamBroadcaster-compatible stream method, and session-to-tab lookup.
   - Output extends CodexChatAdapterPorts with `handlePermissionResponse(response: PermissionResponse): boolean`. Electron's response bridge must try it before the Claude permission handler.
   - `readResumeIdentity(sessionId)` must return the full CodexThreadIdentity, not merely SessionRuntimeIdentity. Do not directly bind CodexThreadIdentityStore.read: that method takes a context id, not a thread/session id.
   - Callbacks are explicitly supplied dependencies and bound per session; this batch does not implement the missing concrete event-observer assembly.
2. `createCodexRuntimeAdmission(deps: CodexRuntimeAdmissionDeps): RuntimeAdmissionPort` (`codex-chat-host-ports.ts:76`). Bind to `SDK_TOKENS.RUNTIME_ADMISSION_PORT`.
   - Requires resolver, workspace provider, platform paths, capabilities and webview. Constructs the internal ChatRuntimeProfileService and uses prepare(), exactly as profile() does. No substitution publication.
3. `createNativeSessionControls(deps: NativeSessionControlsDeps): NativeSessionControls` (`native-session-controls.ts:153`). Bind to `SDK_TOKENS.NATIVE_SESSION_CONTROLS`.
   - Requires ISettingsStore, optional app scope prefix (Electron supplies `app.electron`), session-bound `settings(sessionId): SessionControlSettings`, adapter live setters/token/interrupt/slash/follow-up gate, broadcaster and tab lookup.
   - SessionControlSettings contains workspacePath, provider authKey, model, optional effort and permissionLevel. The callback must describe initial effective settings for the current native generation; it must not return focused workspace settings or substitute persisted defaults for live state.
   - Owns serialized live mutation, persistence and rollback. Tracks subsequent successful changes by session token. releaseSession drops its snapshot. Native setters apply to the next turn, so successful changes return nextTurn.
4. `createLegacySessionControlPorts(deps: LegacySessionControlPortsDeps): LegacySessionControlPorts` (`native-session-controls.ts:257`). Bind to `SDK_TOKENS.LEGACY_SESSION_CONTROL_PORTS`.
   - Requires the same store/scope/session settings dependencies plus existing legacy session lookup, model resolver, lifecycle control, slash adapter, broadcaster and tab lookup.
   - Constructs settings persistence and slash-stream draining; the SDK's existing LegacySessionControls remains responsible for legacy live rollback.

Exported dependency/output types: CodexRuntimeAdmissionDeps, CodexChatHostPortsDeps, CodexChatHostPorts, SessionControlSettings, SessionControlPersistenceDeps, NativeSessionControlsDeps, LegacySessionControlPortsDeps. SDK output types remain available from their own public alias.

## Acceptance

Paths below are relative to `libs/backend/rpc-handlers/src/lib/chat/codex-host/` unless otherwise stated. All test references mean authored coverage, not verified passes.

- **Profile builder implemented:** `codex-chat-host-ports.ts:142` uses ChatRuntimeProfileService.prepare(), captures filesystem path observations, and calls buildCodexExecutionProfile. The resolver seed selects model/provider/home. Resume loads full identity, checks thread id and immutable normalized home/workspace/provider. Specs at `codex-chat-host-ports.spec.ts:121,133`. Full production resume lookup remains a dependency gap below.
- **Unsupported options / secrets implemented:** strict option allowlist at `codex-chat-host-ports.ts:91`; rejection precedes resolver, filesystem and builder work. mcpServersOverride is not logged or fingerprinted. It is rejected even when empty. No model-substitution publisher is called. Specs at `codex-chat-host-ports.spec.ts:121,156`. The allowlist intentionally rejects unimplemented SDK options; callers supplying those options will fail closed.
- **Approval presentation implemented:** `codex-chat-host-ports.ts:235` sends existing PERMISSION_REQUEST, AUTO_RESOLVED and PROMPT_CANCELLED messages. String wire ids encode session/context/generation/thread/turn/native request id to avoid collisions. `:277` maps allow -> accept, always_allow -> acceptForSession, deny_with_message -> decline, deny -> cancel. No-reason decline is preserved. Specs at `codex-chat-host-ports.spec.ts:198,223`. Electron bridge wiring is not in this batch.
- **Replacement validation implemented narrowly:** `codex-chat-host-ports.ts:309` accepts only a nonempty command replacement for command approvals, rejecting extra replacement keys. Failure logging uses a fixed message. Other request-kind replacement semantics are not added.
- **Follow-up publishing implemented:** `codex-chat-host-ports.ts:325` awaits the existing ChatStreamBroadcaster drain with the session's tab. Spec at `codex-chat-host-ports.spec.ts:245`. Event callbacks themselves are dependency forwarding, not a finished existing-service composition; this acceptance subitem remains incomplete.
- **Admission matches profile provider:** `codex-chat-host-ports.ts:76`; spec `codex-chat-host-ports.spec.ts:173` checks equivalent resolver inputs and provider result.
- **Native live ownership / effort rollback implemented:** `native-session-controls.ts:162,189` serializes changes, calls native setters and restores the most recent successful live value after save failure. Specs `native-session-controls.spec.ts:60,72`. This depends on a correct initial per-generation settings callback; the existing adapter does not expose that snapshot.
- **Permission scope rollback implemented:** `native-session-controls.ts:110` restores physical setting keys, including undefined/absence, instead of materializing inherited resolved values. A shared per-store queue serializes native/legacy persistence. Spec `native-session-controls.spec.ts:83` fails the second permission write and verifies original key membership and live level restoration.
- **FM-R5 strict one physical write NOT fulfilled for every change:** effort/model with no narrower overrides each write once; native spec `:60`, inactive model `:107`, legacy effort `:117`. A permission operation necessarily writes two existing keys, and broad-scope changes may clear narrower keys. There is one persistence-owner invocation, but this is not the requested one physical settings write. No duplicate RPC persistence was introduced. Needs a transactional store API below.
- **Follow-up delegation / inactive save-only implemented:** `native-session-controls.ts:175,233`; specs `native-session-controls.spec.ts:101,107`. Compact uses the native slash command and broadcaster; interrupt delegates to the native adapter.
- **Narrow exports implemented:** `libs/backend/rpc-handlers/src/index.ts:143`. No internal service classes exported.

## Decisions

1. **Reuse internal profile preparation and public native builder.** Options: duplicate resolver/authorization logic or construct ChatRuntimeProfileService internally. Chosen: construct it. Evidence: chat-runtime-profile.service.ts:130 contains session-specific workspace/cwd, identity and capability inputs. Reversible: yes, without changing SDK tokens.
2. **Reject unknown options before processing.** Options: silently discard SDK-only settings, translate unproved semantics, or reject. Chosen: allowlist/reject, especially mcpServersOverride. Evidence: native builder accepts credential references rather than raw HTTP override credentials. Reversible: add reviewed native translations.
3. **Expose an explicit correlated wire handler.** Options: invent a second frontend transport or use existing PermissionResponse ids. Chosen: existing wire with full correlation encoded in the id. Evidence: PermissionResponse carries only id/decision/reason/modifiedInput; Electron ipc-bridge.ts:416 currently dispatches directly to ISdkPermissionHandler. Reversible: host can later carry explicit correlation fields.
4. **Preserve real scoped values on rollback.** Options: restore resolved defaults or snapshot physical keys using WorkspaceScopeResolver.scopedKeys and ISettingsStore.readGlobal. Chosen: physical snapshot. Evidence: settings-core/scope/workspace-scope-resolver.ts:123 and computed-setting-handle.ts:63-84 define scope writes and clearing narrower overrides. Reversible: replace with a transaction API. No edits to the fenced config files.
5. **Record physical-write limitation rather than claim atomicity.** Existing ISettingsStore supports only one-key writes. The two autopilot keys are consumed separately. Changing their storage shape here would silently break readers. Reversible: batch-write extension plus actual backend implementation.
6. **Keep missing native data contracts explicit.** Initial live settings and full resume identity are required dependencies rather than reconstructed from persisted defaults. Evidence: native adapter's session state is private; public persisted metadata omits context/generation/thread fingerprint. Reversible: add supported SDK accessors/metadata indexing in a library batch.

## Needs a lib batch

- `libs/backend/settings-core/src/ports/settings-store.interface.ts:17`: add an atomic multi-key update/snapshot contract, with corresponding platform-electron backend support. Needed for FM-R5's single physical write and stronger all-key rollback semantics. Currently permission has two writes and scope clearing may add writes. Existing `config-runtime-controls.ts:14` only dispatches runtime/legacy controls; it contains no persistence helpers to reuse. It was read and left untouched.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:110,714`: provide a supported initial/effective settings snapshot keyed by session generation, or a supported open hook that seeds the persistence owner before controls are callable. The new factory requires this information through settings(sessionId); this batch cannot prove a host can populate it authoritatively with current public APIs. Effort rollback tests supply it explicitly.
- `libs/backend/agent-sdk/src/lib/wiring/codex-chat-metadata-port.ts:16` and `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:76`: persisted chat metadata stores only provider/workspace/home binding, not the full CodexThreadIdentity. `libs/backend/codex-runtime/src/lib/codex-runtime-ports.ts:39` reads native identities by context id. Supply a supported session/thread-to-context lookup or persist full identity, then implement readResumeIdentity(sessionId). No guessed context-id equivalence was used.
- Concrete per-session CodexChatEventCallbacks integration remains incomplete. `codex-chat-host-ports.ts:40,141` accepts and forwards it; the factory does not claim to assemble existing result/content/live/compaction observers. Complete this before production binding.

## Needs batch 8a-2

- Register stable results only once the dependency gaps above are resolved.
- Route Electron permission responses through the returned handlePermissionResponse before Claude handling (`apps/ptah-electron/src/ipc/ipc-bridge.ts:416`). Frontend decision mapping agrees with this factory.
- Bind real broadcaster/tab lookup, real initialized metadata writer and approval router, explicit session provider settings namespace, full resume identity retrieval, initial settings snapshots, and concrete callbacks.
- Ensure user-facing behavior for rejected automatic SDK options is reviewed. Native MCP composition is deliberately not fabricated from mcpServersOverride.

## Verification

Exact mandatory command:

`npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns=codex-host`

Result: **not run: lock**. Started at 2026-10-26 09:25:56 UTC, initially behind PID 17484, then behind PID 24212 in the wizard-library-alignment worktree. One completion check still showed the lock after approximately three minutes. Stopped only this queued verifier (PID 9700), after matching its exact command line; did not touch the lock owner. The Nx header never ran, so **a header saying 1 project could not be confirmed**. The supplied selector contains exactly one project. Coordinator must run deciding verification.

Prettier formatted the four new TypeScript files. TypeScript transpileModule reported zero syntax diagnostics for each before the final small snapshot-queue, fixture-path and resume-thread refinements. This is not a typecheck. `git diff --check -- libs/backend/rpc-handlers/src/index.ts` passed; it does not check untracked sources. No test/typecheck/lint success is asserted. No installation, build, serve, dev, e2e, package or Electron run was performed.

## Fix round 1

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/native-session-controls.ts:237,271`: supplied the required third `SlashCommandRunConfig` argument with the real session tab ID for native compact and legacy slash execution. Each path resolves the tab once and shares it with the broadcaster. No types weakened.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/native-session-controls.spec.ts:117`: added parameterized native/legacy coverage asserting the adapter receives `/compact` and `{ tabId }` and the returned stream is forwarded to the same tab.
- Re-read both source files and checked external call signatures, including profile preparation/building, approval routing, broadcasting, settings scope operations and adapter setters. No additional call arity/type mismatches identified by source review.
- Verification: `git diff --check -- libs/backend/rpc-handlers/src/lib/chat/codex-host/` exited 0. Tests, typecheck and `npm run verify` were not run, per the continuation instruction; deciding verification remains with the team leader. Earlier acceptance gaps remain unchanged.

## Fix round 2

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:59`: replaced partial-object logger/router casts with typed Jest auto-mocked class prototypes. Kept full adapter dependency contracts because the host factory passes these dependencies through unchanged. Router response mocking retains its actual method signature.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:88`: supplied complete provider metadata and all capability flags. Used the valid shared ProviderId `ptah-cli`, matching the adapter test convention; execution-profile provider IDs remain `openai-codex`.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:268`: supplied the required messageId on the message_complete event.
- `libs/backend/rpc-handlers/package.json:15`: declared @ptah-extension/codex-runtime with version 0.0.1, matching sibling dependencies.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/native-session-controls.ts:124,195,202`: preserved caught errors as causes for both rollback AggregateErrors and the session-change error. Aggregate error arrays still retain all original failures.
- Verification: reviewed declarations and edited source only. No verify, Nx, TypeScript compiler, Jest, installation, build, or git-state-changing commands were run, as requested. Team-leader verification remains pending.
