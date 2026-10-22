# Batch 18 implementation report

Implemented release-held main-session account gates in the assigned services and added mocked regression coverage. **Partial integration, not end-to-end acceptance complete and not certified for named execution.** Fork and active-rewind entry points bypass these owned files; child/handoff callers do not yet provide their source SDK session ID. Those required changes are reported below rather than made outside ownership.

Workspace: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts`.

## Files changed

- MODIFY `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- MODIFY `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`
- CREATE `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts`
- CREATE this explicitly requested deliverable, `.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-18.md`.

No other files were written. No git operations, sign-in, credential changes or inference were performed.

## Acceptance evidence

1. **Fresh selection before account-sensitive context.** `chat-session.service.ts:595` gates before MCP registration and the launch funnel's enhanced prompts, provider/model profile, MCP overrides and output-style activation. `chat-slash-command-router.service.ts:96` validates selection through the existing shared schema. Its `:123` ambient branch makes no account/auth/storage calls; `:129` checks the path-scoped auth method without resolving models or starting proxies. Only native `claudeCli` reads the independent `main` selection (`:131`); explicit named selection never overrides an API-key or third-party provider route. The lane selection is never read or modified.

2. **Authoritative continuation, immutable identity of the selected run.** `chat-slash-command-router.service.ts:107` invokes the existing server-first metadata resolver using `lookupBySdkSession({provider:'claude', sdkSessionId})`, then requires matching local linkage at `:114`. Missing local linkage cannot erase a server binding. Unknown stored identity refuses at `:116`; explicit ambient/different named selections cannot change a bound session (`:117`). Omitted selection carries the original profile and run ID into admission (`:119-139`); no current default or display label is consulted. Truly unbound sessions return before any default selection (`:109`). Missing account-service registration still checks local linkage and refuses a locally bound session.

3. **Refusal before mutation, context or cost.** Central continue gates at `chat-session.service.ts:965`, before folder/context resolution, MCP registration, dead-record cleanup, slash dispatch or sending a prompt. Explicit resume gates at `:1125`, before history and budget loading. The private auto-resume funnel gates at `:1539`, before even the live-stream shortcut. `ensureSessionActiveForRewind` gates at `:1465` before its live shortcut and preserves a typed refusal. These gates do not interrupt the original conversation or broadcast a clear/recovery event.

4. **Slash ownership confirmed.** The actual follow-up slash dispatcher is the assigned `chat-slash-command-router.service.ts`. Its independent gate at `:206` precedes native clear interruption, manual compact admission, enhanced prompts, provider profile resolution and SDK slash execution. No replacement slash service was created. The shared gate is a function in this existing owner, also used by the central service.

5. **Child/fresh-context handoff entry points prepared, caller integration incomplete.** Optional backend `sourceSessionId` fields are declared at `chat-session.service.ts:145,166`; the child and handoff methods gate at `:686,780` before MCP/context. With a source ID, both use the authoritative original binding. The out-of-scope host adapter does not supply that ID yet, so inheritance is not claimed for actual caller paths. Fork and active rewind also remain incomplete, as documented below.

6. **D7 remains held.** `chat-slash-command-router.service.ts:141` propagates the admission port's refusal. Structural code handling and safe summary validation at `:61` preserve `accountRefusal` without converting it into `AUTH_REQUIRED`, logging raw exceptions or offering ambient recovery. No certificate is constructed. A future successful preflight is deliberately NOT sufficient to launch: the current SDK has no transferable pre-admitted lease/live-turn contract. The unused reservation is settled as startup failure and the operation remains release-held (`:142-152`). This is not successful named SDK-context propagation or authenticated identity revalidation; those remain certification/integration work.

All abbreviated source references in this section are under `libs/backend/rpc-handlers/src/lib/chat/session/` in the workspace above.

## Test cases

Created `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts` using neighboring provider-profile and slash-before-resume harness patterns. It uses the real `SessionMetadataStore` binding resolver with mocked storage and admission. No credentials, query process or paid inference are used.

- Explicit ambient keeps the SDK path and adds no account/auth/storage calls.
- Intentional API-key and third-party snapshots are never overwritten.
- Fresh main default is independent of lane selection; explicit named bypasses default.
- Old unbound continuation ignores defaults and rejects retroactive named attachment.
- Active/inactive omitted-selection continuations admit the original profile despite a different current default; authoritative lookup precedes metadata.
- Missing profile, changed route, different/unknown identity and release-held refusals preserve the conversation and prevent context/model/style/MCP/SDK work. These are mocked port refusals, not real sign-out/identity certification tests.
- Explicit ambient/different named selection cannot switch an existing binding.
- Missing/mismatched metadata, unknown baseline and unavailable/invalid authoritative storage refuse without fallback.
- Explicit resume with/without activation gates before history; active/inactive rewind helper gates before resuming.
- Child and fresh-context handoff with a supplied source ID inherit the original account.
- Direct slash and central slash continuation gate before compact admission and dead-session cleanup.
- Unexpected successful admission settles its unused reservation and remains held.
- Structural error-code handling sanitizes unsafe summaries; missing service registration and malformed selections fail closed.

**Not tested or implemented:** actual fork handler gating; active rewind handler invocation of the helper; source-ID delivery by the child/handoff host adapter; successful named prompt delivery; real account mutation/identity validation. These cannot be claimed from the owned-file tests.

## Diagnostics

- Used `ptah_get_diagnostics` scoped only to the changed TypeScript files, including a final request after the last source/spec changes.
- Result: **Unavailable**, source `typescript-compiler`, qualified coverage with all three files unchecked. Tool reason: `TypeScript check still running after 45s. It was not cancelled — retry shortly and the completed result is served from cache.` No clean type-check claim is made. No further polling loop was started.
- `ptah_ast_analyze` on each of the three final files: `parseStatus: ok`, `errorNodeCount: 0`, clean syntax coverage. This is syntax evidence only.
- No Nx, Jest, tsc, ESLint, build, serve, e2e or package command was run, per assignment. Specs are authored, not executed; host compilation is unverified.
- The listed `ptah_code_search_symbols` returned zero hits with an empty index; targeted native search was used after that empty result. Workspace exploration was not performed.

## Decisions

1. **Keep named execution held even if a future port starts returning success.** Options: duplicate/reacquire a lease in the SDK, invent a lease-transfer API outside scope, or settle the unused preflight lease and refuse. Chose the last. Evidence: `sdk-agent-adapter.ts:1183,1653` explicitly refuses named live reuse/slash; Batch 17's `NamedAccountPersistencePort` is a separate boundary and D21 defers its host registration. Reversible when a reviewed transfer/live-turn contract exists. No route certification is manufactured and conversation is never released on preflight alone.

2. **Reuse existing account service, active-provider resolver and metadata resolver.** Options: a new orchestration service/DI token or a shared function in the assigned slash owner. Chose the function to keep the change within the three-file boundary and existing DI registrations (`libs/backend/auth-providers/src/lib/di/register.ts:149-162`). It handles the multiple actual callers without a new registration layer. Optional constructor dependencies preserve construction on older hosts; explicit named or locally bound requests cannot silently fall back when account support is missing. Reversible, additive API change.

3. **Do not retrofit a named route onto an unbound conversation.** Options: use current main default, accept explicit new binding, or retain legacy absence. Chose absence, with explicit named attachment refused. Evidence: acceptance expressly requires old unbound sessions to ignore new defaults and immutable continuation binding. Reversible only with a separately specified migration capability.

4. **Expose local typed refusal/selection extensions without editing shared contracts.** Existing shared chat results lack an account-refusal field and shared requests lack accountSelection. Chose additive local input intersections plus a safe runtime `accountRefusal` result, rather than overloading `AUTH_REQUIRED` and triggering recovery. Existing RPC schemas are passthrough; validation is performed by the gate. The shared declarations/UI still need the out-of-scope work below. Reversible when shared types adopt the fields.

5. **Add optional source SDK IDs but do not infer them from prompts, workspace or the new tab ID.** Evidence: the child/handoff adapter owns the parent descriptor, while the service's existing arguments lack it. Incorrect inference could attach another conversation's account. Caller changes are reported, not made. This additive backend parameter is reversible and must be wired before named handoff is enabled.

## Out-of-scope changes needed

1. **Fork and active rewind bypass the central helper.** `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1383` calls `sdkAdapter.forkSession` directly; gate the original binding before SDK transcript copying/context work. At `:1457-1470`, rewind calls `ensureSessionActiveForRewind` only when the SDK is inactive; active rewind reaches `rewindFiles` without this gate. Move account admission ahead of that conditional for all rewinds. This is the single actual ownership path for these bypasses. No edits were made there.

2. **Carry source identity from the host.** `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:96,151` must resolve/pass the original SDK session ID from the parent/handoff descriptor to the new `sourceSessionId` argument. Gate before outward tab announcement/context preparation where appropriate. Without it, the owned service cannot distinguish an inherited handoff from a genuinely fresh main launch. Do not enable named handoff based on this batch alone.

3. **Complete SDK live-turn/lease-transfer wiring before enabling named execution.** `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1183,1653` still deliberately refuses explicit named reuse/slash. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:313` requires the separately registered `SDK_NAMED_ACCOUNT_PERSISTENCE` adapter. A reviewed contract must carry authoritative bound context, verify current identity/epoch, own the lease through query termination and gate every prompt; then replace the conservative preflight hold at `chat-slash-command-router.service.ts:142`. This batch deliberately does not pass a new reservation into an SDK path that would independently reserve again.

4. **Shared RPC/UI contract.** `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:45,117,127,169,249,283` need `accountSelection` and safe `accountRefusal` declarations. `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:64,82,96` should adopt the shared selection schema at the RPC boundary. Frontend resume/error consumers must preserve transcript and display the safe refusal without a recovery chooser. No frontend ownership path was guessed or edited; locate its registered chat message handlers in the owning batch.

5. **Verification remains outstanding.** The orchestrator must obtain scoped TypeScript diagnostics, execute this spec and relevant adjacent specs under the stated memory limits, and verify dependent hosts. The current tool result cannot certify compilation or runtime parity. All named account admission remains release-held.
