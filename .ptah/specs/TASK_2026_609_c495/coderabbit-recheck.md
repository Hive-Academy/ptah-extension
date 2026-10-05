# CodeRabbit round re-check
Verdict: APPROVED WITH NOTES
Score: 9/10

Scope: faa768e31, 8dd6fea24, 0fa180286 at HEAD 0fa180286. Read the five PR #635 inline comments and review 5402937264 through read-only gh api. Static review only; no test suite executed. “Would fail” below is a counterfactual from inspecting assertions, not a mutation-test result.

| comment | status | evidence |
| --- | --- | --- |
| 4175024958 — Minor: invalid relative paths lose security classification | FIXED | libs/backend/agent-generation/src/lib/services/file-writer.service.ts:200 validates before absolute resolution. Traversal/non-.claude inputs retain securityViolation. file-writer.service.spec.ts:440 cases would fail without the order change. |
| 4175024986 — Minor: subfolder generation misses root-scoped override | FIXED | libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:1099 resolves the harness root before layersForPath. orchestrator.service.spec.ts:1603 subfolder/.git-root test would fail without the fix. |
| 4175024989 — Minor: display name differs from file slug | FIXED | libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:1131 uses template.id; :791 produces that same id.md filename. orchestrator.service.spec.ts:1631 differing-name/id test would fail without the fix. |
| 4175024993 — Minor security: Restore follows linked source directories | FIXED | libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts:836 invokes the guard before copying; :863 lstat-checks both directory components and returns conflict for links/junctions. user-layer-seed-quarantine.spec.ts:1283 tests both links and zero outside writes; both would fail without the guard. |
| 4175025001 — Minor: stale health after workspace switch on Agents tab | FIXED | libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:472 tracks workspaceRoot; :480 forces exactly one refresh on a changed root while active. skill-clones-view.component.spec.ts:1027 would fail without the switch branch (expected second refresh). |
| Review 5402937264 — Trivial: prefix-based ancestor containment | FIXED | libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts:354 uses relative plus parent/absolute rejection, excluding .history-old siblings and cross-drive paths. No added boundary spec; existing artifact-retirement.spec.ts tests valid descendants and would not fail merely by reverting this guard. |

Additional requested checks:
- B-5g identity matches: libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:2371 resolves the active root; :2402 validates that root; :1722 saves workspaceRoot plus parsed.slug. Generation reads the same resolver and uses the generated filename's template.id.
- No new dependency cycle: harness-sync production imports lead to shared and vscode-core (runtime TOKENS at libs/backend/harness-sync/src/lib/di/register.ts:25), neither returns to agent-generation. The root resolver itself imports only Node fs/os/path (workspace-root.ts:43).
- Runtime loading is supported: VS Code loads agent-generation through apps/ptah-extension-vscode/src/activation/plugin-activation.ts:16; Electron through apps/ptah-electron/src/activation/plugin-activation.ts:29; CLI/TUI through libs/backend/cli-engine/src/lib/container.ts:113. Existing build aliases supply vscode shims in apps/ptah-electron/tsconfig.build.json:5, apps/ptah-cli/tsconfig.build.json:5 and apps/ptah-tui/tsconfig.build.json:5. This import adds no unsupported runtime requirement to the existing vscode-core dependency.
- No refresh feedback loop: component :471 reads onAgentTab (computed only from host/tab at :580) and config; refresh calls are untracked (:476, :481). Harness health changes do not become effect dependencies; lastWorkspaceRoot is updated before refresh.
- Pruning edge cases: relative root equals empty string and permits the final root removal; parent traversal and cross-drive absolute results stop. startsWith('..') also conservatively stops valid children named ..cache or ...; the consequence is retained empty directories, not an out-of-root deletion. This is below the requested new-defect severity threshold. A targeted boundary regression spec remains absent.

## New findings
None at Blocking or Serious severity introduced by these commits. The accepted Restore check-then-write race is not reopened.