# Batch 21 implementation report

## Summary

Implemented separate child/handoff source-account inheritance through the existing account gate, incompatible-provider bypass, and typed refusal preservation through child rollback. Named execution remains release-held under D7. Scoped diagnostics report zero errors and warnings. Specs were written but not executed, as instructed; this is not live named-account certification.

Workspace: D:/projects/ptah-extension/.claude-worktrees/provider-accounts

## Files changed

All paths below are relative to the workspace.

- `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts:145`: optional typed `accountRefusal` on a failed start; existing callers need no new methods.
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:413,456,500,531`: preserve that refusal across the existing host boundary and rollback. No account lookup, lease ownership, DI registration, prompt composition, or success-path payload was added here.
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.accounts.spec.ts:1`: new focused spawner tests for authoritative parent SDK descriptor, typed rollback, ambient success, and child-only cleanup.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:674,686,768,780,1758`: additive result typing preserves account refusals; an internal inherited-source marker limits provider compatibility handling to separate child/handoff launches. Compatible sources still use `gateMainSessionAccount`; non-compatible sources use its existing fresh-provider resolution. Existing continuation/fork/rewind semantics remain intact.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts:356`: new tests reuse the real metadata resolver and existing harness, including the real host adapter calling the service.
- `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:100,158`: pass the descriptor's parent/handoff SDK ID as `sourceSessionId`, with its existing tab identity as fallback when the SDK ID is absent. Use the existing branded ID validator. Preserve the service's already-normalized typed refusal in the returned failure; retain tab announcement/error behavior.
- `.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-21.md`: this authorized deliverable.

No other files were edited. No git command was run. Shared service edits were limited to the stated additive changes; existing TASK_2026_714 work was not rewritten.

## Acceptance mapping

Paths abbreviated here: `rpc/` = `libs/backend/rpc-handlers/src/lib/chat/session/`; `children/` = `libs/backend/cli-agent-runtime/src/lib/session-children/`.

| Rule | Implementation evidence | Spec evidence (written, not run) |
| --- | --- | --- |
| 1. Compatible child inherits A despite default B | `rpc/child-chat-session-host.adapter.ts:100`; `rpc/chat-session.service.ts:686`; existing `rpc/chat-slash-command-router.service.ts:107-139` resolves authoritative original profile/run | `rpc/chat-session.account-binding.spec.ts:366`, `inherits account A despite default B, handoff=%s` |
| 2. SDK subagent remains on owning query | Only separate child/handoff gate calls receive `inheritedSource` at `rpc/chat-session.service.ts:686,780`; SDK subagent/query implementation untouched | Static scope evidence only; no new SDK-subagent execution test in this batch |
| 3. Incompatible provider uses existing resolution | `rpc/chat-session.service.ts:1762` removes inherited-source lookup only for a config-resolved non-Claude route, then delegates to the existing gate | `rpc/chat-session.account-binding.spec.ts:413`, `incompatible provider keeps its existing launch arguments, handoff=%s` compares complete SDK mock calls with the fresh route |
| 4. New default cannot capture descendants | `rpc/chat-session.service.ts:686,780` routes through source lookup; existing gate returns for authoritative absence before default selection | `rpc/chat-session.account-binding.spec.ts:366,405`, `inherits account A despite default B, handoff=%s` and `unbound source ignores a newly named default, handoff=%s` |
| 5. Deleted/unknown/changed binding refuses before content | Existing pre-context gates at `rpc/chat-session.service.ts:686,780`; typed service/adapter results at `:674` and `rpc/child-chat-session-host.adapter.ts:113`; rollback retains refusal at `children/session-spawner.service.ts:531` | `rpc/chat-session.account-binding.spec.ts:378,386,395`: `refuses %s before child content`, `does not replace an unknown parent binding: %s`, `refuses an unknown parent identity before admission`; `children/session-spawner.accounts.spec.ts:58`, `preserves typed %s through rollback and does not touch the parent` |
| 6. Child teardown cannot release parent lease | No parent reservation enters spawner/host input; existing gate releases only its returned preflight reservation (`rpc/chat-slash-command-router.service.ts:144`); child rollback `children/session-spawner.service.ts:495` retains child-only resources | `rpc/chat-session.account-binding.spec.ts:428`, `releases only the child preflight reservation and retains the release hold`; `children/session-spawner.accounts.spec.ts:58,74` checks parent interruption/budget isolation |
| 7. Ambient/default and non-account launch behavior | Source absence prevents retroactive selection; fresh calls retain original gate; SDK launch config and spawner prompt payload unchanged (`rpc/chat-session.service.ts:910`, `children/session-spawner.service.ts:401`) | `rpc/chat-session.account-binding.spec.ts:405,413`; `children/session-spawner.accounts.spec.ts:74`, `ambient success retains the host payload and child-only teardown`; existing explicit-ambient test remains |
| 8. Handoff differs from fresh launch by authoritative source | `rpc/child-chat-session-host.adapter.ts:100,158`; `rpc/chat-session.service.ts:686,780` | `rpc/chat-session.account-binding.spec.ts:442`, `passes the SDK source and retains typed refusal, handoff=%s`, uses different tab/SDK identities and the real service |

The conversation is not dispatched to the SDK on refusal. Existing UI tab announcement precedes admission by design; the tab receives the existing error presentation, and the parent conversation/binding is not mutated. Failed child worktree/link rollback remains the existing behavior.

## Ambient-unchanged evidence

No environment, auth object, SDK configuration, model/profile resolver, MCP prompt construction, or SDK subagent code changed. The spawner passes exactly its existing host payload and does not manufacture `accountSelection` or `accountBinding`. Optional refusal properties are spread only when present, leaving ordinary success/failure objects unchanged. Fresh child/handoff calls without `sourceSessionId` retain the original default-selection gate. For inherited ambient sources, authoritative absence skips a newly named default, as required; the launched SDK argument construction remains unchanged. Incompatible-provider tests compare the complete SDK calls against fresh launch calls. There is additional config/source verification for inherited launches, so this is launch-payload equivalence, not a claim of identical internal lookup counts.

## Existing specs that mock changed members

Searched existing specs across `libs` and `apps` for `ChatSessionService`, `SessionSpawnerService`, `ISessionSpawner`, `IChildChatSessionHost`, and `ChildChatSessionHostAdapter`.

Required coordinator updates (outside this lane's ownership):

- `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.spec.ts:179`: exact expected `startAgentChildSession` argument lacks `sourceSessionId: descriptor.parentSessionId`.
- `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.spec.ts:336`: exact expected `startHandoffSession` argument lacks `sourceSessionId: handoffDescriptor.fromSessionId`.

These are missing expected fields, not missing mock methods. No new required method or DI argument was introduced. Existing mocks remain structurally valid because `accountRefusal` is optional:

- `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.spec.ts`: `startChildSession`, `startHandoffSession`; existing success/failure mocks need no new member.
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts:209`: `gateSessionAccount`; unchanged call contract.
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts`: main session delegates and spawner `listUiDescriptors`; unchanged.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-namespace.builder.spec.ts`: `ISessionSpawner.start/send/status/read/stop/takeHeldCompletions`; unchanged methods.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts:8125`: partial `ISessionSpawner` fake; unchanged required members.

Other matching service specs construct the real service or reference it in comments/DI checks; no additional required mock member was identified. The two out-of-scope exact-argument assertions were not edited or executed.

## Decisions

1. Decision: pass authoritative source identity rather than copy a mutable account selection/binding into the child request. Options: source lookup (chosen), copy selected profile, add a second admission gate. Evidence: D22, D23, the existing server-first/two-store gate and Batch 18/18b reports. Reversible: yes, internal additive wiring. No duplicated admission logic.
2. Decision: determine compatibility using the already-injected path-scoped auth resolver, only for inherited child/handoff calls. Options: native-Claude-only inheritance (chosen), apply parent's Claude binding to every provider, skip the gate for all children. Evidence: Batch 21 rule 3 and the existing gate's `claudeCli` criterion. Reversible: yes. Resume/fork/rewind do not receive the new marker.
3. Decision: carry optional typed refusal through existing structural host return values and the owned spawner result. Options: optional structural extension (chosen), change the unowned host port, discard refusal into a string. Evidence: owned-file restriction and existing optional failure/result conventions. Reversible: yes; no required member, new injection, or public breaking change.
4. Decision: retain the release hold and only settle an unused child preflight reservation. Options: retain D7 (required/chosen), enable named execution/transfer a lease. Evidence: D7/D21/D22 and existing shared gate. Reversible only through the separate authorized certification work; this batch does not enable named execution.

## Deferred/not done

- Tests/typecheck/build/lint/npm/Nx/Jest were not invoked. Runtime test results are not claimed.
- The coordinator must update the two existing exact-argument expectations listed above and run the authorized verification workflow.
- No real sign-in, credential change, paid inference, live parent/child named-account run, or Electron visual test was performed.
- No real adapters were registered for `SDK_NAMED_ACCOUNT_PERSISTENCE` or `SDK_SESSION_IMPORT_BINDING_LOOKUP`. Live SDK lease transfer remains certification work. Successful named preflight still returns `release-held` before content.
- Rule 2 is verified by source scope, not a new SDK subagent runtime test. Full running-child account-lease teardown cannot be certified while named execution remains held; the specs prove unused preflight-reservation isolation and existing child cleanup targeting.
- Host-specific compilation was not separately invoked; only the permitted scoped diagnostics were used.

## Diagnostics result

Called `ptah_get_diagnostics` with the six changed source/spec paths only. First response: TypeScript check still running after 45 seconds, six files unchecked. Retried once after the final source edits. Final response: `Source: typescript-compiler`; `Errors: 0 | Warnings: 0`; coverage `clean`; `0 in requested files, 0 in sibling files omitted`. No other verification command was run.
