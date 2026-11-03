## Verdict

REVISE — five prior blockers are resolved, but D9's new capture sequence can attribute another run's guidance content to the completed bound run.

## Prior defects

Paths below are relative to the worktree; `implementation-plan.md` refers to `.ptah/specs/TASK_2026_ONBOARDING/implementation-plan.md`.

| # | fixed? | evidence |
| --- | --- | --- |
| 1 | Yes | Plan :111-115 stages the services barrel; :800-802, :817-830, :904-906 and :975-977 stage exports before their importing files. The existing harness barrel lacks sidebar exports (`libs/frontend/harness-builder/src/index.ts:1-18`); the component exists at `libs/frontend/harness-builder/src/lib/components/sidebar/builder-session-section.component.ts:52`. `GenerationViewState` exists at `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:12`. B2 supplies both missing exports; B4a supplies the proposal exports before B4b. Same-batch export edits must precede consumer edits, as the import audit requires. |
| 2 | Yes | Plan :318-331, :1013-1020 and :1042-1046 explicitly widen in B5a and narrow with deletion in B5b. The current union is at `libs/frontend/core/src/lib/tokens/surface-focus-router.token.ts:5`; legacy implementations declare their kinds at `libs/frontend/setup-wizard/src/lib/services/setup-wizard-focus-router.service.ts:7` and `libs/frontend/harness-builder/src/lib/services/harness-builder-focus-router.service.ts:7`. Plan :334-337 covers both actual comparisons at `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts:200` and :268 with a wire-kind mapping. |
| 3 | Yes | Plan :224-228, :692, :803, :972-985 and :1015-1016 consistently retain the old target in B4a and assign its switch plus spec to B5a, after B4b. The real target is `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts:355`. |
| 4 | Yes, for the identified compile/target risks | Plan :835-870 lists explicit commands, includes webview throughout, Electron after frontend changes, and VS Code/TUI/CLI for shared/backend changes. It includes the old token implementers during widening and chat during narrowing. `scripts/verify.mjs:79-88` confirms exact project lists and default targets. Host tests are excluded from the full-target commands, correctly matching `apps/ptah-tui/project.json:120`, `apps/ptah-electron/project.json:444`, `apps/ptah-extension-vscode/project.json:216` and `apps/ptah-cli/project.json:264`. Electron e2e receives only lint/typecheck. The documented exclusions for projects connected only by implicit dependencies do not conceal a demonstrated source compile failure. |
| 5 | Yes | Plan :770-774 mandates serial execution; :794-812 assigns the overlapping route, barrel, request-service, token, boot and host-spec edits. B1/B2/B3a/B3b/B4a/B4b/B5a/B5b file lists agree on the consequential staged edits. This resolves the prior false file-disjointness claim; the two staged request-service edits correspond to the existing single navigation method at `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts:351`. |
| 6 | Partly | Binding context D9 (`.ptah/specs/TASK_2026_ONBOARDING/context.md:97-101`) authorizes the three removals. Plan :539-567 uses the actual marker, canonical heading order and whitespace rule from `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:1408-1409` and :1464-1485, excluding the core prefix added at :900. The narrowed card and bound flow are sound. However, :523-536 does not establish that the fetched workspace content belongs to the observed run; see blocker 1. |

## Blocking defects

1. **D9's status sandwich checks content stability, but not ownership by the completed run.**

   **Plan evidence:** `implementation-plan.md:506-509` starts capture from a locally observed completion; :523-530 checks two workspace timestamps and the local store's run ID; :532-536 compares the captured timestamp with the store's committed-result timestamp. No fresh authoritative run check brackets the content read.

   **Code evidence:** `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:914-940` accepts only a workspace for content; :192-200 likewise returns workspace status. `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:682-688` replaces workspace guidance with a new timestamp. `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts:174-195` populates `result()` from that same workspace-wide status, independently of `run()`. The bound terminal event contains identity/lifecycle but no content version (`libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:848-858`), and `SetupGenerationRunState` has no generated timestamp (`libs/shared/src/lib/types/rpc/rpc-setup.types.ts:98-107`).

   **Failure:** run A completes and its frontend capture is delayed. Another tab completes run B in the same workspace before the first status read. Both reads return B's timestamp, content is B's, and the local store can still identify A. A workspace refresh also makes `result().generatedAt` equal B's timestamp, so the final display check passes. The UI labels B's counts as A's completion facts, violating D9's stale/different-run requirement. This is a residual defect in prior blocker 6, introduced by the proposed replacement data path.

   **Required fix:** specify authoritative identity validation around the workspace reads, not just comparisons with cached signals. Use the existing `enhancedPrompts:getRunState` path (`enhanced-prompts-rpc.handlers.ts:882-896`) and require the returned binding/run to remain the observed completed run; reject missing, rejected, changed or nonterminal results. A superseding completed run replaces the supervisor's settled record (`guidance-generation-run.supervisor.ts:94-95`), so a fresh lookup can detect the concrete race above. Account explicitly for an active replacement too: lookup with an explicit old run ID can still return the old settled run before checking a current owner (`:153-170`); do not treat that response alone as proof that no replacement exists. Retain the timestamp sandwich and local binding checks, revalidate enabled/prompt availability, and omit counts whenever attribution cannot be established using existing frontend-accessible evidence. Do not add backend fields or change D9. Add cases where B finishes before the first read, where B is active during capture, and where the workspace result advances while the local run remains A.

## Non-blocking suggestions

- Add B2's `GenerationViewState` export to the Modify table at plan :682; it is already correctly owned in the batch and ownership tables.
- The matrix's “every dependent” wording at plan :838 is broader than its documented implicit-only exclusions at :867-870. Describe it as source-impact coverage plus explicitly selected implicit dependents.
- Spell the isolated host-spec invocation through `npm run verify -- --exec ...` and include `--coverage=false --maxWorkers=2`, keeping the shared lock and making the requested execution convention explicit.

## Decisions

- D9 remains binding: bound guidance, four content-derived canonical sections, and approved removal of totalTokens, usedFallback and Quality Guidance. No user decision is reopened.
- The parser matches the backend-produced layout; its documented handling of nested/duplicate headings is deterministic. Null/unrecognizable content remains unavailable rather than fabricated.
- The serial export staging, two-step focus union change, B5a-only navigation cut-over, Electron-first guard and preservation of host compilation are accepted design choices.
- Read-only source/config review only. No tests, builds, verify commands, Nx targets, git mutations, UI rendering or implementation edits were performed. Runtime behavior and actual compilation remain unverified by design. Only this deliverable was written.
- Ptah workspace analysis, AST inspection and file search were available and used; targeted native `rg`, numbered reads and JSON inspection supplied source/config evidence. Native skill discovery/loading was unavailable; the local `.claude/skills/angular-frontend-patterns/SKILL.md` was read as the fallback. No visual-quality claim is made for this plan-only review.
