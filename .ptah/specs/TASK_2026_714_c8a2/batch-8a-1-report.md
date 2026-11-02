# Batch 8a-1 — partial implementation; public-export blocker

This is NOT a complete native chat composition. The infrastructure factories are implemented; chat adapter ports, admission and persistence-owning controls are not. Do not bind the partial identity/capability set: guardRuntimeComposition requires all four runtime bindings together. No container wiring or library files were changed.

## Files

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\codex-runtime-composition.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\codex-runtime-composition.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8a-1-report.md

## Exported API for 8a-2

All implementation references below are relative to the worktree root. C = apps/ptah-electron/src/di/codex-runtime-composition.ts; S = its .spec.ts sibling.

- `createElectronCodexRouting(input: ElectronCodexRoutingInput)` returns a frozen `{ devRoute, capabilities }`. Keep one returned capabilities object for eventual `SDK_TOKENS.RUNTIME_HOST_CAPABILITIES` registerInstance. Inputs require `isPackaged`, `env`, and `platform`; pass `app.isPackaged` and `process.env` directly. C:28.
- `createElectronCodexExecutable(expectedManifestRow: CodexExecutableManifestRow, bundledRoot: string)` returns `{ resolvedPath, expectedManifestRow }`. No standalone SDK token; feeds scoped runtime registration. The host must provide its absolute bundled node_modules root, using app.asar.unpacked for packaged Electron. Global resolver fallbacks outside that root are rejected. C:42.
- `createElectronCodexScopeFactory(input: ElectronCodexScopeInput): (sink: ApprovalSink) => CodexChatScope`. Supplies the eventual `CODEX_CHAT_ADAPTER_PORTS.createScope`. Input includes parent, platform, packaging/environment, manifest, bundle root and runtime ports excluding sink/executable/devRoute. Each invocation registers a separate child runtime. C:73.
- `createElectronCodexIdentityLookup(...args: Parameters<typeof initializeSessionRuntimeIdentityLookup>)` returns `Promise<InitializedSessionRuntimeIdentityLookup>`. Await once, retain/dispose its owner, and eventually registerInstance under `SESSION_RUNTIME_IDENTITY_LOOKUP`. C:112.

There is intentionally no misleading full-composition API and no instance to bind to CODEX_CHAT_ADAPTER_PORTS, RUNTIME_ADMISSION_PORT, LEGACY_SESSION_CONTROL_PORTS or NATIVE_SESSION_CONTROLS yet.

## Acceptance 1-8

1. **Infrastructure implemented, not wired.** C:42 resolves the native package binary without a detected CLI fallback, rejects paths outside the explicit host bundle root, and C:76 rejects an identity describing another executable. C:73 registers per-session child containers. C:98 closes runtime, then usage, then container even if close rejects; disposal is idempotent. S:90 exercises rejected native open followed by cleanup; S:126 covers failed close. The existing adapter calls scope disposal in failed-open cleanup at libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:331. Host pin discovery and manifest supply remain 8a-2 dependencies.
2. **Implemented at factory boundary.** C:28 passes packaging and environment verbatim to readCodexDevRouteOverride, with no coercion/default. Capability uses the parity gate plus the chat-only override. S:60 tests native-off; S:65 packaged override rejection; S:71 tests native development chat while gateway/lane resolvers still reject. Literal app/process input wiring is 8a-2 work.
3. **Existing core logic retained, host reader not wired.** Scope registration accepts the existing usage port and owns client closure. libs/backend/codex-runtime/src/lib/codex-account-usage-client.ts:225 subscribes separately for each explicit home; :233 clears that home's cache on auth change; :215 closes watchers. No second default-home-only invalidation path was added. A concrete Electron auth reader/profileForHome binding and an integration test remain necessary. Tests here use usage:null and do not prove auth-event integration.
4. **Not implemented.** No profile() factory or model notice publisher was added. The required ChatRuntimeProfileService exists only behind internal barrels, and the task explicitly says to stop when a needed symbol is not publicly exported. A follow-up must build validated profiles from the resolver's Codex seed, preserve native resume identity, reject unsupported options and avoid logging/fingerprinting mcpServersOverride. There is consequently no profile/no-duplicate-notice test in this batch.
5. **Blocked by public exports; stopped this part as instructed.** ChatStreamBroadcaster is exported at libs/backend/rpc-handlers/src/lib/chat/streaming/index.ts:8, and ChatRuntimeProfileService at lib/chat/session/index.ts:25. The package entry point libs/backend/rpc-handlers/src/index.ts:120 exports only CHAT_TOKENS and registerChatServices from chat. No deep import, copied broadcaster, alternate permission transport or library modification was introduced. Presentation/replacement/callbacks/publish remain unimplemented.
6. **Not implemented.** No raw native setters were bound as persistence-owning controls. The SDK adapter's private session map (:120) and setters (:714, :734) do not expose an authoritative rollback snapshot. Completing this needs a host-owned initial-settings/state bridge plus real scoped persistence; a public bridge may be useful but is not proven to require a library change. Exactly-once writes, effort rollback, previous permission-scope restoration, inactive save-only behavior and canSendFollowUp delegation remain work, and their requested tests are absent. This is an incomplete acceptance item, not a claimed pass.
7. **Not implemented.** Legacy persistence and slash streaming composition remain pending with the broadcaster export repair. Reusing the exported LegacySessionControlPorts contract alone would merely pass the missing implementation to the caller. No such pass-through factory was presented as completed host wiring. Follow-up must implement settings persistence with applyTo and partial permission-write restoration, then construct ports from actual existing services.
8. **Not implemented.** Admission must share the completed profile resolver path. No independent provider decision was introduced while profile composition is blocked.

## Decisions

1. **Stop at missing public symbols.** Options: deep imports, duplicate streaming/permission plumbing, or report the export blocker. Chosen: report and retain only concrete infrastructure. Evidence: rpc-handlers public entry point :120 versus internal service exports. Reversible: yes; export a reviewed composition surface in a library batch and finish the host factories.
2. **Reject global binary fallback.** Options: trust the resolver's first result or require it to lie under the host bundle root. Chosen: explicit root containment. Evidence: codex-native-binary-path.ts:148 onward also probes global npm installations. Reversible: yes. Root is a trusted composition input, not a user preference; symlink aliases are not canonicalized by this wrapper.
3. **Preserve native cache ownership.** Options: duplicate auth-file listeners or retain the usage client's per-home subscription. Chosen: existing client, closed by the child-scope owner. Evidence: codex-account-usage-client.ts:225-233. Reversible: yes.
4. **Do not bind partial composition.** Options: let the guard reject at startup or leave all host registration to 8a-2 after missing ports exist. Chosen: no registration edits. Evidence: registerCodexChatServices and guardRuntimeComposition all-or-none contract. Reversible: yes.

## Needs 8a-2 or a lib batch

- Export a supported broadcaster/profile/permission composition surface from libs/backend/rpc-handlers/src/index.ts:120. Existing internal exports are at lib/chat/streaming/index.ts:8 and lib/chat/session/index.ts:25. This is the explicit stop condition from acceptance 5.
- Finish profile, admission, presentation, replacement, callbacks and stream publishing after that boundary is available. Inspect libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:101 for shared resolver inputs. Do not publish substitution notices from adapter profile().
- Finish both persistence-owning control factories before wiring. Snapshot actual model/effort and permission scope; restore prior scope membership, not resolved values as explicit settings. SDK native setters at codex-chat-adapter.ts:714-738 are insufficient by themselves. Preserve the single-owner contract in batch-7d-b-report.md.
- Supply reviewed manifest/binary identity, bundle root, process spawner, clock, identity store, logger and explicit-home auth reader. Bind complete stable instances only after awaited identity initialization; keep runtime registration inside the session scopes.
- Add missing profile/no-notice and native exactly-once/rollback tests. Validate usage invalidation with real host auth events. The six infrastructure tests do not substitute for these acceptance tests.
- Run deciding verification on the final tree. Existing changes in batches.md and frontend chat files were observed but not edited by this task.

## Verification

Exact authorized command: `npm run verify -- -t test -p ptah-electron -- --testPathPatterns=codex-runtime-composition`.

Result: **not run: lock**. The verifier queued at position 3 behind PID 14052 in the empty-state-redesign worktree. One completion check still showed that lock. The queued verifier process (PID 39760, matched by its exact command line) was stopped; the lock owner was left untouched. No test, lint or typecheck success is asserted. The team leader must run the deciding verification.

`git diff --check` returned success during implementation; it does not validate untracked TypeScript files. No installs, app launch, builds, workspace-wide checks or Git mutations were performed.
