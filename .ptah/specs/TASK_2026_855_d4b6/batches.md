# Batches - TASK_2026_855_d4b6

Total tasks: 22 | Batches: 6 | Complete: 0/6

## Plan validation

Status: PASSED WITH RISKS

Inputs: approved revised implementation-plan.md, implementation-plan-review.md, decisions.md and context.md in `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6`. The current assignment supplies approval; the plan's older approval-pending note is superseded. No implementation or checks were performed in this advisory pass. Ownership below comes from the plan's explicit file lists; project names come from their nearest scoped project.json.

Assumptions:
- Live pre-bind source lookup and durable SDK-ID metadata can supply identical lineage: lifecycle owner must inspect both producer paths and prove equivalence before wiring.
- Existing metadata projections preserve the optional field: lifecycle owner must test summary/detail, repeated create, real SDK-ID binding and fresh-runtime round trips.

| Risk | Severity | Mitigation / acceptance |
| --- | --- | --- |
| Strict policy reads confuse missing config with missing root, or skip shadowed corruption | HIGH | Foundation tests validate all layers; available root without config is empty, malformed/unreadable policy is restrictive. |
| Lexical authorization or canonical fallback admits an invalid policy root | HIGH | Lifecycle checks authorize supplied and physical identities, safety and availability for cwd, local policy root and all ancestors before reads, on every launch/restore path. |
| Nested lineage truncates or disappears across binding/restart | HIGH | R -> A -> B durable integration, live/pre-bind parity, projection and source-deletion regressions. |
| Parent fallback executes in the wrong folder | HIGH | Replace fallback expectations; invalid distinct saved cwd returns SESSION_FOLDER_UNAVAILABLE with zero parent SDK calls. |
| Foundational reads become usable before governing-root validation lands | HIGH | All batches are one unshippable intermediate phase until validation and independent review pass; no initial push before complete verified phase. |

## Decisions

- Preserve the requested two sequential implementation **stages**: foundation (components 1–2), then durable lifecycle/isolation (components 3–4). The plan enumerates more than six files and more than two projects per requested stage; split into bounded sequential ownership slices below rather than assign oversized batches. No parallel shared-contract writers and no new architecture.
- Every file is extended in place unless explicitly proposed as a new focused test by the plan. Read both contract producers and consumers before implementation. Additional propagation/test files require coordinator ownership approval and a bounded follow-on slice, not silent scope expansion.
- `pluginConfigAncestorRoots` remains optional existing-metadata lineage, nearest-first and transitive. Absent means legacy; [] means explicitly independent. Agent disables stay local. No organization fallback, filesystem ancestry inference, registry or bulk migration.
- Execution cwd, MCP declarations/import inventory/approval and store keys, plugin files, harness destination, hooks, credentials and permissions stay execution-root scoped; inherited policy never grants parent file discovery.
- Advisory state only: Batch 1 is IN_PROGRESS as the next assignment; no executor has been launched. Coordinator owns subsequent state transitions and all Git delivery.

## Common executor contract

- WorkingDirectory for every executor and command: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy`. All files and checks remain in this worktree.
- Recommended executor: CLI lane with backend TypeScript policy/persistence capability. Fallback: other family same capability -> same family other provider/model -> backend-developer subagent only if eligible lanes are exhausted. No lane/subagent spawning in this advisory pass.
- Exclusive sequential ownership. One phase `session-policy`; code-logic review after its last batch on the combined task diff, different family from implementer when available. Record both families; same-family requires explicit weaker-evidence exception. Style review only for a new public API. Reject stubs, empty implementations, TODO/PLACEHOLDER logic and mock/logging substitutes.
- Workers do not edit batches.md, commit, push or create PRs. Report every absolute changed path, task evidence, risk disposition and exact scoped check results to coordinator.
- Verify only with scoped `npm run verify -- -p A,B`; focused tests may use `npm run verify -- -t test -p A -- --testPathPatterns=file`. Keep configured Nx/Jest caps and shared cache. Filter output; never workspace-wide checks/build/serve/dev/e2e/package. Other heavy commands require `node scripts/verify.mjs --exec --task <name> -- <command>`.
- Electron first; no TUI/VS Code feature/polish. Shared changes additionally require dependent hosts' tests/typechecks. The known host names below are scoped-config verified; executor must confirm further dependent hosts by scoped imports, not a workspace-wide graph dump.

## Acceptance suites

### F — Foundation

- Nearest explicit plugin/skill value wins: child, nearest ancestor, distant ancestor, global/default. Cover R -> A -> B, child ON against ancestor OFF, unrelated IDs, same-layer deny, duplicate/canonical roots and same-root context. Agent disables are local; a skill ON never bypasses its disabled provider plugin.
- Strict reads distinguish absent config from unreadable/malformed JSON/invalid field types and missing root. Read/validate every governing layer even if shadowed. Resolver unavailable/failure uses existing restrictive policy-unknown behavior.
- Context fingerprint includes normalized local identity and ordered ancestor identities plus explicit plugin/skill fields, including shadowed choices. Ignore ancestor agents, timestamps, set ordering/duplicates; preserve no-context legacy digest. Root identity/order and governing choice changes must change contextual digest.
- Optional internal context reaches both policy resolution and harness preflight/options from one consistent snapshot. No change to physical cwd, local save/list/set scope, MCP imports/approvals/store keys or executable plugin catalog; inherited ON cannot expose parent-only files/declarations/approvals.

### L — Durable lifecycle, validation and isolation

- Authoritative sourceSessionId capture gives [source execution root, ...source saved ancestors], canonical nearest-first deduplication excluding child root. Source root must match immediate workspaceRoot. Supplied unresolved/mismatched source fails, not truncates; same-root handoff preserves source chain. No-source legacy caller can establish only validated immediate root. Live pre-bind and SDK-ID lookup must agree.
- Persist the optional lineage through existing metadata owner at binding and all summary/detail projections, repeated create and restart; source deletion does not erase descendants. Prove actual nested launch -> real SDK-ID persistence -> fresh-runtime restore, not just manually injected arrays.
- Legacy absent field recovers only provable distinct workspaceId after validation; identical/missing cwd yields []. Unknown historical grandparents are diagnosed, never invented. Present malformed field refuses. Explicit [] stays independent.
- Validate supplied and resolved physical execution cwd, local governing root and every ancestor for authorization, safety and availability before policy/home import reads or SDK calls at child/handoff launch, activation, inactive continue, rewind and equivalent restore/query-recreation entries. Test removed/unreadable roots, filesystem errors, symlink escape/aliases and corrupt arrays; valid cwd never authorizes invalid ancestor. Preserve existing refusal shaping and spawner rollback.
- Distinct saved cwd missing/unsafe/unauthorized/uncheckable returns SESSION_FOLDER_UNAVAILABLE even with valid parent; assert no parent SDK resume. Replace contrary existing tests; identical/missing-cwd legacy success remains. Values refresh on query reconstruction without polling/watchers/hot-patching. Trace metadata writes to runtime readers before acceptance.

## Batch 1: Plugin/skill layering and fingerprint — COMPLETE

- Recommended executor: CLI lane — backend TypeScript policy/resolver capability
- Execution mode: sequential | Tasks: 4 | Depends on: none
- Fallback order: other family same capability -> same family other provider/model -> backend-developer subagent
- Subagent reason: N/A unless eligible lanes exhausted
- Review family: different from implementer | Phase: session-policy | Phase review: code-logic after final batch
- Rationale: preserve approved component order and exclusive contracts within six files/two projects.

### Task 1.1: plugin-loader.service.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:71`, component 1; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 1, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 1.2: plugin-loader.service.capabilities.spec.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.capabilities.spec.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:72`, component 1; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 1, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 1.3: capability-id-codec.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/shared/src/lib/types/capability-id-codec.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:73`, component 1; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 1, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 1.4: capability-id-codec.lineage.spec.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/shared/src/lib/types/capability-id-codec.lineage.spec.ts` (plan-proposed destination; confirm before creation).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:74`, component 1; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 1, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Batch 1 verification

- Project targets: `@ptah-extension/agent-sdk` lint/test/typecheck, `@ptah-extension/shared` lint/test/typecheck.
- Scoped command, from `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy`: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/shared`.
- Additional shared-contract host tests/typechecks: `npm run verify -- -t test,typecheck -p ptah-electron,ptah-tui,ptah-extension-vscode`; add other confirmed dependent hosts only when scoped dependency evidence requires them.
- Inspect every owned artifact, run focused regressions for suite F, verify producer/consumer contracts and resolve carried risks. Scoped checks must pass before acceptance; intermediate slices do not constitute a shippable phase. No per-batch review; combined independent phase review remains due.
## Batch 2: Resolver and query-context forwarding — COMPLETE

- Recommended executor: CLI lane — backend TypeScript policy/resolver capability
- Execution mode: sequential | Tasks: 3 | Depends on: Batch 1
- Fallback order: other family same capability -> same family other provider/model -> backend-developer subagent
- Subagent reason: N/A unless eligible lanes exhausted
- Review family: different from implementer | Phase: session-policy | Phase review: code-logic after final batch
- Rationale: preserve approved component order and exclusive contracts within six files/two projects.

### Task 2.1: capability-toggle.types.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/shared/src/lib/types/capability-toggle.types.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:87`, component 2; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 2, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 2.2: capability-resolver.service.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:88`, component 2; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 2, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 2.3: capability-resolver.service.spec.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.spec.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:89`, component 2; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 2, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Batch 2 verification

- Project targets: `@ptah-extension/shared` lint/test/typecheck, `@ptah-extension/cli-agent-runtime` lint/test/typecheck.
- Scoped command, from `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy`: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/cli-agent-runtime`.
- Additional shared-contract host tests/typechecks: `npm run verify -- -t test,typecheck -p ptah-electron,ptah-tui,ptah-extension-vscode`; add other confirmed dependent hosts only when scoped dependency evidence requires them.
- Inspect every owned artifact, run focused regressions for suite F, verify producer/consumer contracts and resolve carried risks. Scoped checks must pass before acceptance; intermediate slices do not constitute a shippable phase. No per-batch review; combined independent phase review remains due.
## Batch 3: Resolver and query-context forwarding — COMPLETE

- Recommended executor: CLI lane — backend TypeScript policy/resolver capability
- Execution mode: sequential | Tasks: 4 | Depends on: Batch 2
- Fallback order: other family same capability -> same family other provider/model -> backend-developer subagent
- Subagent reason: N/A unless eligible lanes exhausted
- Review family: different from implementer | Phase: session-policy | Phase review: code-logic after final batch
- Rationale: preserve approved component order and exclusive contracts within six files/two projects.

### Task 3.1: sdk-query-options-builder.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:90`, component 2; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 2, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 3.2: sdk-query-options-builder.capabilities.spec.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.capabilities.spec.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:91`, component 2; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 2, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 3.3: session-query-executor.service.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:92`, component 2; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 2, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 3.4: session-query-executor.harness-preflight.spec.ts — COMPLETE

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.harness-preflight.spec.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:93`, component 2; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 2, acceptance suite F and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Batch 3 verification

- Project targets: `@ptah-extension/agent-sdk` lint/test/typecheck.
- Scoped command, from `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy`: `npm run verify -- -p @ptah-extension/agent-sdk`.
- Inspect every owned artifact, run focused regressions for suite F, verify producer/consumer contracts and resolve carried risks. Scoped checks must pass before acceptance; intermediate slices do not constitute a shippable phase. No per-batch review; combined independent phase review remains due.
## Batch 4: Durable lineage capture and restore — COMPLETE

- Recommended executor: CLI lane — backend TypeScript session/persistence capability
- Execution mode: sequential | Tasks: 3 | Depends on: Batch 3
- Fallback order: other family same capability -> same family other provider/model -> backend-developer subagent
- Subagent reason: N/A unless eligible lanes exhausted
- Review family: different from implementer | Phase: session-policy | Phase review: code-logic after final batch
- Rationale: preserve approved component order and exclusive contracts within six files/two projects.

### Task 4.1: ai-provider.types.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/shared/src/lib/types/ai-provider.types.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:109`, component 3; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 3, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 4.2: session-metadata-store.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:110`, component 3; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 3, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 4.3: sdk-agent-adapter.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:111`, component 3; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 3, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Batch 4 verification

- Project targets: `@ptah-extension/shared` lint/test/typecheck, `@ptah-extension/agent-sdk` lint/test/typecheck.
- Scoped command, from `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy`: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk`.
- Additional shared-contract host tests/typechecks: `npm run verify -- -t test,typecheck -p ptah-electron,ptah-tui,ptah-extension-vscode`; add other confirmed dependent hosts only when scoped dependency evidence requires them.
- Inspect every owned artifact, run focused regressions for suite L, verify producer/consumer contracts and resolve carried risks. Scoped checks must pass before acceptance; intermediate slices do not constitute a shippable phase. No per-batch review; combined independent phase review remains due.
## Batch 5: Durable lineage capture and restore — COMPLETE

- Recommended executor: CLI lane — backend TypeScript session/persistence capability
- Execution mode: sequential | Tasks: 6 | Depends on: Batch 4
- Fallback order: other family same capability -> same family other provider/model -> backend-developer subagent
- Subagent reason: N/A unless eligible lanes exhausted
- Review family: different from implementer | Phase: session-policy | Phase review: code-logic after final batch
- Rationale: preserve approved component order and exclusive contracts within six files/two projects.

### Task 5.1: chat-session.service.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:112`, component 3; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 3, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 5.2: chat-session-agent-child.spec.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:113`, component 3; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 3, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 5.3: chat-session-resume-activate.spec.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-resume-activate.spec.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:114`, component 3; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 3, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 5.4: chat-session-session-folder.spec.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-session-folder.spec.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:115`, component 3; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 3, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 5.5: session-metadata-store.lineage.spec.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/session-metadata-store.lineage.spec.ts` (plan-proposed destination; confirm before creation).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:117`, component 3; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 3, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 5.6: sdk-agent-adapter.lineage.spec.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.lineage.spec.ts` (plan-proposed destination; confirm before creation).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:118`, component 3; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 3, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Batch 5 verification

- Project targets: `@ptah-extension/rpc-handlers` lint/test/typecheck, `@ptah-extension/agent-sdk` lint/test/typecheck.
- Scoped command, from `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy`: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`.
- Inspect every owned artifact, run focused regressions for suite L, verify producer/consumer contracts and resolve carried risks. Scoped checks must pass before acceptance; intermediate slices do not constitute a shippable phase. No per-batch review; combined independent phase review remains due.
## Batch 6: Governing-root checks and cwd isolation — COMPLETE

- Recommended executor: CLI lane — backend TypeScript session/persistence capability
- Execution mode: sequential | Tasks: 2 | Depends on: Batch 5
- Fallback order: other family same capability -> same family other provider/model -> backend-developer subagent
- Subagent reason: N/A unless eligible lanes exhausted
- Review family: different from implementer | Phase: session-policy | Phase review: code-logic after final batch
- Rationale: preserve approved component order and exclusive contracts within six files/two projects.

### Task 6.1: session-folder.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:132`, component 4; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 4, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Task 6.2: session-folder.spec.ts — PENDING

- File ownership: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/session-folder.spec.ts` (extend existing).
- Plan reference: `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md:133`, component 4; follow its cited existing patterns and detailed contract.
- Quality and implementation: fulfill component 4, acceptance suite L and its carried risks; production files implement the real boundary, test files pin its applicable regressions. Respect dependencies within this batch in listed order.

### Batch 6 verification

- Project targets: `@ptah-extension/rpc-handlers` lint/test/typecheck.
- Scoped command, from `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy`: `npm run verify -- -p @ptah-extension/rpc-handlers`.
- Inspect every owned artifact, run focused regressions for suite L, verify producer/consumer contracts and resolve carried risks. Scoped checks must pass before acceptance; intermediate slices do not constitute a shippable phase. No per-batch review; combined independent phase review remains due.

## Exact next action

Coordinator resolves a live backend-capable CLI lane and delegates only Batch 1, sequentially, with workingDirectory `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy` and this prompt:

> Implement Batch 1 of TASK_2026_855_d4b6 in `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/batches.md`, marked IN_PROGRESS. Read `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan.md`, `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/implementation-plan-review.md` and `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/decisions.md`. Implement only Batch 1's explicitly owned files, using the approved component contracts, suite F and risk mitigations; inspect producer/consumer code first. All implementation, tests and commands remain in `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy`. Run `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/shared` and any additional dependent-host tests/typechecks specified for this batch. Keep Nx/Jest caps and shared cache; never workspace-wide checks/build/serve/dev/e2e/package. Other heavy commands use the verify.mjs --exec lock. Electron first; no TUI/VS Code feature work. Return every absolute changed path, task completion evidence, exact command results and risk resolutions. If additional ownership is needed, report it before editing outside this batch. Do not edit batches.md, commit, push or start Batch 2; coordinator owns Git and next-state decisions.
