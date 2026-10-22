# Batch 19 implementation report

Implemented the lane account reference and resume-gate plumbing in the five owned files. Named execution remains release-held: the optional authoritative adapter port and pre-prompt checkpoint need Batch 20/host certification integration before production prompt release. No rpc-handlers, auth-providers-tokens, shared types, task state, or git operations were changed.

## Files changed

All paths are relative to D:/projects/ptah-extension/.claude-worktrees/provider-accounts:

- libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts
- libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts
- libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts
- libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts
- libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts (created)

This report is the only task-folder deliverable written.

## Acceptance evidence

- Immutable path-free receipt: cli-adapters/cli-adapter.interface.ts:19 defines the binding plus opaque run/binding id; :31 defines the optional authoritative port; :98 exposes the awaited pre-prompt checkpoint. Manager :720 retains the admitted receipt and SDK id, :726 awaits persistence, rejects rebinding, and :775 carries the committed receipt even when the handle omits its own fields. Handle/reference disagreement refuses at manager :931.
- Account check precedes cost/context work: lane-resume-gate.ts:89 evaluate calls resolveLaneAccountResume before contextFigure. Manager :501 supplies restored linkage and the adapter authority, and carries the result through both resumed and fresh-context outcomes. The authoritative lookup takes only provider and SDK session id, with no parent dependency or local-index fallback.
- Restored state: manager :1380 preserves bindings as immutable parsed copies. Present corrupt values become a safe invalid sentinel, never absence. Live/idle/restored continuation checks begin at manager :1949 before returning the recoverable released outcome; prepareSdkHandleSpawn also uses the same gate.
- Classification: lane-resume-gate.ts:208 resolveLaneAccountResume permits legacy ambient only after authoritative absent. Local named metadata with absent registry, corrupt records, inconsistent receipts, missing registry, unknown baseline, deleted-route/identity refusals and release-held all refuse. Label/default fields are not accepted authority. Known safe error codes are read structurally; raw dependency messages are not exposed by the gate.
- Persistence: wiring/agent-events.ts:452 projects the immutable receipt and SDK id into CliSessionReference. Completion remains optional output/parent-card projection; it never attaches SDK ids or authorizes prompts. Parentless durability is the awaited LaneAccountBindingPort.persistReference contract, not this completion listener.
- Replacement safety: manager :1115 and :2065 scope done callbacks to both record identity and turn generation; output/session callbacks, inactivity/idle timers, delayed exit emission, release completion and TTL cleanup reject replaced records. agent-events ignores stale completion events and rechecks stale persistence attempts before reference writes.
- Concurrency reservation logic remains unchanged. Unbound non-Claude lanes bypass the account registry, including configured ptah-cli ambient semantics.

## Test cases

Created agent-process-manager.account-binding.spec.ts with structural mocks and fake timers, covering:

- Authoritative legacy absence; malformed/null/partial/mismatched references; corrupt registry; missing named linkage; unavailable/missing/throwing registry; safe error handling.
- Missing/deleted route, identity mismatch, unknown baseline and release-held refusal; no ambient retry; original immutable receipt across fresh-context handoff and unrelated label/default changes.
- Registry lookup without local records or a parent; persisted parent-reference roundtrip and restore; corrupt restore refuses before retryable released classification.
- SDK run-option binding propagation; parentless awaited persistence; persistence failure; attempted rebinding before prompt release.
- Live-turn validation; idle-release resume; stale completion, output, SDK-id callbacks, delayed exit and TTL cleanup after replacement.
- Original concurrency cap; all eight existing non-Claude CLI values bypass the account registry; snapshot copies remain immutable.

Tests were authored and typechecked, NOT executed. The caller explicitly prohibited nx, jest, tsc, eslint, build, serve, e2e and package commands; none were run. No sign-in, credential mutation or inference occurred.

## Diagnostics

Final ptah_get_diagnostics scoped to the five owned TypeScript files: source typescript-compiler, coverage clean, 0 errors, 0 warnings (also 0 sibling diagnostics). An earlier mock used flushDelta rather than takeDelta; corrected before the final clean check. No standalone compiler or test runner was invoked.

The requested lane-resume-safety memory search returned no hits. ptah_code_search_symbols returned an empty index; targeted native reads/search followed that fallback. Existing resume-gate and manager restore/guard specs supplied the lifecycle conventions.

## Decisions

1. Add an optional LaneAccountBindingPort on the owned CliAdapter interface rather than changing auth-providers-tokens or adding DI tokens outside scope. Options: adapter seam; out-of-scope provider-port expansion; local cache fallback. Evidence: ProviderAccountAdmissionPort has only admit/release/retain; ProviderAccountService already exposes authoritative lookupRunBinding (:43) and lookupBySdkSession (:53). The local cache option violates the explicit requirement. Reversible API addition; certification must wire it.
2. Use the registry run id as accountBindingId and the existing shared ProviderAccountBinding as the immutable receipt. Options: reuse existing durable shape; invent a parallel lane binding schema. Evidence: provider-account.store.ts AccountBindingLookup returns the immutable run binding, and shared CliSessionReference already owns accountBinding/accountBindingId. No new persisted directory or identity fields. Reversible before release.
3. Preserve corrupt restore evidence as a null sentinel rather than forwarding arbitrary persisted objects or erasing them. Options: safe invalid sentinel; raw object; drop field. Evidence: shared classifyProviderAccountBinding treats null as invalid-bound and undefined as absence. This prevents both ambient downgrade and path exposure in monitor payloads. Reversible projection.
4. Keep current identity/route proof and two-store validation inside the authoritative port, and refuse when it is absent. Options: certify through host-owned authority; derive identity from local lane/default metadata; release named admission early. Evidence: D7/D20/D21/D22 explicitly keep named admission release-held and require registry plus matching durable metadata and live-route identity proof. This batch does not claim to implement those external checks. Reversible once certification supplies the port.
5. Guard lifecycle callbacks by record identity and a weakly held turn token. Options: reject stale callbacks in place; allocate parallel manager/handle paths. Evidence: existing callbacks addressed only agent id, so replacement records could receive stale output/exit/cleanup. WeakMap tokens do not retain deleted records; existing timer cleanup remains. Reversible internal change.

## Out-of-scope changes needed

- libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:101 (Batch 20): expose accountBindings; pass the gated account receipt unchanged; await options.onAccountBinding(receipt, realSdkSessionId) while the prompt gate is closed; stamp the same receipt on SdkHandle. On rejection, dispose/settle the query without ambient retry. Subsequent queued turns must independently revalidate before dispatch. This file was not edited.
- libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:43 and :53: certification adapter can delegate authoritative run/SDK lookup here. Its validateResume implementation must require both registry and matching durable reference, live/nondeleted route, immutable fingerprint/revision/physical identity, and fresh known identity proof across epoch changes. Its persistReference implementation must await SDK attachment plus durable receipt storage for parentless runs. None of these checks may be inferred from the manager's local map.
- libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts:210: current admission port does not expose registry lookup; it was intentionally left untouched. The owned optional CliAdapter seam supplies the Batch 19 boundary instead; absence refuses Claude resume.
- libs/shared/src/lib/types/agent-process.types.ts:75: the public SYSTEM_CLI_TYPES roster still excludes claude. Certification must register/expose Claude before end-to-end system-lane usage; the gate accepts the staged Claude value, and specs explicitly document the cast. This batch does not enable a partially certified public CLI.
- Host wiring must supply the new port before named resume can succeed. Actual filesystem/current-auth checks, both-store durability, and own-query identity certification remain external integration work. Mock tests and clean diagnostics do not certify those implementations.

## Delivery

Absolute report path: D:/projects/ptah-extension/.claude-worktrees/provider-accounts/.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-19.md

Source changes remain uncommitted for the invoking workflow. No runtime tests were executed.
