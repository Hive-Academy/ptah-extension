# Batch 6f ROUTING report

## Findings

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/`.

| Finding | Status | Evidence |
| --- | --- | --- |
| B1: unknown IDs / strict native routing | Fixed | `session-runtime-identity.ts:29` returns undefined only for an absent lookup binding, rejects missing/inconsistent bound identities, and validates both session IDs. Both routers select legacy for absent identities and never catch native failures. Regression specs cover tab and pre-metadata Claude IDs, native dispatch and failure propagation. |
| B2: workspace provider admission | Fixed | `routing-agent-adapter.ts:12`, `:76`: admission requires nativeCodex and servingProviderId(config) === openai-codex. Disabled capability never calls the port. Provider lookup errors propagate before either runtime starts. Specs cover disabled/enabled, Codex/other/undefined provider and lookup failure. |
| M2: permanent interrupt block | Fixed (router side) | `session-runtime-router.ts:52`, `:56`, `:63`: interrupt delegates; Claude follow-ups remain allowed after false/rejected interrupts. Native gating delegates to NativeSessionControls.canSendFollowUp, so native turn-end state controls recovery. Removed the router map entirely; releaseSession delegates optional native lifecycle cleanup. Specs cover failure, subsequent native idle, legacy timeout, and release. ADAPTER owns actual native turn-end cleanup. |
| M3 / FM7: cancellation leaves pending native request | Fixed | `session-approval-router.ts:89`: remove ownership, call sink.cancel(threadId, requestId), then notify cancellation. Specs assert cancellation order, true/false sink outcomes, duplicate cancellation and Claude behavior. |
| S2: duplicate identity resolution | Fixed | `session-runtime-identity.ts:29` is the sole resolver. Both routers import it directly. Lookup shape and exported type/error names preserved; no old-path re-export shim. |
| Minor: correlation key | Fixed | `session-approval-router.ts:20` exports sessionApprovalKey and all router operations use it. Specs cover tuple correlation. |
| M4 / minor: session model queries | Fixed (routing side) | `routing-agent-adapter.ts:18`, `:178`: native bindings call native.listSessionModels; legacy/unknown call legacy.getSupportedModels. Global supported/default/API model APIs remain legacy. Specs cover routing and native errors without fallback. |
| Minor: SessionId usage | Fixed within runtime APIs | Resolver, adapter model queries, runtime controls and release use SessionId. Approval addresses retain string IDs because the existing shared approval payload and sink use strings. |

## Export locations / integration contracts

- `session-runtime-identity.ts:7`: SessionRuntimeIdentityLookup (moved; same lookup shape).
- `session-runtime-identity.ts:17`: SessionRuntimeRoutingError (moved; same name and error shape).
- `session-runtime-identity.ts:29`: resolveSessionRuntimeIdentity.
- `routing-agent-adapter.ts:12`: RuntimeAdmissionPort.
- `routing-agent-adapter.ts:18`: NativeChatAdapter extends IAgentAdapter, adding listSessionModels(SessionId).
- `routing-agent-adapter.ts:25`: RoutingAgentAdapter; constructor order is identities, legacy, native, admission, capabilities (capabilities defaults to nativeCodex false).
- `session-runtime-router.ts:15`: NativeSessionControls now requires canSendFollowUp(SessionId); optional releaseSession(SessionId).
- `session-runtime-router.ts:20`: SessionRuntimeRouter.
- `session-approval-router.ts:8`: SessionApprovalAddress; `:13`: CodexApprovalOwnerSink; `:20`: sessionApprovalKey; SessionApprovalReply and SessionApprovalRouter remain exported.
- CodexApprovalOwnerSink exposes respond(unknown): boolean and cancel(threadId, requestId): boolean, plus existing readonly sessionId/contextId fields needed by ownership validation.
- WIRING must update old identity imports/exports to session-runtime-identity.ts and supply admission/native gating. ADAPTER must supply sink cancellation and native session model listing. These cross-lane contracts were reported to the parent with delivered=true.

## Changed absolute paths

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-router.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-router.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-approval-router.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-approval-router.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-identity.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-identity.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6f-routing-report.md`

No other files were edited; no git commands were run.

## Verification

Formatted all eight source/spec files using the workspace node_modules/.bin/prettier --write.

First scoped diagnostics response:

> Source: typescript-compiler — Unavailable.
> TypeScript check still running after 45s. It was not cancelled — retry shortly and the completed result is served from cache.

Second scoped ptah_get_diagnostics response (after final source edits):

> Source: typescript-compiler
> Errors: 18 | Warnings: 0
> Coverage: clean
> Requested files: No diagnostics in the requested files.

The 18 sibling diagnostics are outside lane ownership: index.ts and di/register.ts still use the moved identity exports (with related register spec lookup errors); codex-chat-adapter.ts awaits sink.cancel; codex-chat-adapter.spec.ts awaits the new core listModels mock. They were not edited here. This is NOT a whole-project clean result.

Exactly one scoped test command started:

```text
npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="routing-agent-adapter|session-runtime-router|session-approval-router|session-runtime-identity"
```

Output was filtered with Select-Object -Last 65. At the single completion check the command was still running with no output returned:

> session_id: 14306
> output: ""

No test pass is claimed. No test rerun or status loop was performed. The process remains running; the parent owns authoritative verification and can collect its eventual output.

## Decisions

1. **Admission lookup failures propagate.** Options: propagate, fall back to legacy, or admit native. Evidence: binding decision P6 fix 2 and the task's explicit requirement to avoid silently selecting native on lookup failure. Chosen propagation prevents starting either runtime with uncertain workspace ownership. Reversible by changing this explicit policy and regression test.
2. **Native controls own follow-up lifecycle; router stores no session map.** Options: duplicate a turn-end-aware router map or delegate. Evidence: P6 fix 5 and lane ADAPTER ownership of native turn end. Chosen required native canSendFollowUp plus optional release hook; legacy behavior remains permissive. Reversible contract change, reported to parent for WIRING/ADAPTER.
3. **Preserve approval ownership identity checks.** Options: remove identity checks to use a two-method-only sink type, or retain readonly sessionId/contextId alongside the required methods. Evidence: existing register rejects cross-session ownership and respond validates contextId. Chosen structural interface preserves these checks and adds cancel without importing the concrete sink type. Reversible, but removing validation would require separate authorization.
4. **Retain string IDs at the approval boundary.** Options: force branded SessionId into existing shared approval payloads or retain their established string contract. Evidence: PermissionPromptCancelledPayload and existing sink/address interfaces use string IDs. Chosen no out-of-scope boundary change; runtime/session control APIs use SessionId. Reversible coordinated contract migration.

