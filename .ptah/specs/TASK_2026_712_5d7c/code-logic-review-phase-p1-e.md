Review family: codex (OpenAI) reviewing Claude (Anthropic) implementers

# P1-E code logic review — TASK_2026_712_5d7c

Score: **6/10**. Verdict: **APPROVED WITH FIXES** for the inspected paths only; reviewer assessment **NEEDS_REVISION**. This is not approval of the complete combined diff.
Blocking: **0**. Serious: **1**. Moderate: **2**. Failure modes: **3**.
Confidence: medium for the findings, low for complete phase coverage.

## Scope and evidence limitations

Reviewed current worktree source using the batch reports as the file inventory. The role's higher-priority prohibition on Git operations prevented the requested diff/stat and baseline comparison. Thus attribution to the exact b7cfb14f4..b022672ac range is not independently verified. The batch-27a report identifies the handler implementation containing all three findings.

Read the provider account RPC handler and schema, Claude ledger source, and MCP spawn schema across source excerpts, plus targeted surrounding implementation in agent RPC, the namespace spawn boundary, account service, runtime registration/adapter, owner discovery, configuration reader, file settings keys and host manifest. Other large files were examined only in relevant sections; they are not approved in full. Consulted context, task description, implementation-plan excerpts, batch reports, D22 and D25–D32 material, the prior P1-D review and root CLAUDE.md. D7's release hold was explicit in the task and implementation documents; no licensing decision was made here.

No nx, Jest, tsc, lint, npm, build, live login or SDK invocation was run. D28/D30/D32 report passing scoped checks; those are implementer/orchestrator evidence, not independently rerun checks. Tests inspected include the provider handler notification and redaction cases. No complete test-suite or all-file certification is claimed.

## Numbered findings

### 1. Serious — request-id replay becomes a second account creation after eviction or restart

- Location: `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:282`, `:416`; `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:107`.
- Failure scenario: an add request commits but the response is lost. After 256 subsequent remembered writes, or a host restart, retry the identical request ID and payload. The in-memory entry is gone, so the handler calls add again. Add allocates another random UUID and persists another profile. There is no expected profile revision on add to stop this replay.
- Impact: one logical request creates two account records instead of returning its original outcome. The public contract promises duplicate submissions return the same outcome (`libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:13`) without defining a 256-request/process-lifetime retry window.
- Suggested fix: store the request identity and committed result atomically with the mutation, with an explicit retention/expiry contract. An expired request must be distinguishable from a new request and must not silently execute again. Add restart and ledger-eviction replay coverage.
- Existing evidence: batch 27a explicitly documents the bounded in-memory ledger. That documents the implementation, but does not narrow the public idempotency promise.

### 2. Moderate — committed mutation can permanently miss its change notification

- Location: `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:302`, `:310`, `:315`, `:318`, `:290`.
- Failure scenario: apply succeeds, then list/selection fails while assembling the snapshot. The revision has advanced, but execution returns before notify. The refusal is remembered; retrying the same ID after storage recovers only replays that refusal.
- Impact: another connected consumer receives no invalidation for the committed change, even after recovery. This breaks the once-per-committed-snapshot push contract at `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:117`. The initiating caller does receive truthful “may have been saved” copy; this finding is about missed propagation, not a false rollback claim.
- Suggested fix: retain a committed-but-not-published outcome, then recover its snapshot and publish once without repeating the mutation; alternatively introduce an explicit revision invalidation event and recovery contract. Test a post-commit read failure separately from a failed broadcast.
- Existing coverage: `provider-account-rpc.handlers.spec.ts:519` tests a broadcast failure after a snapshot exists, which does not exercise this earlier failure.

### 3. Moderate — clock-based revision is not monotonic across host instances

- Location: `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:139`, `:307`; `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:103`.
- Failure scenario: a renderer retains revision R, the wall clock moves backward, and the host restarts. The new handler seeds a revision below R. Successful mutations can then produce snapshots a conforming consumer discards as stale. A rapid sequence of increments followed by a sufficiently fast restart has the same ordering issue.
- Impact: the stated cross-restart monotonicity guarantee does not hold. This is a contract failure for the upcoming subscriber; this review did not establish that an existing renderer currently implements that stale-snapshot filter.
- Suggested fix: persist a transactional monotonic revision, or introduce a host-generation identifier and specify how reconnect replaces the prior generation. Verify clock rollback and restart independently of ordinary sequential writes.
- Distinction from D30: D30 already records that out-of-handler writes do not bump the revision. This finding concerns ordering even for writes that do pass through the handler.

## Five logic questions

1. **How does this fail silently?** F2 leaves other consumers unaware of a committed change (`provider-account-rpc.handlers.ts:315`); F3 allows a conforming subscriber to discard valid new state (`:139`). The initiating F2 caller is explicitly warned.
2. **What user action produces unexpected behaviour?** Retrying an add after reconnect/restart or ledger eviction can add a second profile, F1 (`:282`, `:416`).
3. **What input data produces a wrong answer rather than an error?** A previously successful requestId and identical add payload, after its entry expires, is treated as new work (F1). A retained revision greater than the new clock seed makes valid snapshots appear stale (F3).
4. **What happens when a dependency fails or returns an invalid shape?** The read-only binding adapter maps missing, thrown and unknown-status lookup results to unavailable-storage (`libs/backend/cli-agent-runtime/src/lib/di/register.ts:111`); bound results are revalidated at `:121`. Agent RPC similarly catches a failed lookup and returns unavailable-storage (`agent-rpc.handlers.ts:1519`). Post-commit snapshot failure remains F2. No bounded timeout was established for the awaited RPC lookup at `:1523`; this remains unverified rather than a claimed reproduced hang.
5. **What is missing from the requirements?** Retry lifetime and restart semantics (F1), recovery ownership after commit-before-publication (F2), and revision generation/reset semantics (F3) need explicit contracts.

## Traced boundaries and remaining uncertainty

| Path | Evidence and result |
| --- | --- |
| RPC parse → workspace authority → write | Strict schemas precede handler execution (`provider-account-rpc.handlers.ts:230`); open workspace validation occurs before apply (`:278`, `:343`). Rename/remove/selection forward expected revisions at `:169`, `:175`, `:182`, `:195`. SQL CAS internals were not re-reviewed in full. |
| Write → retry ledger → snapshot → push | Synchronous commit prevents await-based interleaving within one instance (`:289`); F1–F3 cover the lifecycle gaps. |
| Sign-in/out/cancel | All three register to releaseHeld (`:204`), which returns fixed release-held text without invoking account actions (`:329`). No live login was attempted. |
| Named launch and ambient resume | `cli-adapters/claude-cli.adapter.ts:288` requires available full persistence; read-only bindings return absent unchanged and refuse bound validation with release-held (`di/register.ts:119`, `:134`). This supports D7 in the inspected seams, not an audit of every possible runner entry. |
| RPC resume selection | Supplied selection is compared before folder lookup/spawn (`agent-rpc.handlers.ts:1378`, `:1497`); absent/omitted retains the existing path at `:1494`. Stored bindings are revalidated at `:1528`. |
| MCP/namespace selection | Named selections refuse before spawn (`agent-spawn-args.schema.ts:51`); namespace validation is strict (`agent-namespace.builder.ts:189`). Ambient/omitted is deliberately stripped at `:461`. D32 owns forwarding in Batch 34; this is not certified for future enabled named routes. |
| Claude config → runtime reader | Model writes use the model-key loop (`agent-rpc.handlers.ts:805`), effort writes at `:874`, and both use workspace configuration at `:1753`. File routing includes both Claude keys (`file-settings-keys.ts:122`). Runtime maps model/effort (`agent-spawn-environment.service.ts:66`, `:116`) and reads that same namespace (`:166`, `:130`). Complete platform persistence adapters were not re-reviewed. |
| Electron capability and singleton | Manifest requires providerAccounts (`host-profile/manifest.ts:518`); default is false (`host-profile.ts:86`), Electron sets true (`apps/ptah-electron/src/rpc-host-profile.ts:51`); shared registration uses registerSingleton (`register-shared-rpc-handlers.ts:104`). No independent smoke run. |
| Usage ledger | Physical directory identity keys routes (`claude-ledger.source.ts:20`), reader prefixes are removed before route/event keys (`:156`), unreadable roots yield partial status (`:170`). D27's ambient/named same-directory double count and absent production observeRoute caller remain deferred certification risks. |
| Owner query | Named discovery captures query/binding and rechecks record/query/binding after awaiting identity (`plan-limit-owner-discovery.service.ts:509`, `:521`); ambient native-session discovery excludes bound sessions (`:699`). Full owner resolver, reader and all lane caller files remain outside complete coverage. |

## Decisions

- Preserve the release hold. Options: infer authorization or retain refusal; task D7 and the inspected gates require refusal. No change made; any release decision remains reserved.
- Treat explicit D27/D30/D32 deferrals as tracked residual work, not new regressions. Distinct lifecycle violations remain findings. Reversible through certification evidence.
- Keep score at 6 rather than 7–8 because the public idempotency and notification/revision contracts have concrete gaps. Do not score 3–4: the inspected validation and release gates have substantive implementations, and no live named-account bypass was established.
- Do not approve the unexamined combined diff. A complete phase review still needs the diff inventory, full remaining source coverage and coordinated verification. The conditional verdict applies only to inspected paths and requires the findings to be resolved or the contracts explicitly narrowed by the owner.

