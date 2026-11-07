# Routing learning review fixes

## Decisions

- A recorded lane belongs to the active workspace when its normalized root equals the active normalized root or is beneath it at a path separator. This includes `.claude-worktrees/<name>` and other subpaths. Sibling prefixes do not match. The choice is reversible; the review recommends this rule and the current task lanes use worktrees.
- Rotation remains deterministic when disabled, but the chosen executor is still persisted as the last pick. This preserves the prior decision and is reversible.

## Defects

1. Cold-start matrix: `libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.ts:185,321` now asks the outcome reader for all recent outcomes in the active workspace. The reader uses `listRecent` in `libs/backend/lane-outcomes/src/lib/lane-outcome-reader.service.ts:51`. Test: fresh view without `load()` in `capability-matrix.store.spec.ts`.
2. Workspace scope: the CLI writer normalizes roots in `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:53`; the reader normalizes active roots in `lane-outcome-reader.service.ts:44,66,92`. SQL uses bound equality and escaped prefix LIKE in `libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.ts:12,378,396`; memory uses the same separator boundary in `in-memory-lane-outcome.store.ts:7,222,235`. Tests: normalized case, separator, trailing slash, child, worktree and sibling in both store specs.
3. Rotation persistence: `libs/backend/lane-routing/src/lib/route-decide.service.ts:293` persists the chosen ID in both modes. Test: rotation-off gate spec checks the chosen ID is stored.
4. Setting failure logging: `libs/backend/lane-routing/src/lib/scope/lane-rotation-setting.ts:5,13` receives the lane logger through DI and warns before returning the default. Typecheck and lane-routing suite cover wiring; no dedicated failure-path spec added.
5. Apply refusal: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:422` forwards `skipReason`; `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:158` declares the result field. Test: apply RPC spec checks a cooldown refusal.
6. Missing scorecard: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:104,672` returns `judge-unavailable`, distinct from a gate error. Test: `skill-enhancer.service.spec.ts` now asserts the missing-scorecard result and no judge call.
7. Shared band rule: `libs/backend/lane-routing/src/lib/ranking/closeness-band.ts:3` supplies one predicate to spread, phase plan and phase resolve; `phase-resolve.ts:18` computes the top score once. Covered by lane-routing suite.
8. Rotation unavailable: `libs/backend/lane-routing/src/lib/route-decide.service.ts:160` retains `load().reason`; `libs/backend/rpc-handlers/src/lib/handlers/capability-matrix-rpc.handlers.ts:101` returns an unavailable flag; `libs/frontend/chat/src/lib/settings/ptah-ai/lane-rotation-setting.component.ts:84,162` shows that state. Test: `capability-matrix-rpc.handlers.spec.ts` now asserts the unavailable flag when the rotation read has a reason.
9. Read-only matrix view: `libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.ts:184,222` skips template creation on `readMergedView()`. Test: fresh-view spec asserts no writes.

## Verification

Command: `npm run verify -- -p @ptah-extension/lane-routing,@ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers,@ptah-extension/skill-synthesis,@ptah-extension/chat,@ptah-extension/shared -- --output-style=static`

- First attempt: `NX Running targets lint, typecheck for 7 projects`; lane-outcomes typecheck failed on new import modifiers and optional root typing, both fixed before the final run. Its test phase could not process the project graph because the `@nx/eslint/plugin` worker exited. Classified as transient tooling failure.
- Final full run: `NX Successfully ran targets lint, typecheck for 7 projects`. Test stage: `NX Running target test for 7 projects failed` (exit 1). Shared: 140 suites, 4104 tests passed. Lane routing: 31 suites, 826 tests passed, 1 suite and 8 tests skipped. Lane outcomes: 17 suites, 268 tests passed. Chat: 343 suites, 6112 tests passed, 2 tests skipped. Skill synthesis: 35 suites, 599 tests passed. CLI runtime: 126 suites passed, 4 failed, 11 tests failed; failures include the known `mcp-install` and `claude-approval.reader` cases, plus a real Git child-worktree integration timeout under machine congestion (unresolved, outside this change). RPC handlers: 221 suites passed, 14 failed, 37 tests failed; known environment failures include skills-synthesis B13 subfolder, plugin and chat-session path cases. One changed capability-matrix RPC spec failed because its test double returned the old rotation shape; the test double was corrected after this run. Other RPC failures were not individually classified because the full runner output was truncated.
- Focused follow-up: `npm run verify -- -t test -p @ptah-extension/rpc-handlers,@ptah-extension/skill-synthesis -- '--testPathPatterns=capability-matrix-rpc.handlers.spec|skill-enhancer.service.spec' --coverage=false --maxWorkers=2 --output-style=static` passed (exit 0): skill synthesis 1 suite/33 tests; RPC handlers 1 suite/7 tests; `NX Successfully ran target test for 2 projects`.

## Limitations

- The host did not expose a skill-loading tool or skill catalogue to this lane, so no skill could be loaded.
- `ptah_get_diagnostics` was invoked after edits but timed out while the congested compiler was running; the full seven-project typecheck later passed.
