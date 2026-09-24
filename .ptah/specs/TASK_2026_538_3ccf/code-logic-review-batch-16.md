# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 2 |

Verdict: NEEDS_REVISION

Batch 16, Task 16.1: review of `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md`, read in full. The handoff covers the requested architecture changes and carry-forwards, but its result/push reconciliation advice can silently leave the renderer at the wrong state while claiming the current revision. Its anonymous-caller summary also conflates three different outcomes.

The 6/10 score reflects substantial correct, usable contract coverage with a consequential integration defect. It is below the sound 7–8 band because following the explicit reducer instructions can lose committed state (F1), and above the significant-problems 3–4 band because the delivered APIs, plan mapping, budgets, deadlines, exports, and recorded decisions otherwise match the examined sources.

### Scope and verification

- Reviewed Task 16.1 and all its carry-forwards (`batches.md:2110–2155`), Req 12 (`task-description.md:414–433`), the handoff outline (`implementation-plan.md:886–914`), and the complete `context.md`. These task-local filenames refer to `.ptah/specs/TASK_2026_538_3ccf/`.
- Read the actual 494 plan at `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/.ptah/specs/TASK_2026_494_ca38/implementation-plan.md`, especially D1–D7 and Components 3–5, 7–8, 10–11. References to `494-plan` below mean this exact read-only file.
- Checked delivered file/symbol references against the current worktree identified by the caller as HEAD `7eaceb503`; inspected the RPC contract and handlers, surface types/catalog/barrels, and the relevant commit, state, namespace, ledger, reader, transport, deadline, and adapter implementations. This is a documentation review, not approval of every supporting source file or a historical diff audit.
- Native searches found no production definitions of `DashboardSessionStore`, `DashboardRpcHandlers`, `ChatDashboardSelectionInjectorService`, `recordDelivered`, or `surface:release`, and no `rpc-dashboard.types.ts`. Those are correctly presented as unbuilt/replaced 494-plan names (`handoff-494.md:90–100,257–259`; `494-plan:486–542`). The renderer `trust-boundary.spec.ts` is a future file explicitly planned at `494-plan:608–629`, not a missing delivered file. The shortened old 494 worktree name is absent; the suffixed path supplied by the caller exists (`handoff-494.md:4–6`).
- `ptah_search_files` returned no `AGENTS.md`; native instruction-file discovery found no root/directory `AGENTS.md` or `CLAUDE.md`. No task-local `code-style-review.md` exists. Used the supplied project guidance. No Ptah file-content reader was listed, so content reads used native tools.
- Scoped `ptah_get_diagnostics` to the Markdown handoff. It returned **Unavailable**, reporting that its TypeScript compiler check was still running after 45 seconds. No passing diagnostics are claimed. No build, test suite, Git command, source edit, or 494-worktree write was performed. Static source tracing is the verification for this documentation batch (`batches.md:2107–2108`).

## Five logic questions

### 1. How does this fail silently?

F1: the renderer is told to adopt a successful mutation's revision (`handoff-494.md:182`) and discard any non-delete push at an equal/lower revision (`:61`). The assertion that this handles either result/push order (`:160–162`) is false: the result contains only status, operation id, and revision, not the committed content (`libs/shared/src/lib/types/rpc/rpc-surface.types.ts:99–103`). A renderer can therefore discard the only message carrying state it has not applied.

### 2. What user action produces unexpected behaviour?

Editing an input while a non-conflicting agent update is outstanding can trigger F1. The host accepts the older UI base if its path does not conflict (`libs/backend/vscode-lm-tools/src/lib/surface/surface-ui-mutations.ts:285–299`), commits at current revision plus one, and pushes ops based on that actual predecessor (`libs/backend/vscode-lm-tools/src/lib/surface/surface-commit.ts:97–124`). Adopting the reply's revision before applying those states can hide both the missed agent update and the needed gap recovery.

### 3. What input data produces a wrong answer?

F1 occurs with entirely valid input; malformed payloads are unnecessary. For example, local revision 10 has `{a: old, b: old}`. The host changes `b` at revision 11, then accepts the UI change to `a` based on revision 10 and commits revision 12. If the revision-12 RPC reply arrives first, the documented reducer can label the old `b` value as revision 12 and drop both pushes. Even optimistic application of `a` does not recover `b` (`handoff-494.md:61,157–162,182`; `surface-ui-mutations.ts:285–299`; `surface-commit.ts:103–124`, with the latter two files under `libs/backend/vscode-lm-tools/src/lib/surface/`).

### 4. What happens when a dependency fails?

The timeout guidance correctly separates the 30-second RPC timeout from the host's 120-second dispatch deadline (`handoff-494.md:188–197`; `libs/frontend/core/src/lib/services/claude-rpc.service.ts:135,154–165`; `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:98–103,184–204`). A deadline yields one indeterminate outcome; it does not cancel or resend the underlying send (`surface-submit-turn.service.ts:312–329`). Missing surface state raises the documented error (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:324–327`). F2 concerns missing caller scope: its actual outcomes vary by operation, unlike the handoff's blanket render-only statement.

### 5. What is missing that the requirements never mentioned?

The handoff needs an explicit distinction between **the revision acknowledged by an RPC result** and **the revision of content actually materialized in the renderer**. No such distinction or atomic state-application precondition accompanies the equal-revision drop rule (`handoff-494.md:61,160–162,182`). Req 12 asks for correct patch/gap recovery (`task-description.md:424–425`); F1 demonstrates why a single loosely defined “local revision” is insufficient.

## Failure modes

### F1 — Blocking: an acknowledgement advances the reducer past unapplied state

- Trigger: a change/select RPC result arrives before its state push, particularly when another non-conflicting host commit preceded it.
- Symptom: the UI reports the current revision/success while displaying stale bound values or selection; later ops can be applied to a base that never actually existed locally.
- Evidence: `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md:61,160–162,182`; `libs/shared/src/lib/types/rpc/rpc-surface.types.ts:99–103`; `libs/backend/vscode-lm-tools/src/lib/surface/surface-commit.ts:103–124`; `libs/backend/vscode-lm-tools/src/lib/surface/surface-ui-mutations.ts:285–299`.
- Current handling: the handoff says an equal-revision echo is safely stale in both orders, and says to adopt the RPC revision. The host response does not supply a replacement state; the push carries the committed ops and `fromRevision`.
- Recommendation: retain the revision of the last fully applied snapshot/ops/read as the reducer revision. Record RPC acknowledgement and operation status separately. Advance the reducer only while atomically applying validated state. Apply a matching echo against the materialized predecessor, or recover a predecessor gap with `surface:read`. An equal-revision push is discardable only if that revision's state was already applied. Cover result-before-push, push-before-result, a skipped non-conflicting agent write, and a newer push followed by an older RPC result.

### F2 — Moderate: anonymous callers are promised the wrong fallback result

- Trigger: the MCP URL has no caller session id and the agent requests a patch, delete, or state read.
- Symptom: an implementer following the note expects render-only text for every anonymous call, but patch/delete are unavailable and reads are not-found. Fallback/error handling and scope-diagnostic expectations would be wrong.
- Evidence: `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md:107–110`; `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.ts:108–120,188–192`.
- Current handling: the code returns `render-only` only for validated anonymous create/replace snapshots; anonymous patch/delete return `unavailable` with `surface state unavailable for this caller`; anonymous get-state returns `not-found` with `no surface state for this caller`. None stores state.
- Recommendation: replace the final sentence of D4's scope bullet with this three-way matrix. Keep the HTTP rule: body `_callerSessionId`, `_callerAgentId`, and `_callerWorkspaceRoot` are discarded and assigned solely from URL extraction (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:368–381`).

## Blocking issues

### F1 — Separate acknowledged and materialized revisions

- File: `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md:160–162` (also `:61,182`).
- Scenario: the reply is consumed before the echo; a missed non-conflicting agent write makes the divergence persist even with an optimistic local edit.
- Impact: the 494 implementation can silently show stale data as current, bypass gap recovery, and submit host values different from those displayed.
- Fix: revise all three instructions together using the materialized-state invariant and the reconciliation cases described above. The issue is in the handoff, not a request to change the host wire contract.

## Serious issues

None supported by this review.

## Moderate and minor issues

- **F2, Moderate:** correct the anonymous-caller matrix at `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md:110`; source branches are `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.ts:108–120,188–192`.
- No additional style/naming findings. No speculative defects counted.

## Data flow

1. **OK — agent scope:** HTTP discards reserved body caller fields and derives scope from the URL (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:368–381`). **F2** is in the explanation of the subsequent anonymous branch.
2. **OK — v1 convergence:** the builder selects `createDashboardSurfaceBridge` when state is registered (`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:858–863`); the bridge calls `recordV1Proposal` (`libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.ts:5–15`), and `v1SurfaceId` prefixes the spec id (`libs/backend/vscode-lm-tools/src/lib/surface/surface-agent-mutations.ts:120–122`).
3. **OK — stored mutation and push:** commits validate/apply ops, advance the host revision, and send the actual predecessor and ops (`libs/backend/vscode-lm-tools/src/lib/surface/surface-commit.ts:97–124`; `surface-state.service.ts:567–590` in the same directory).
4. **OK — routing and lazy intake migration:** the new payload provides `routingId`, `surfaceId`, host `revision`, `change`, and operation metadata (`libs/shared/src/lib/types/messages/payload-map.ts:249–264`). Switching D3's eager dispatcher and lazy intake is consistent with `494-plan:157–170,330–372` and `handoff-494.md:41–66`.
5. **GAP F1 — renderer reconciliation:** the reply/echo instructions confuse knowing a committed revision with possessing that state (`handoff-494.md:160–162,182`). The otherwise correct `fromRevision` recovery rule at `:54–56` cannot run if the push has already been dropped as equal/stale.
6. **OK — UI channel:** the five methods, strict request boundary, and method registration are implemented (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:115–153,352–374`; `libs/shared/src/lib/types/rpc.types.ts:2220–2237,3853–3857`). D4 correctly removes the planned v1 store/RPC/injector work (`494-plan:486–542`; `handoff-494.md:89–105`).
7. **OK — submit lifecycle:** reserve, dispatch, and settle are wired (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:280–288`). Settlement preserves the turn outcome when the surface can no longer record it, and the result maps absence of a revision to `surfaceState.kind = 'not-recorded'` (`:462–482`; `libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts:357–401`).
8. **OK — removal:** eviction pushes use the high-water revision, potentially equal to the victim's current revision (`libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts:655–665`). Agent deletion uses current plus one (`surface-agent-mutations.ts:249–253` in the same directory); recreation starts above both committed and retired revisions (`surface-state.service.ts:454–460`). The handoff's eviction exception is present and accurate (`handoff-494.md:199–204`).

## Requirements fulfilment

| Requirement/check | Status | Gap or evidence |
| --- | --- | --- |
| Req 12.1a / D3 message, payload, snapshot/ops and gap recovery | PARTIAL | Names and mappings match; F1 invalidates the claim about result/echo ordering. `handoff-494.md:23–66,160–162`; `494-plan:143–170` |
| Req 12.1b / D4 replacement channel and obsolete 494 services | PARTIAL | Five methods and removed store/injector work are correct; F2 misstates anonymous behavior. `handoff-494.md:68–110`; `494-plan:172–217,486–542` |
| Req 12.1c / 13 kinds, binding, validation, submit and operation states | PARTIAL | Required subjects are all present at `handoff-494.md:112–222`; F1 affects the renderer state model. Kinds/fields: `libs/shared/src/mcp-apps-contracts/surface.types.ts:24–111`, `surface-catalog.ts:23–66` |
| Markup proof transferred to renderer | COMPLETE | `handoff-494.md:206–212`; transport-only fixture at `libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts:95–114`; literal shared fixture at `libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts:605`; matches `494-plan:608–629` |
| Req 12.1d / Component 7 delivered | COMPLETE | `handoff-494.md:224–234`; Electron enumeration `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:72–73`, live-window check `apps/ptah-electron/src/ipc/ipc-bridge.ts:188–190`, window getter `apps/ptah-electron/src/activation/bootstrap.ts:131–147`; CLI enumeration `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:51–52` |
| Req 12.2 / unaffected D1, D2, D5, D6, D7 | COMPLETE | `handoff-494.md:236–243` preserves the architectural decisions while identifying state/API/import changes; compare `494-plan:100–141,219–277` |
| Both contract subpaths and plain-type entry | COMPLETE | `handoff-494.md:9–21`; `libs/shared/src/index.ts:35`, `libs/shared/src/mcp-apps-contracts/surface.index.ts:12–118`, `libs/shared/src/mcp-apps-contracts/index.ts:28–111`, `libs/shared/package.json:26–32`, `tsconfig.base.json:180–184` |
| Submit result and unsupported/rejection carry-forwards | COMPLETE | `handoff-494.md:164–175` matches `libs/shared/src/lib/types/rpc/rpc-surface.types.ts:136–172,195–205`; stale-before-action refusal and select-as-action `undeclared` at `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:441–458` |
| Equal-revision eviction-delete exception | COMPLETE | Explicit at `handoff-494.md:199–204`; source `libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts:655–665`. This correct exception does not resolve F1 for ordinary ops. |
| Deadline, polling, indeterminate ordering caveat and stale comment follow-up | COMPLETE | `handoff-494.md:188–197,262–263`; constants and behavior at `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:98–103,128–136,184–204,312–329` |
| Read limits and escaping | COMPLETE | `handoff-494.md:214–218`; 548 KiB at `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:109–117`, 40 KiB minimum at `libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.ts:131–153`, escaped output at `:384–386`; complete RPC shape at `libs/shared/src/lib/types/rpc/rpc-surface.types.ts:89–96` |
| 128-records-per-tab ledger warning | COMPLETE | `handoff-494.md:147–149`; budgets at `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:123–133`, refusals at `libs/backend/vscode-lm-tools/src/lib/surface/surface-operation-ledger.ts:424–434`. Retention is calculated from the later of settlement and issue time (`:369–370`), not a promise to free capacity exactly ten minutes after receipt. |
| Provisional budgets and fixture exports | COMPLETE | `handoff-494.md:19–21,220–222`; fixture functions at `libs/shared/src/testing/fixtures/surface.ts:10,26,42,157`; none exported by `libs/shared/src/testing/index.ts:1–49`; Component 11 extension matches `494-plan:631–653` |
| A2 open manual permission check | COMPLETE | Correctly unverified at `handoff-494.md:247–251`, matching `batches.md:89–92`. Source search found tool definitions/help/schema/comment references, no tool-name permission allowlist; runtime Electron permission behavior was not tested. |
| R10 accepted notification policy | COMPLETE | `handoff-494.md:252–256`; notification remains before forwarding at `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1072–1083`; accepted reviewer disposition and precise idle-timer effect at `code-logic-review-batch-3.md:61–67`, carried in `batches.md:442–457` |
| Q3 release not built | COMPLETE | `handoff-494.md:257–259`; matches `implementation-plan.md:113–121`; no release RPC in `libs/shared/src/lib/types/rpc.types.ts:2220–2237` or handler methods at `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:115–122` |
| Batch 13 HTTP rule and error-text follow-up | COMPLETE | URL-only caller assignment at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:368–381`; raw exception/stack follow-up is supported by `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:227,1903`; anonymous summary separately needs F2 |
| Batch 14 barrel exports | COMPLETE | Exact listed exports at `libs/backend/vscode-lm-tools/src/index.ts:86–130`; `SurfaceRpcHandlers` is reached through `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:148–151`, not added to the public barrel |
| Zod follow-up disposition | COMPLETE | `handoff-494.md:268–271` matches `context.md:88–94`; imports at `libs/shared/src/lib/providers/provider-registry.ts:20`, `libs/shared/src/lib/types/origin-sidecar.types.ts:31`, `libs/shared/src/lib/utils/codex-token-freshness.ts:1`; narrowed guard at `libs/shared/src/index.zod-free.spec.ts:51` |

All items explicitly required by Task 16.1 are present. Presence does not resolve F1/F2. Implicit requirement not addressed: acknowledging an operation must not certify unapplied renderer content as current (F1).

## Edge cases

“Handled” here assesses the handoff's guidance, not a new certification of the host implementation.

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| RPC result before state echo | NO | Told to adopt revision and drop equal echo (`handoff-494.md:61,160–162,182`) | F1: silent divergence |
| Missed non-conflicting host write before UI commit | NO | Host may accept an older base (`surface-ui-mutations.ts:285–299`) | F1: acknowledged revision can suppress gap recovery |
| Echo already applied before acknowledgement | YES | Equal push can be dropped once state is actually materialized | Make that precondition explicit; never regress on an older response |
| Eviction delete at equal revision | YES | Terminal-delete exception (`handoff-494.md:199–204`) | Accurate carry-forward |
| Submit settles after delete/recreate | YES | Turn outcome separate from `surfaceState` (`handoff-494.md:166–168`) | Accurate normal orphaning cases |
| RPC timeout before host dispatch deadline | YES | Poll operation, then show terminal outcome (`handoff-494.md:188–197`) | A2 runtime check remains separate |
| Anonymous patch/delete/read | NO | Blanket render-only statement (`handoff-494.md:110`) | F2: wrong result expectation |
| Operation record cap exhausted | YES | 128 records/tab warning and coalescing advice (`handoff-494.md:147–149`) | Cap includes retained terminal records |
| Unknown operation | YES | Neither rollback nor replay authorized (`handoff-494.md:185`) | Matches `rpc-surface.types.ts:191–205` |
| Markup-like field values | YES | Explicit renderer text-binding proof (`handoff-494.md:206–212`) | Renderer proof still belongs to 494 |

## Verdict

Verdict: NEEDS_REVISION

- Recommendation: REVISE
- Confidence: HIGH for F1/F2 and the static contract comparison; no Electron runtime permission evidence is claimed.
- Top risk: following the result/echo advice can make the renderer silently display stale state with a current host revision.
- What a robust implementation would add: a materialized-revision invariant, separate operation acknowledgements, reconciliation cases for both message orders and skipped host writes, and the exact anonymous-caller outcome matrix. Correct the handoff before it becomes 494 implementation guidance; no reviewed source edit is requested.


---

# Re-review after revision round 1

﻿# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 open; previous F1/F2 closed |

Verdict: APPROVED

Re-review of Batch 16 revision 1. Read the complete revised `handoff-494.md`, including its changelog, and checked the changed guidance against the current source at the caller-specified HEAD `7eaceb503`. The previous review is preserved in `code-logic-review-batch-16.md`. The score moves from 6 to 8 because both evidenced defects are corrected; it is not 9–10 because renderer reconciliation remains a design handoff awaiting 494 implementation and ordering tests.

References below: `H` = `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md`; `S/` = `libs/backend/vscode-lm-tools/src/lib/surface/`; `N/` = `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/`; `M/` = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`. Each abbreviated reference resolves under the current worktree.

## Five logic questions

### 1. How does this fail silently?

The former acknowledgement/echo loss is closed: only applying state advances the materialized revision (`H:54–67,187–200`), and the applied row no longer adopts the reply revision (`H:220`). Lost echoes trigger a read (`H:192–194`). This matches the state-free acknowledgement shape in `libs/shared/src/lib/types/rpc/rpc-surface.types.ts:99–103`.

### 2. What user action produces unexpected behaviour?

No additional demonstrated defect in the revised rules. Draft display is separate from host state (`H:195–196`); a stale rejection requires a read/re-render and retry (`H:108–109,221`). The minor clarification below would make handling of newer edits during a pending operation explicit.

### 3. What input data produces a wrong answer?

The prior anonymous-caller generalization is closed. The matrix and validation-first qualification (`H:118–127`) match `N/surface-namespace.builder.ts:102–120,186–192` and `M/surface-tool-handlers.ts:49–84`. The v1 row matches `S/dashboard-surface-bridge.ts:9` and `N/dashboard-namespace.builder.ts:265–276,320–327`; rejected v1 inputs become tool errors at `M/protocol-dispatcher.ts:1649–1654`.

### 4. What happens when a dependency fails?

The new explanation correctly distinguishes synchronous publication from completed delivery: store commit and publication precede the mutation outcome (`S/surface-state.service.ts:567–591,604–623`), `S/surface-push.ts:17–26` delegates to the broadcast, and actual sends are deferred through a promise microtask (`N/dashboard-namespace.builder.ts:162–170`). Failed delivery is logged without rollback or retry (`S/surface-state.service.ts:675–687`). Consequently, the renderer must recover a missing echo; it cannot infer state delivery from RPC success (`H:181–194`).

### 5. What is missing that the requirements never mentioned?

No missing contract requirement blocks this handoff. Draft-generation ownership is not spelled out (`H:195–196`); retain the minor clarification below for the 494 renderer design/tests. Operation settlement is otherwise distinct from state application: responses settle operation status, while echoes/reads materialize state (`H:187–200,219–223`). A read alone is not described as proof that a pending operation succeeded.

## Failure modes

No open failure mode established in this focused re-review. Both previous scenarios were traced through the revised guidance:

- **F1 closed:** result-before-echo cannot advance the materialized revision; a non-conflicting intervening write exposes a `fromRevision` gap instead of being discarded (`H:174–200`; `S/surface-ui-mutations.ts:285–299`). Echo-before-result and older-result-after-newer-push are explicitly listed at `H:197–200`. No remaining instruction in the complete note assigns an acknowledgement revision to renderer state; submit and operation-query revisions are expressly included in Rule 1 (`H:187–190`).
- **F2 closed:** valid anonymous create/replace returns render-only success, patch/delete returns unavailable/error, get-state returns not-found/success, and v1 proposal returns accepted/no-surface. Validation precedes anonymous branching and no branch stores state (`H:118–127`; source references above).

Residual uncertainty: these are documentation rules and future renderer test cases, not executed renderer behavior. No build, test suite, Git operation, or source edit was performed. No fresh diagnostics run was warranted for this Markdown-only revision; the earlier diagnostic attempt was unavailable and is not counted as passing evidence.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- **Minor clarification — scope draft retirement:** at `H:195–196`, clarify that the retired overlay belongs to the reconciled operation/draft generation. A matching echo or recovery read must not clear a newer unsent edit; preserve retry intent separately when a stale rejection replaces the host-state base (`H:108,221`). Add a newer-edit-before-older-echo case alongside `H:197–200`. The current wording permits operation-specific overlays and does not require clearing all drafts, so this is not counted as a demonstrated failure mode.

## Data flow

1. **OK:** validate input, then classify anonymous scope; map namespace outcome to `isError` (`N/surface-namespace.builder.ts:102–120,186–192`; `M/surface-tool-handlers.ts:64–82`).
2. **OK:** commit host state, initiate deferred push, settle/return mutation outcome (`S/surface-state.service.ts:572–590,609–623`; `N/dashboard-namespace.builder.ts:162–170`).
3. **OK:** record outcome/expected revision separately; apply validated state against the materialized predecessor (`H:54–67,187–191`).
4. **OK:** recover gap/lost echo with a read; reconcile the operation's display overlay without treating it as host state (`H:192–200`). Minor ownership clarification noted above.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Close acknowledged/materialized revision conflation | COMPLETE | `H:54–67,107–109,174–200,220`; no contradictory result-revision assignment found |
| Exact anonymous-caller matrix | COMPLETE | `H:118–127`; all outcomes and error flags match the namespace/tool mapping |
| Verify new source citations | COMPLETE | New line ranges at `H:119–127,176–190` resolve to the claimed branches, commit order, microtask, failure handling, and state-free result |
| Operation settlement separate from state/draft | COMPLETE | `H:187–200,219–223`; minor draft-generation clarification remains advisory |
| Required Batch 16 content preserved | COMPLETE | D3/D4/renderer/Component 7, unaffected sections and A2/R10/Q3 remain at `H:23–315` |

Implicit requirements not addressed: no additional blocking gap; explicit draft-generation ownership is recommended above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Result before echo / echo before result | YES | Separate acknowledgement and materialized state (`H:187–200`) | 494 must execute the listed tests |
| Non-conflicting agent write between base and commit | YES | Apply matching predecessor or read the gap (`H:175–178,198–199`) | None found |
| Older result after newer push / lost echo | YES | No state advancement by result; read recovery (`H:187–200`) | None found |
| Stale rejection | YES | Read/re-render, then retry (`H:108,221`) | Preserve retry intent separately from the retired overlay |
| New draft while earlier edit is pending | YES, design detail open | Operation-specific overlay is compatible with `H:195–196` | Add explicit generation-ownership test |
| Anonymous update/read/v1/invalid input | YES | Exact matrix and validation-first rule (`H:118–127`) | None found |

## Verdict

Verdict: APPROVED

- Recommendation: APPROVE
- Confidence: HIGH for closure of F1/F2 and citation accuracy; renderer behavior remains unimplemented here.
- Top risk: the future 494 reducer must preserve operation/draft ownership while applying asynchronous state.
- What a robust implementation would add: the ordering tests already required at `H:197–200`, plus a newer-draft/older-echo test and stale-rejection retry-intent coverage.
