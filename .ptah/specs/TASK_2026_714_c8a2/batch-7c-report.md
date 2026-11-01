# Batch 7c report

## Changes

- `handlers/config-rpc.handlers.ts:99`: optional SESSION_RUNTIME_ROUTER injection, typed as SessionRuntimeControls. Default hosts remain supported without bindings.
- `handlers/config-rpc.handlers.ts:207,349,718`: model, permission, effort apply through controls before settings persistence; application failures reject rather than claiming saved success. Existing RPC names and response objects are unchanged.
- `handlers/config-rpc.handlers.ts:354`: permission multi-key persistence snapshots and restores both previous persisted values on failure. Permission default mirroring happens only after successful persistence. Model/effort persistence errors surface as failed RPCs; the applied live value can remain changed. No claim of atomic live/storage rollback is made.
- `handlers/config-runtime-controls.ts:11`: one narrow fallback adapter delegates model/effort and frontend permission names to the existing public SDK methods. No permission alias table or native-to-legacy failure fallback.
- `handlers/config-runtime-controls.spec.ts`: native routing and response shapes, apply-before-save, failed apply prevents save, persistence failure reporting, partial permission-save restoration, null-router frontend yolo/max delegation and persisted max.
- `handlers/config-rpc.handlers.spec.ts`: intentional expectations updated for frontend permission delegation and rejection before persistence on live apply errors.

## Null-router design

Use the existing SDK setter path behind one function. `agent-sdk/src/index.ts:182` exports LegacySessionControls only as a type; `createLegacySessionControls` is not exported. LEGACY_SESSION_CONTROLS is null on default hosts, so injecting it cannot solve the fallback. Importing internals or changing agent-sdk exports would violate this batch's ownership/module boundary. SDK setters already delegate to SessionControl, which shares PERMISSION_MODE_MAP with LegacySessionControls. Consequently frontend yolo invokes SDK default mode and retains per-session yolo; max invokes live xhigh while the RPC persists max. No aliases are duplicated. The RPC result contract does not expose timing; native AppliedSettings (including nextTurn) is deliberately not added to response objects.

The new spec asserts delegation at the public SDK boundary, not a second implementation of the SDK mapping. Wire-level yolo/default and max/xhigh mapping are source-verified in `agent-sdk/src/lib/helpers/session-lifecycle/permission-mode-map.ts` and `session-control.service.ts`; their existing SDK specs remain the mapping owners. This batch does not add a new real-SDK integration fixture.

## Caller audit

Paths below are relative to `libs/backend/rpc-handlers/src/lib/`. All remaining sites are unchanged unless marked changed.

| Caller | Handling / 8a action |
| --- | --- |
| handlers/config-runtime-controls.ts:20,21,22 | CHANGED: only null-router legacy model/permission/effort delegation; frontend names, no SDK aliases. 8a binds router before handlers resolve. |
| handlers/config-rpc.handlers.ts:417 | getActiveSessionIds fallback only for omitted/empty session ID; 8a must supply runtime-neutral active-session selection if native callers omit IDs. Explicit null still changes no live session. |
| handlers/config-rpc.handlers.ts:486,487 | getSupportedModels/getApiModels, intentionally retained global Claude picker. Request type is void, so no per-session request exists to route. 8a/M8 needs a host model source for native sessions without open contexts. |
| handlers/config-rpc.handlers.ts:449 | lifecycle.find permission read remains legacy; controls interface has no read method. 8a must supply native live permission read ownership. |
| handlers/provider-rpc.handlers.ts:449,464,481,509 | API models, SDK models/fallback, native Claude models; 8a audit catalog ownership, retain explicitly Claude lists and provide native source where needed. |
| handlers/provider-rpc.handlers.ts:705,798 | clearModelCache on provider edits; 8a must invalidate native provider/context caches as applicable. |
| handlers/config-scope-rpc.handlers.ts:141 | SDK reset after scope changes; 8a must route context invalidation by runtime/scope. |
| handlers/auth/workspace-scope-methods.ts:114,122 | applyWorkspaceAuthChange/reset; 8a runtime-aware auth invalidation required. |
| handlers/auth/connection-settings-methods.ts:128,135 | applyWorkspaceAuthChange/reset; 8a runtime-aware auth invalidation required. |
| handlers/auth/connection-settings-methods.ts:244,263 | getHealth; 8a account/provider-aware native health source required. |
| handlers/auth/interactive-login-methods.ts:83,234 | reset after auth changes; 8a must invalidate appropriate native contexts. |
| handlers/auth/auth-status-methods.ts:36 | getHealth; 8a native auth status must not report Claude proxy health. |

Search covered all production TypeScript in rpc-handlers for setters, model sources, cache invalidation, auth changes and adapter resets, and SDK_AGENT_ADAPTER injection sites. Auth RPC constructor at handlers/auth-rpc.handlers.ts:109 passes the concrete adapter to the audited auth functions. Chat files are concurrently owned by 7a/7b and were not edited; 6g's existing chat-session/chat-stream-broadcaster audit remains a separate 8a input.

## Verification

Prettier completed for all four TypeScript files.

Scoped ptah_get_diagnostics was attempted before verify and after the final import/comment cleanup. It did not produce usable diagnostics:

> Source: typescript-compiler ? Unavailable.
> TypeScript check still running after 45s. It was not cancelled.
> Coverage: 4 files unchecked.

One authorized verification command was launched (no rerun):

`npm run verify -- -p @ptah-extension/rpc-handlers -- --testPathPatterns=config-`

Output is piped to Select-Object -Last 65. At report writing it has not completed and has emitted no tail output; exec session 92511 remains active. No PASS is claimed. The coordinator's authoritative verify is still required, including host compilation. No paid/live model tests, installs, builds, git operations or user settings writes were performed.

## Decisions

1. **Null-router fallback:** choose a single public-SDK delegation function over internal LegacySessionControls imports, new exports or copied mappings. Evidence: type-only public export, null default binding, shared SessionControl mapping. Reversible: yes, replace with public composition if later exported.
2. **Persistence failures:** surface failed model/effort RPC after applied live change; restore partial permission settings and surface failure. Options: guess prior live state from saved defaults, expand controls with snapshot API, or explicitly surface failure. Saved settings can differ from a native session's actual state, so guessed rollback would be incorrect. Evidence: existing controls have no read/snapshot API and assignment explicitly allows surfaced failure. Reversible: yes, stronger transactions can be supplied at the controls boundary.
3. **Global catalogs:** retain existing legacy sources because config:models-list takes void. Options: invent a session parameter or keep the existing contract. Evidence: handler registration and assignment's P6 fix 20/M8 requirement. Reversible: additive future session model API belongs to host work.
4. **Fence:** proceed despite stale on-disk 7c heading saying blocked. Explicit current assignment states #824 merged and fence lifted; current handler was re-read. Reversible: source edits remain uncommitted.

## Absolute paths changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-runtime-controls.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/config-runtime-controls.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-7c-report.md
