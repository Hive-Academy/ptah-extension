# Batches - TASK_2026_560_2ae5

Total tasks: 26 batches (PR 1: 17 = B1-B14, B16, B17, B25; PR 2: 9 = B15, B18-B24, B26) | Complete: 5/26

Design authority: `implementation-plan.md` (revision 2 + r3, user-approved). The review files are history.
Base: `main @ c4bdc87dd`. Branch: `feat/task-2026-560-mcp-skill-toggles`. PR 2 will be a stacked branch
planned later. PR 1 batches run first, and PR 2 starts after PR 1 merges (plan line 510).

Check command form (every batch): `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p <projects> --parallel=2`.
Project names were checked against each `project.json` `name`. Projects without a `test` target (the e2e
projects) run only lint and typecheck under this form, so those batches add an e2e command.

Executors: every batch runs as a sequential sub-agent. The batches are coupled internally, and parallelism
comes from the waves below, not from lanes inside a batch. Reviewers: code-logic-reviewer on every batch,
plus code-style-reviewer on every batch that touches UI.

## Plan issues

None blocking; no design contradiction was found. The corrections below change file mechanics only, and no
design decision.

| # | Plan text | Finding (evidence) | Resolution in this decomposition |
| --- | --- | --- | --- |
| P1 | C1 extends `HarnessSourcesStatus` with `'policy-unknown'` | `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:259-267` is an exhaustive `switch` returning `string \| null`, and it has no default. The new member breaks the marketplace typecheck (TS2366). The file is not in the plan. | Added to Batch 1 with its existing spec (+2 files). PR 1 now has **81** code files. |
| P2 | C3: "M `plugin-config-source-resolver.ts` + `.spec.ts`" | `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.spec.ts` does not exist | It is **C** (create). The file count is unchanged. |
| P3 | C11: C `capability-toggles.spec.ts` | The harness Playwright config uses `testMatch: ['**/*.e2e.spec.ts']` (`libs/frontend/webview-e2e-harness/playwright.config.ts:22`). A plain `.spec.ts` would never run. | The file is named `capability-toggles.e2e.spec.ts`, next to `marketplace.fixtures.ts`. |
| P4 | Handoff verification: "`manifest.spec.ts`" | No such file. The host-profile spec is `libs/backend/rpc-handlers/src/lib/host-profile/resolve-handler-plan.spec.ts`. | Batch 10 runs that spec, which is inside the rpc-handlers `test` target. |
| P5 | C3: "PluginConfigSourceResolver maps `CapabilityPolicyUnknownError`" | harness-sync must not import agent-sdk (`libs/backend/harness-sync/src/index.ts:10`, `sources/harness-source.port.ts:6`) | Detection is structural. Batch 1 adds a shared discriminator (error `name`/`code` constant + `isCapabilityPolicyUnknownError` guard) in `capability-toggle.types.ts`. Batch 5 sets it on the agent-sdk error, and Batch 3 checks it. |
| P6 | Handoff batch order puts cli-agent-runtime (3) before agent-sdk (4) | cli-agent-runtime imports agent-sdk (27 imports). The store registers under `SDK_TOKENS`, and the resolver calls `getEffectivePluginConfig`. | Batch 5 (agent-sdk tokens + loader) runs before Batch 7 (resolver). The C1→C3→C4 component order is unchanged. |
| P7 | C6 "Files (10)" is not enumerated in the final plan | The round-1 list is not on disk | Derived from the adapters on disk (Batches 22-23). **ASSUMPTION A-PR2**: re-verify this list against the code when PR 2 starts. |
| P8 | NFR: e2e specs in `apps/ptah-electron-e2e/src/specs/marketplace/` | The plan's fixtures file and RPC auto-responder live in `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/`, which is the only place a failing `setEnabled` (revert) can be driven | The new spec goes to the harness location, which the plan chose. The PR 1 description states this deviation from the NFR path. |

### P9: global skill/plugin layer is unreachable from the synchronous callers (found by the Batch 5 logic review)

The plan's C3 text says "`resolveCurrentPluginPaths` and `getDisabledSkillIds` are effective". As implemented,
both methods stay synchronous and read only the WORKSPACE layer (`plugin-loader.service.ts:1220-1230`,
`:1482-1492`). Only the async `getEffectivePluginConfig(root)` applies `workspace ?? global ?? default`.

Resolution (no design change; D1 is kept as written):

- The two synchronous methods stay workspace-only, and their JSDoc says so.
- Every caller that affects a session moves to the async `getEffectivePluginConfig`, assigned to a PR 1 batch
  in the table below.
- Enforcement of this gap never moves to PR 2.

How layering reaches callers (from `layerGlobalItems`, `plugin-loader.service.ts:175-212`):

- A global item applies only to an id the workspace records nothing about. A global `on` goes into
  `enabledPluginIds` or `enabledSkillIds`, and a global `off` goes into `disabledPluginIds` or
  `disabledSkillIds`.
- So a caller that uses only the workspace `enabledPluginIds` can MISS a global ON (it narrows), but it can
  never admit a globally-OFF item (it cannot widen).
- A caller that uses `resolveCurrentPluginPaths` or `getDisabledSkillIds` DOES widen. Those include the opt-out
  (default-ON) plugins and a skill's default ON, so a global OFF is ignored.

#### Global-layer caller assignment

| # | Caller | Effect | Batch (PR) | Change | Acceptance test |
| --- | --- | --- | --- | --- | --- |
| G1 | `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:169-177` (`resolve`) | **Widens**: its overlay and disabled-skill ids feed the reconciler, which writes the `.claude/skills` copies and junctions that Claude sessions and every CLI lane load | **B3** (PR 1), already owned | When `reader.getEffectivePluginConfig` exists, `resolve` awaits it once, and takes `overlayPluginPaths`, `config.disabledSkillIds`, `config` and `fingerprint` from that single result. `resolve` returns `HarnessSourceState \| Promise<HarnessSourceState>`, and the reconciler awaits it at `harness-reconciler.service.ts:200,383`. A reader without the method keeps today's synchronous path. | New reconciler spec: a global OFF on an opt-out plugin with no workspace entry → the plugin is absent from the overlay, and its skill copies are absent after a reconcile. A global OFF skill → its copy is absent. A global ON on an opt-in plugin → present. A workspace entry beats a global one. |
| G2 | `apps/ptah-electron/src/di/phase-2-libraries.ts:200-231` (hand-written `HarnessPluginConfigReader` wrapper) | **Widens**: without forwarding, G1's new branch is unreachable on Electron | **B3** (PR 1), added (+1 file) | Add `getEffectivePluginConfig: async (root) => …` that forwards `workspaceRoot` and folds `readDormantSkillSlugs(container)` into the effective `config.disabledSkillIds`, exactly as the sync `getDisabledSkillIds` wrapper does today | The `ptah-electron` typecheck passes. The reviewer traces the wrapper and confirms that dormant slugs are still folded and that the root is forwarded. The G1 spec covers the behaviour. |
| G2b | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:173-178`, `libs/backend/cli-engine/src/lib/container.ts:645-650` | Would widen, but these hosts pass the `PluginLoaderService` instance itself as the reader, so it already has `getEffectivePluginConfig` | none (no change) | none | The B3 reviewer confirms that both hosts pass the loader instance through without wrapping it |
| G3 | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:429-431` (`searchSkills`, in-session code-execution tool) | **Widens**: a globally-OFF skill is listed as invocable inside a running session | **B25** (PR 1), new | The already-async `searchSkills` awaits `getEffectivePluginConfig(root)` and uses its `overlayPluginPaths` and `config.disabledSkillIds`. If the policy is unknown (`isCapabilityPolicyUnknownError`), it lists no local plugin skills and logs. The structural loader interface (`:273-284`) gains the method. | Spec: a global OFF skill → reported disabled or absent. A global OFF opt-out plugin → none of its skills are listed. Unknown policy → no local skills. The remote search is unaffected. |
| G4 | `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:242-255` (`PluginLoaderLike`) and `:668-683` (`getPluginPaths`, the plugin paths handed to spawned agents via `agent-namespace.builder.ts:289-292`) | The interface is what G3 flows through. `getPluginPaths` only narrows (it misses a global ON). | **B25** (PR 1), same file | Add `getEffectivePluginConfig` to `PluginLoaderLike`. `getPluginPaths` uses the effective `config.enabledPluginIds`, and returns `undefined` on unknown (restrictive). | A B25 spec case: a global ON opt-in plugin's path is passed to a spawned agent. Unknown → no plugin paths. |
| G5 | `libs/backend/rpc-handlers/src/lib/harness/workspace/harness-workspace-context.service.ts:350,353` (`discoverAvailableSkills`, harness wizard summary) | Display only: the wizard can show a globally-OFF skill as available. It cannot load one, because sessions are governed by G1/G3 and the B8 flags. | **B26** (PR 2) | Await `getEffectivePluginConfig(root)` | Spec: a global OFF skill is not offered as available |
| G6 | `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:873-874` (`activeSkillOwners` → `predictCollisions` at install) | Display only: it may over-report a shadowing skill, which errs cautious | **B26** (PR 2) | Same | Spec: a globally-OFF plugin's skills do not appear as collision owners |
| G7 | `plugin-rpc.handlers.ts:255,340,756,796` (legacy Plugins panel get/save and external activate/deactivate) | Intentionally WORKSPACE: these read-modify-write the workspace `PluginConfigState` | none (documented) | No change. Writing the layered config back would copy global items into the workspace and break inheritance (D1). The legacy panel shows the workspace layer, and the Marketplace shows the effective state; AC-3.3 is about the workspace layer. | The B17 write-path trace confirms that no workspace save path persists a layered config |
| G8 | `setup-rpc.handlers.ts:140-147`, `wizard-generation-rpc.handlers.ts:804-811`, `enhanced-prompts-rpc.handlers.ts:714-718`, `harness-rpc.handlers.ts:827` | Generation inputs only (skill discovery for wizard and prompt generation). They read the workspace `enabledPluginIds`: they narrow and never widen, and no session is built from them. | none (documented) | No change | n/a |
| G9 | `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:71`, `apps/ptah-electron/src/activation/plugin-activation.ts:253,298`, `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:83` | User-layer mirror SOURCE lists and a boot log count; they are not policy. Per-workspace policy is applied afterwards by the reconciler through G1's overlay and disabled ids, which include global ONs. | none (documented) | No change | Covered by the G1 spec |
| G10 | `libs/backend/rpc-handlers/src/lib/chat/session/chat-sdk-context.service.ts:83-95` (`resolvePluginPaths`) | No caller found in the repository (grep across `libs` and `apps`, 2026-09-26); chat sessions get plugins and skills through the G1 harness copies | none (documented) | No change. Its removal as dead code is out of scope for this task. | n/a |

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1 (flag-tier deny and approve behaviour): unit-covered in Batch 8, then **closed live in Batch 17** by the
  senior-tester. Check: in this repository, with `.claude/settings.local.json` `enableAllProjectMcpServers: true`,
  turn davinci-resolve, firecrawl and shopify-dev-mcp off, keep ptah on, and start a proxied session (custom base
  URL). The captured first request body must contain none of their tool schemas, and the init `mcp_servers` must
  list only ptah plus the explicitly approved servers. Turning firecrawl on explicitly must make it load.
- A2 (`skillOverrides`, `deniedMcpServers` and `skills: []` honoured on CLI 0.3.278): the installed
  `@anthropic-ai/claude-agent-sdk` is 0.3.278 (verified). Unit-covered in Batch 8, then **closed live in Batch 17**.
  Check: a disabled skill is absent from the system-init `skills`. A corrupted item file gives init `skills: []`
  with ptah as the only MCP server, and the chat chip shows `capability-policy-unverified`.
- A3 (Codex `enabled=false` with quoted keys), PR 2: unit-covered in Batch 18 (parse) and Batch 22 (serialised
  argv), then **closed live in Batch 24**. Check: a Codex lane with a disabled global server whose name needs
  quoting (for example `my.server`) does not start that server, as shown by the lane's MCP startup events and
  tool list.
- A4 (`mcpServerStatus` and `getContextUsage` safe mid-turn), PR 2: unit-covered in Batch 20 (bounded 3 s,
  timeout → unknown), then **closed live in Batch 24**. Check: call a measurement during an active streaming turn;
  the turn completes with no stream error, and the figure or "unknown" is returned within 3 s.
- A5 (AC-5.3 method agreement), PR 2: a Batch 20 fixture test puts ptah's measured figure within 10% of a direct
  count of its `tools/list` fixture. **Closed live in Batch 24** by comparing the live ptah figure with a direct
  count of the live `tools/list` payload.
- A-PR2 (C6 file list derived by the team-leader): verified at PR 2 kickoff before Batch 22 starts.
- A-UI (UI reads enforcement labels and declarations from data): Batch 13 and Batch 14 render
  `CAPABILITY_ENFORCEMENT` and a declaration LIST, never literals. PR 2 can then flip rows and add the #16
  declarations without touching UI files or tests. Checked by the Batch 13/14 reviewer.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1: the `'policy-unknown'` union member breaks the marketplace typecheck (P1) | HIGH | Task 1.6 in Batch 1 adds the case; the Batch 1 check includes `@ptah-extension/marketplace` |
| R2: harness-sync cannot import the agent-sdk error class (P5) | HIGH | Task 1.1 adds the shared discriminator; Tasks 3.1 and 5.2 use it; the Batch 3 spec throws a structurally-matching error |
| R3: PR 1 budget is tight (81 code + ~13 docs = ~94; hard cap 99) | MEDIUM | Running count below. Before and after screenshots are NOT committed (kept outside the repo, with paths in visual-review.md). Every unplanned file must be counted in the batch report, and the team-leader stops at 97. |
| R4: the Marketplace shell banner may need `marketplace-shell.component.html` (the plan lists "shell" as one file) | LOW | Allowed as +1 in Batch 13 when the banner cannot be done in the `.ts` template; it is counted |
| R5: parallel batches editing projects that another in-flight batch reads (cli-agent-runtime reads agent-sdk and harness-sync) give transient typecheck noise | MEDIUM | Parallelism map: separate worktrees are REQUIRED for the same project and RECOMMENDED for producer/consumer pairs |
| R6: the PR 2 enforcement flip would break PR 1 UI/e2e assertions if they hard-code "not enforced" | MEDIUM | A-UI: tests derive the expected labels from `CAPABILITY_ENFORCEMENT` or from fixture data (Tasks 13.3, 16.1) |
| R7: a first `set()` in a fresh workspace races the import (N2) | HIGH | Task 7.1: `set` awaits `ensureImported`, then does its own atomic write; a named test proves it |
| R8: an unknown policy is silently widened anywhere | HIGH | Fail-closed tests in Batches 3, 4, 5, 7, 8 and 9; the reviewer must check each for the unknown path |
| R9: `protocol-dispatcher.ts` must not be edited (TASK_2026_559) | HIGH | No batch lists it; every batch commit is checked with `git diff --name-only` |
| R10: new backend services must log through `IOutputChannel` | LOW | Stated in Tasks 6.1, 6.2, 7.1 and 20.1; checked by the reviewer |
| R11 (P9): a global skill/plugin OFF is shown OFF but ignored by the harness copies and the in-session skill list | HIGH | G1 and G2 in B3, and G3 and G4 in B25, both in PR 1. The reviewer acceptance items are in each batch. B17 re-tests live: a global OFF skill is absent from `.claude/skills` and from `ptah.harness.searchSkills`. |
| R12: making `PluginConfigSourceResolver.resolve` async ripples into about 20 reconciler specs whose fakes return synchronously | MEDIUM | The port type is `HarnessSourceState \| Promise<HarnessSourceState>`, and the reconciler `await`s it, so the existing sync fakes stay valid. No existing spec file is edited (budget). |

Edge cases:

- Crash mid-import (only `.tmp` left) → re-import on the next resolve. Handled in Task 6.1.
- A clear (`inherit` tombstone) written before, during or after an import stays cleared. Task 6.1 (D1).
- The D2 collision pair `"x".repeat(121)` vs `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1`. Tasks 1.1 and 6.1.
- win32 alias, case-sensitive `Repo`/`repo`, sub-folder and worktree roots (N7). Tasks 6.1 and 7.1.
- A corrupt item file or `imported.json` → unverified (strict MCP + `skills: []`). Tasks 6.1, 7.1 and 8.1.
- A corrupt store while a plugin was previously disabled → the plugin and its child skills stay absent (N3).
  Task 3.2.
- Codex config EACCES → `inspect` error, while legacy `readAll` stays empty (N9). Task 4.3.
- A same-name Codex-global server at workspace install → approved (N6). Tasks 7.1 and 11.1.
- A back-off server toggled ON stays suppressed (AC-4.7). Task 8.1.
- Ptah OFF → the warning (AC-4.6); ptah is present by default in every built session. Tasks 8.1 and 13.2.
- A legacy CLI `plugins:save-config` write changes the fingerprint → forced pass (N4, AC-3.3). Task 5.3.
- A toggle-write failure → UI revert and an error naming the server (AC-1.4). Tasks 6.1, 10.1, 13.1 and 16.1.

## Running changed-file count

PR 1 (code files + task docs; must stay under 100):

**Budget rules (set at the Batch 1 commit):**

- Review evidence is kept in two ROLLING files: `reviews/code-logic-review.md` and `reviews/code-style-review.md`.
  - The Batch 1 reviews were renamed into them, with their content unchanged.
  - From Batch 2 on, each reviewer APPENDS a `# ... Batch N` section to the matching file. Reviewers must never
    create per-batch files: at 17 batches, per-batch files would add about 21 files and push PR 1 to about 117.
- The visual evidence is written as a section of `test-report.md`, not as a separate `visual-review.md`
  (saving 1 file). Screenshots stay uncommitted (R3).
- Batch 1 landed 10 code files instead of 8: the executor split out `capability-id-codec.ts` and its spec during
  revise round 1, which the style review asked for.

| After batch | Code files added | PR 1 code total | Docs total | PR 1 total |
| --- | --- | --- | --- | --- |
| 1 (actual) | 10 | 10 | 11 (task.md, task-description.md, research-report.md, implementation-plan.md, 4 plan-review files, batches.md, reviews/code-logic-review.md, reviews/code-style-review.md) | 21 |
| 4 (actual; +1 `harness-sync/src/index.ts` type exports, added in revise round 1) | 6 | 16 | 11 | 27 |
| 5 (actual) | 7 | 23 | 11 | 34 |
| 6 (actual) | 4 | 27 | 11 | 38 |
| 2 (actual; +2 unplanned: `session-mcp-status.spec.ts`, vscode-core `rpc-handler.ts`; `457fe1bfa` on its branch, cherry-pick pending) | 5 | 32 | 11 | 43 |
| 7 | 6 | 38 | 11 | 49 |
| 8 (in review; +2 unplanned: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`, `.../helpers/sdk-query-options-builder.output-style.spec.ts`) | 10 | 48 | 11 | 59 |
| 3 (+1 Electron `phase-2-libraries.ts`, P9 G2) | 6 | 54 | 11 | 65 |
| 10 (-1: schema inlined, budget fallback) | 5 | 59 | 11 | 70 |
| 13 | 5 | 64 | 11 | 75 |
| 9 | 4 | 68 | 11 | 79 |
| 14 | 9 | 77 | 11 | 88 |
| 25 (new, P9 G3/G4) | 3 | 80 | 11 | 91 |
| 11 | 3 | 83 | 11 | 94 |
| 12 | 2 | 85 | 11 | 96 |
| 16 (-1: fixtures kept in the spec, budget fallback) | 1 | 86 | 11 | 97 |
| 17 | 0 | 86 | 8 (after L1) + test-report.md = 9 | **95 (L1 applied)** |

(Rows are in expected commit order. B15's 4 files moved to PR 2.)

- Arithmetic:
  - P9 amendment: 95 + 1 (B4 `index.ts`) + 1 (B3 Electron wrapper) + 3 (B25) - 4 (B15 → PR 2) = 96.
  - B2 update (2026-09-26): + 2 (B2 unplanned) - 1 (B10 schema inlined) - 1 (B16 fixtures in spec) = 96.
  - B8 update (2026-09-26): + 2 (B8 unplanned) = **98 before L1**.
    - **This crosses 97, so L1's trigger condition is MET.** L1 is due in the next `task-specs` commit, and it
      takes the plan to **95**.
    - **L1 APPLIED (2026-09-26), in the task-specs commit that follows `e0ba036f0`.**
      - `implementation-plan-review.md` now holds rounds 1, 2, 3 and the delta, each verbatim under its own
        heading. This was checked by a substring comparison against each committed original, with LF line
        endings.
      - `-r2`, `-r3` and `-delta` are removed with `git rm`.
      - Docs total: 11 → 8 (plus test-report.md at B17 = 9).
      - **PR 1 plan: 95.**
    - With L1 applied, the worst case with all three contingencies below is 98.
- Both absorbers are now SPENT. The remaining contingencies have no absorber:
  - R4 (shell html, +1) → 97;
  - a `.ptah/specs/registry.md` touch (+1) → 98;
  - a B11 surface-exclusion file outside `container.ts` (+1) → 99, which is the hard ceiling.
- Rule:
  - Every executor report must list unplanned files, and the team-leader re-counts this table at each commit.
  - Before accepting any unplanned file that would take the plan past 97, the team-leader returns to the
    orchestrator with options instead of committing.
  - **L1 (APPLIED 2026-09-26): merge the plan-review history files (-3; orchestrator decision).**
    - When to apply: only when an extra file would push PR 1 past 97, or at the latest in the Mode 3 completion
      step, before PR 1 is opened.
    - What to do:
      - Merge `implementation-plan-review-r2.md`, `implementation-plan-review-r3.md` and
        `implementation-plan-review-delta.md` into `implementation-plan-review.md`. There is one heading per round
        (round 1, round 2, round 3, delta), and the content of each round is copied verbatim.
      - `git rm` the other three in the same `task-specs` commit.
      - These files were added on this branch, so the deleted ones drop out of the PR diff, and no code changes.
    - Confirm the saving with `git diff --stat c4bdc87dd | tail -1` after applying.
    - With L1 applied, the plan is 95 and the worst case with every contingency is 98. (Before B8 added 2 files,
      that worst case was 96.)
  - After L1, the only known lever left is `provider-list-view.testing.ts` in B14, if the helper needs no change
    (-1).
  - The B9 chip change can NOT be deferred: the chip hard-codes the connector copy for every notice, so the new
    notice would render the wrong text.
  - Anything beyond that is a scope decision for the orchestrator or the user.

PR 2 (counted separately against its own stacked base):

| After batch | Code files | PR 2 total (with docs) |
| --- | --- | --- |
| 18 | 2 | 2 |
| 19 | 3 | 5 |
| 20 | 4 | 9 |
| 21 | 2 | 11 |
| 22 | 6 | 17 |
| 23 | 4 | 21 |
| 15 (moved from PR 1) | 5 | 26 |
| 26 (new, P9 G5/G6) | ~3 | ~29 |
| 24 | 0 | ~29 + ~4 docs (batches.md, test-report.md, code-logic-review.md, code-style-review.md) = **~33** |

## Parallelism map

At most 3 batches run at once. "Worktree" means a separate `git worktree` off the current branch head, with
`node_modules` as a junction to the main checkout. The team-leader verifies and commits each batch on the
feature branch in wave order; a parallel batch's worktree is rebased or cherry-picked onto the branch before
its commit.

| Wave | PR | Batches (projects) | Separate worktrees |
| --- | --- | --- | --- |
| W1 | 1 | B1 (shared, marketplace) | n/a |
| W2 | 1 | B4 (harness-sync) ∥ B5 (agent-sdk) ∥ B6 (cli-agent-runtime) | Chosen layout: **B5 runs in the feature worktree** (TASK_WT). **B4 → `.claude-worktrees/feat-task-2026-560-b4`** (branch `feat/task-2026-560-b4-facet-inspect`). **B6 → `.claude-worktrees/feat-task-2026-560-b6`** (branch `feat/task-2026-560-b6-toggle-store`). The two new worktrees branch from the feature-branch HEAD and have a `node_modules` junction. This isolates B6's cli-agent-runtime typecheck from B4 and B5's in-flight edits. The team-leader commits each accepted batch on its own branch, cherry-picks it onto `feat/task-2026-560-mcp-skill-toggles`, and then removes the worktree and branch. |
| W3 | 1 | B7 (cli-agent-runtime) ∥ B8 (agent-sdk) ∥ B2 (shared) | RECOMMENDED for B7 vs B8 (cli-agent-runtime imports agent-sdk) and for B2 (shared is read by all) |
| W4 | 1 | B3 (harness-sync, ptah-electron) ∥ B10 (rpc-handlers) ∥ B13 (marketplace) | Not required (disjoint projects) |
| W5 | 1 | B9 (cli-agent-runtime, chat) ∥ B14 (marketplace) ∥ B25 (vscode-lm-tools) | Not required (disjoint projects). B15 left this wave (moved to PR 2), so no same-project pair remains in PR 1. |
| W6 | 1 | B11 (rpc-handlers, cli-engine) ∥ B12 (ptah-electron, ptah-extension-vscode) | Not required (disjoint projects); RECOMMENDED because B12 typechecks against rpc-handlers |
| W7 | 1 | B16 (webview-e2e-harness) | n/a |
| W8 | 1 | B17 (live verification, all PR 1 projects) | n/a; open PR 1 after B17 |
| P1 | 2 | B18 (harness-sync) ∥ B19 (cli-agent-runtime) ∥ B20 (agent-sdk) | Not required; RECOMMENDED for B19 (reads harness-sync) |
| P2 | 2 | B21 (ptah-cli) ∥ B22 (cli-agent-runtime) ∥ B15 (marketplace, webview-e2e-harness) | Not required |
| P3 | 2 | B23 (cli-agent-runtime, shared) ∥ B26 (rpc-handlers) | Not required |
| P4 | 2 | B24 (live verification) | n/a |

Same-project pairs that must never share a worktree while both are in flight: B3/B4 and B3/B12 (ptah-electron;
different waves), B5/B8, B6/B7/B9, B10/B11, B13/B14, B19/B22/B23. No same-wave same-project pair remains.

Critical path (PR 1): B1 → B5 → B7 → B10 → B11/B12 → B16 → B17. The UI path (B2 → B13 → B14) and the P9 path
(B3, B25) run alongside it.

## Visual evidence plan (Mode 3 requirement)

Existing surfaces gain controls, and no new surface is added, so no prototype is required. Mode 3 therefore
needs before and after screenshots, in dark and light themes, of:

- the Installed servers page and the server detail;
- the Installed skills page and the skill detail;
- the chat MCP chip.

- **Before**: a visual-reviewer captures these from the base commit `c4bdc87dd` BEFORE Batch 13 is committed
  (this is scheduled as the W4 entry step).
- **After**: captured in Batch 17.
- Screenshots are stored outside the repository, and a "Visual evidence" section of `test-report.md` records
  their paths. They are not committed (R3 and the budget rules).

Parity: not applicable. No surface is replaced, consolidated, rebuilt or redesigned; controls are added to
existing pages.

Write-path trace (Mode 3): the writes go to `~/.ptah/capabilities/**` (Batch 6) and `PluginConfigState`
(`saveWorkspacePluginConfig`, Batches 5 and 7). Their readers are the resolver (Batch 7), the plugin loader
(Batch 5), the harness source resolver (Batch 3) and the Ptah CLI `plugin` command (AC-3.3). Batch 17 records
the trace.

---

## Batch 1: Shared contract and pure rules (PR 1) — COMPLETE (commit 4876206a7)

- Result:
  - 10 code files. The two unplanned ones are `libs/shared/src/lib/types/capability-id-codec.ts` and its
    `.spec.ts`, split out in the revise round.
  - Both reviewers accepted: code-logic APPROVE, and code-style APPROVE after revise round 1. One minor note
    remains: the codec file name is narrower than its content, because it also holds `tomlKeySegment` and the
    fingerprint. That is left as it is.
  - Check: 2 projects, and lint, typecheck and test all pass.
  - The team-leader verified on disk:
    - the SHA-256 is pure (only the spec imports `node:crypto`, to cross-check);
    - the D2 vectors appear verbatim at `capability-id-codec.spec.ts:26-30`;
    - `isCapabilityPolicyUnknownError` is at `capability-toggle.types.ts:609`;
    - the badge case is at `harness-health-badge.component.ts:265`.
- Downstream note: import `CapabilityKind`, the codec, `tomlKeySegment`, `harnessPolicyFingerprint` and
  `isHarnessPassAcknowledged` from `@ptah-extension/shared` (they live in `capability-id-codec.ts`).

- PR: 1
- Goal: land the C1 contract that TASK_2026_559 consumes: the types, the pure resolution rules, the filename
  codec, the fingerprint and the extended unions, and keep marketplace compiling after the union change.
- Nx projects: `@ptah-extension/shared`, `@ptah-extension/marketplace`
- Depends on: none
- Recommended executor: backend-developer
- Fallback executor: senior backend sub-agent (general-purpose)
- Execution mode: sequential
- Rationale: one pure-types library plus one mechanical exhaustive-switch case; the types are tightly coupled.
- Reviewers: code-logic-reviewer (rules and codec correctness), code-style-reviewer (touches a UI component)
- ACs proved: AC-1.3 (`nextWorkspaceValue`), AC-2.1 (`classifyMcpScope`), AC-2.5 (`definitionInEffect` pinned),
  AC-3.2 (`pluginConfigLayer` preserves legacy semantics), AC-4.1 (defaults and `resolveEffective`), and the
  D2 codec vectors
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/marketplace --parallel=2`
- Commit: `feat(shared,marketplace,task-specs): batch 1 - add capability toggle contract`. This commit ALSO
  stages the task docs: `.ptah/specs/TASK_2026_560_2ae5/{task.md,task-description.md,research-report.md,implementation-plan.md,implementation-plan-review.md,implementation-plan-review-r2.md,implementation-plan-review-r3.md,implementation-plan-review-delta.md,batches.md}`.
- Files (8 code):
  - C `libs/shared/src/lib/types/capability-toggle.types.ts`
  - C `libs/shared/src/lib/types/capability-toggle.types.spec.ts`
  - M `libs/shared/src/index.ts`
  - M `libs/shared/src/lib/types/harness-sync.types.ts`
  - M `libs/shared/src/lib/types/rpc/rpc-misc.types.ts`
  - M `libs/shared/src/lib/types/mcp-directory.types.ts`
  - M `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts`
  - M `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts`
  - C `libs/shared/src/lib/types/capability-id-codec.ts` (added in the revise round)
  - C `libs/shared/src/lib/types/capability-id-codec.spec.ts` (added in the revise round)

### Task 1.1: Capability contract, codec and pure rules — COMPLETE

- File: `libs/shared/src/lib/types/capability-toggle.types.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:78-110 (Resolution rules), :141-164 (C1), :176-186 (codec)
- Pattern to follow: `libs/shared/src/lib/types/harness-sync.types.ts` (types + pure reducer in shared)
- Quality requirements:
  - `CapabilityEntry`, `EffectiveCapabilitySet`, `ICapabilityResolver`, `ICapabilityGlobalLayer`.
  - `CAPABILITY_ENFORCEMENT`: codex, opencode, antigravity MCP rows and `ptah-cli-proxy` are `not-enforced`.
  - Pure functions: `defaultEnabled`, `resolveEffective`, `nextWorkspaceValue`, `pluginConfigLayer`,
    `classifyMcpScope`, `definitionInEffect`, `planApprovalImport`, `isMcpServerEnabled`, `tomlKeySegment`,
    `harnessPolicyFingerprint` (sorted canonical JSON → FNV-1a; no `crypto`, because shared ships to the
    browser), `isHarnessPassAcknowledged`, `encodeCapabilityId` / `decodeCapabilityId` / `canonicalFilename`.
- Validation notes:
  - D2: the literal form is `l_<pct>`, and the hashed form is `h_<sha40>` when `pct` is longer than 120.
  - The fixed vector: `"x".repeat(121)` → `mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`, and id
    `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` → `mcp__l_h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`.
  - SHA-256 in shared must not pull in Node `crypto`. Either use a pure implementation, or have the codec take an
    injected hasher that the store provides. Choose one and state it in the report.
  - R2: export `CAPABILITY_POLICY_UNKNOWN_ERROR_NAME` and `isCapabilityPolicyUnknownError(e)`.
  - The `inherit` tombstone skips the imported layer.
- Implementation details: export from `libs/shared/src/index.ts`. The spec covers every Resolution rules bullet,
  fingerprint stability under key reordering, and the acknowledgement predicate (a mismatch, `writeFailed`,
  `null` and `sources !== 'ok'` are all not acknowledged).

### Task 1.2: Extend existing shared types — COMPLETE

- Files: `harness-sync.types.ts`, `rpc/rpc-misc.types.ts`, `mcp-directory.types.ts`, `src/index.ts`
- Plan reference: implementation-plan.md:157-159
- Quality requirements:
  - Add `HarnessHealth.policyFingerprint?`.
  - Add `HarnessSourcesStatus |= 'policy-unknown'`; the shared reducer (`harness-sync.types.ts:~294`) maps it
    to `degraded`.
  - Add `PluginConfigState.enabledSkillIds?` and `InstalledMcpServer.scope?`.
- Validation notes: all additions are optional, so pre-task configs still load (AC-3.2).

### Task 1.3: Keep the marketplace health badge exhaustive — COMPLETE

- File: `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:259-267` (+ spec)
- Quality requirements: add a `'policy-unknown'` case with a note stating that the skill and plugin sync is
  paused because Ptah couldn't read the capability policy. Add a spec case.
- Validation notes: R1. No other change to the component.

### Batch 1 verification

- Every listed artifact exists and holds the required work; no `crypto` import in shared.
- The check command passes.
- code-logic-reviewer and code-style-reviewer accept.
- The D2 vectors are in the spec verbatim.

## Batch 2: Shared RPC surface and policy notice (PR 1) — COMPLETE (commit e0ba036f0)

- Result:
  - 5 code files (3 planned + 2 unplanned, both recorded below).
  - code-logic-reviewer: APPROVE 9/10. The moderate issue is the `schemas.ts:252` follow-up (recorded below). The
    minor issue is that an `explicit` flag with `scope: 'global'` is only rejected at runtime; that is a B10
    acceptance item.
  - Check: shared and vscode-core lint, typecheck and test all pass.
  - Committed as `457fe1bfa` in the b2 worktree. The drift check was clean, and the commit was cherry-picked as
    `e0ba036f0`. The b2 worktree and branch are removed.
- The team-leader verified on disk:
  - the registry entries are at `rpc.types.ts:1401-1411`, the allowlist entries at `:3631-3633`, and the re-export
    at `:41`;
  - the notice code is in both the type and `NOTICE_CODES` (`session-mcp-status.ts:72,100`), with a spec case at
    `:57`;
  - vscode-core accepts `'capabilities:'`.

- PR: 1
- Goal: add `capabilities:getState`, `capabilities:getEffective` and `capabilities:setEnabled`, and the
  `capability-policy-unverified` notice code.
- Nx projects: `@ptah-extension/shared`, `@ptah-extension/vscode-core`
- Depends on: B1
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: contract for AC-1.4, AC-3.1, AC-4.6 (unverified notice) and AC-5.1/5.2 (`schemaTokens?`)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/vscode-core --parallel=2`
- Commit: `feat(shared,vscode-core): batch 2 - add capabilities rpc methods and policy notice`
- Files (5 code; +2 unplanned, recorded 2026-09-26, the second by orchestrator decision):
  - C `libs/shared/src/lib/types/rpc/rpc-capability.types.ts`
  - M `libs/shared/src/lib/types/rpc.types.ts` (re-export plus method registry entries; pattern `rpc.types.ts:11-19`)
  - M `libs/shared/src/lib/types/messages/session-mcp-status.ts` (add to `SessionMcpNoticeCode` and `NOTICE_CODES`)
  - M `libs/shared/src/lib/types/messages/session-mcp-status.spec.ts` (unplanned: the new-notice parse case)
  - M `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (unplanned: adds `'capabilities:'` to
    `ALLOWED_METHOD_PREFIXES`; without it the host rejects the new methods)
- **Known transient failures on the branch after B2 lands (NOT regressions):**
  - B2 adds three methods to the RPC registry before any handler owns them. Two surface-parity specs therefore fail
    until their owning batches land:
    - `libs/backend/rpc-handlers/.../rpc-allowlist.spec.ts:41-43` ("claims every registry method exactly once") →
      fixed by **B10**;
    - `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:60` (391 vs 388) → fixed by **B11**.
  - Every batch check that runs `@ptah-extension/rpc-handlers` or `@ptah-extension/cli-engine` before B10 or B11
    reports these two failures and only these; any other failure there is real.
  - The B2 check itself (shared, vscode-core) does not run them.
- Follow-up (NOT in PR 1; record it in the PR 1 description):
  - `libs/shared/src/lib/types/messages/schemas.ts:252` has a Zod notice-code literal without
    `'capability-policy-unverified'`.
  - Today only a spec imports that schema, so no runtime path is affected. Align it when a runtime consumer adopts
    the schema, or in PR 2 if budget allows.

### Task 2.1: RPC types and registry — COMPLETE

- Plan reference: implementation-plan.md:156, :362-366
- Quality requirements: the request and response types carry the `scope: 'workspace' | 'global'`, `kind`, `id`,
  `enabled` and `explicit` fields that C8 needs. The response carries the updated `CapabilityEntry`. Do not edit
  `libs/shared/src/index.ts` (it is owned by B1); export through `rpc.types.ts`.

### Task 2.2: Notice code — COMPLETE

- Quality requirements: `'capability-policy-unverified'` is accepted by the parser at `session-mcp-status.ts:~133`.
  Otherwise the notice is dropped silently.

## Batch 3: Harness freeze on unknown policy (PR 1) — PENDING

- PR: 1
- Goal: C3, harness-sync half. The source resolver maps the structural policy-unknown error to a frozen state,
  and the reconciler skips skill, plugin and agent planning and stamps the fingerprint.
- Nx projects: `@ptah-extension/harness-sync`, `ptah-electron`
- Depends on: B1 (compile). B5 at runtime: `getEffectivePluginConfig` is consumed structurally, and B5 lands in
  W2 first.
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: AC-3.3 (fingerprint stamped), AC-3.4 (a frozen harness never re-adds a disabled plugin, and a
  GLOBAL OFF reaches the harness copies), D1 for skills and plugins (G1/G2), N3
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-sync,ptah-electron --parallel=2`
- Commit: `feat(harness-sync,electron): batch 3 - apply layered policy in harness sync`
- **Reviewer acceptance items (mandatory, P9 G1/G2/G2b):**
  - `resolve` calls `getEffectivePluginConfig` once per pass when the reader provides it. `overlayPluginPaths`,
    `disabledSkillIds`, `config` and `policyFingerprint` all come from that ONE result; no workspace-only sync
    call is mixed in.
  - A reader without the method keeps today's semantics, and the port union type keeps every existing
    reconciler spec unchanged (R12).
  - Spec proof:
    - a global OFF on an opt-out plugin with no workspace entry → absent from the overlay, and its skill copies
      are absent after a reconcile;
    - a global OFF skill → its copy is absent;
    - a global ON on an opt-in plugin → present;
    - a workspace entry beats a global one.
  - `isCapabilityPolicyUnknownError` → frozen (skill, plugin and agent writes and removals are zero).
  - Electron `phase-2-libraries.ts`: the new wrapper member forwards `workspaceRoot`, and it folds
    `readDormantSkillSlugs` into the effective disabled ids.
  - The VS Code (`phase-2-libraries.ts:173-178`) and CLI (`cli-engine/src/lib/container.ts:645-650`) hosts pass
    the loader instance unwrapped (verify; no edit).
- Files (6 code):
  - M `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts`
  - C `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.spec.ts` (P2)
  - M `libs/backend/harness-sync/src/lib/sources/harness-source.port.ts`
  - M `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts`
  - C `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.capability-policy.spec.ts`
  - M `apps/ptah-electron/src/di/phase-2-libraries.ts` (G2; added at the P9 amendment)

### Task 3.1: Source resolver and port — PENDING

- Plan reference: implementation-plan.md:252-261
- Quality requirements:
  - `HarnessPluginConfigReader` gains optional `getEffectivePluginConfig`.
  - `HarnessSourceState` gains `policyUnknown?` and `policyFingerprint?`.
  - `isCapabilityPolicyUnknownError` → `{policyUnknown: true}`. Every other read failure keeps today's unfiltered
    semantics (`plugin-config-source-resolver.ts:136-150`).
- Validation notes: R2. No import from `@ptah-extension/agent-sdk`.
- P9 G1: `HarnessPluginConfigReader.getEffectivePluginConfig?(root): Promise<{config, fingerprint,
  overlayPluginPaths}>` is a structural mirror of agent-sdk's `EffectivePluginConfig`. `resolve` awaits it when it
  is present. It returns `HarnessSourceState | Promise<HarnessSourceState>` (R12).

### Task 3.3: Electron reader wrapper forwards the effective config — PENDING

- File: `apps/ptah-electron/src/di/phase-2-libraries.ts:200-231`
- Quality requirements: add `getEffectivePluginConfig: async (workspaceRoot) => { const e = await
  loader.getEffectivePluginConfig(workspaceRoot); return {...e, config: {...e.config, disabledSkillIds:
  [...e.config.disabledSkillIds, ...readDormantSkillSlugs(container)]}}; }`. Keep the existing three members. Add
  a comment in the file's own style saying why dormant slugs are folded here too.

### Task 3.2: Reconciler freeze and fingerprint — PENDING

- Plan reference: implementation-plan.md:257-266; health assembly is at `harness-reconciler.service.ts:238-245,431-436`
- Quality requirements:
  - When `policyUnknown`, MCP intents proceed, and skill, plugin and agent writes and removals are zero.
  - Health `sources: 'policy-unknown'`.
  - `policyFingerprint` is stamped on every health.
  - Spec: a previously disabled plugin and its skill copies stay absent across a frozen pass.
  - P9 G1 spec: global OFF opt-out plugin → no copies; global OFF skill → no copy; global ON opt-in plugin →
    copies; a workspace entry beats a global one.
  - The reconciler awaits `sourceResolver.resolve(...)` at both call sites (`:200`, `:383`).

## Batch 4: Status-bearing MCP facet inspect (PR 1) — COMPLETE (commit 5f6a750e8)

- Result:
  - 6 code files: the planned 5, plus `libs/backend/harness-sync/src/index.ts`, which exports the
    `McpFacetInspection` and `McpSourceStatus` types (2 lines, added in revise round 1).
  - code-logic-reviewer: APPROVE 9/10 after revise round 2.
  - Check: harness-sync lint, typecheck and test all pass.
  - Committed as `e10baf4b4` in the b4 worktree. The drift check was clean (no change to any of the 6 files on the
    feature branch since `cac3db9e2`), and the commit was cherry-picked onto the feature branch as `5f6a750e8`.
    The b4 worktree and branch are removed.
- The team-leader verified on disk:
  - `inspect` is on the port (`mcp-facet.port.ts:152`), and JSON and Codex implement it;
  - the Codex `inspect` goes through `readStatus` (`codex-toml-mcp-facet.ts:150-151`);
  - the ENOENT → `missing` and EACCES → `error` tests are at `codex-toml-mcp-facet.spec.ts:263,301`, and the second
    test also shows the legacy `readAll` still reads as empty;
  - no quoted-key parsing (PR 2).

- PR: 1
- Goal: C4 facets. `inspect(root) → {status, error?, servers}`, and a Codex `readStatus` that separates ENOENT
  from other errors (N9).
- Nx projects: `@ptah-extension/harness-sync`
- Depends on: B1
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: AC-2.1 (source status per declaration), N9 fail-closed input
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-sync --parallel=2`
- Commit: `feat(harness-sync): batch 4 - add status-bearing mcp facet inspect`
- Files (5 code):
  - M `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet.port.ts`
  - M `libs/backend/harness-sync/src/lib/targets/mcp/json-mcp-facet.ts`
  - M `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts`
  - M `libs/backend/harness-sync/src/lib/targets/mcp/opencode-mcp-facet.spec.ts`
  - M `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.spec.ts`

### Task 4.1: Port and JSON facet `inspect` — COMPLETE

- Plan reference: implementation-plan.md:275-280
- Quality requirements: the result type is declared in `mcp-facet.port.ts`, which is already exported
  (`harness-sync/src/index.ts:180-181`). No `index.ts` edit is expected; if one is needed, report it as an
  unplanned file.

### Task 4.2: Codex `readStatus` — COMPLETE

- Quality requirements: a private `readStatus(root) → {status: 'ok'|'missing'|'error', text, error?}`. Legacy
  `readAll` is byte-for-byte unchanged in behaviour (`codex-toml-mcp-facet.ts:109-110,187-195`). No quoted-key
  parsing (that is PR 2, Batch 18).

### Task 4.3: Regression specs — COMPLETE

- Quality requirements: EACCES → `inspect` returns `error` and `readAll` returns empty; ENOENT → `missing`. The
  opencode spec covers JSON `inspect`.

## Batch 5: agent-sdk tokens, loader layering and HarnessPolicySync (PR 1) — COMPLETE (commit 1e7aab5bb)

- Result:
  - 7 code files, as planned.
  - code-logic-reviewer: APPROVE after revise round 1. Its Serious-1 (the global layer is unreachable from the
    sync callers) is resolved at the batch-plan level by P9: G1/G2 in B3, G3/G4 in B25, and G5/G6 in B26 (PR 2).
  - Check: agent-sdk lint, typecheck and test all pass.
- The team-leader verified on disk:
  - the four tokens are at `di/tokens.ts:189-205`;
  - `HarnessPolicySync` is registered (`di/register.ts:554`) and exported with `CapabilityPolicyUnknownError` and
    `EffectivePluginConfig` (`src/index.ts:327-332`);
  - the error's `name` is the shared constant (`plugin-loader.service.ts:95-105`);
  - both sync readers are documented "WORKSPACE LAYER ONLY" (`:1216`, `:1484`);
  - the force rule and `lastAck` are at `harness-policy-sync.ts:49-92`.

- PR: 1
- Goal: C3 loader half, the C5 tokens and C5a.
- Nx projects: `@ptah-extension/agent-sdk`
- Depends on: B1
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: AC-3.2 (legacy `PluginConfigState` unchanged), AC-3.3 (a legacy CLI save changes the fingerprint →
  forced pass), AC-4.9 (next-session application), N3 (restrictive on unknown), N4
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/agent-sdk --parallel=2`
- Commit: `feat(agent-sdk): batch 5 - layer capability policy into plugin loader`
- Files (7 code):
  - M `libs/backend/agent-sdk/src/lib/di/tokens.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`
  - C `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.capabilities.spec.ts`
  - C `libs/backend/agent-sdk/src/lib/harness/harness-policy-sync.ts`
  - C `libs/backend/agent-sdk/src/lib/harness/harness-policy-sync.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/di/register.ts`
  - M `libs/backend/agent-sdk/src/index.ts`

### Task 5.1: Tokens — COMPLETE

- Plan reference: implementation-plan.md:321-322
- Quality requirements: add `SDK_CAPABILITY_RESOLVER`, `SDK_CAPABILITY_GLOBAL_LAYER`, `SDK_HARNESS_POLICY_SYNC`
  and `SDK_MCP_SCHEMA_SIZE`. Follow the existing `SDK_TOKENS` style.

### Task 5.2: PluginLoaderService effective config — COMPLETE

- Plan reference: implementation-plan.md:245-251, :259-261
- Quality requirements:
  - An optional inject of `SDK_CAPABILITY_GLOBAL_LAYER`.
  - `getEffectivePluginConfig(root)` returns config + fingerprint from ONE snapshot, and throws
    `CapabilityPolicyUnknownError` (an `SdkError` whose `name` equals the B1 constant) when unreadable.
  - `resolveCurrentPluginPaths` → `[]` on unknown; `getDisabledSkillIds` → all known skill ids on unknown.
    (P9: both stay synchronous and workspace-only, and their JSDoc says so. Session callers move to
    `getEffectivePluginConfig` in B3 and B25.)
  - `saveWorkspacePluginConfig(config, root?)` captures `storageFor(root)` once.
  - Omitted `enabledSkillIds` is preserved.
- Validation notes: define the error in `plugin-loader.service.ts`, or in a file already listed. Any new errors
  file is unplanned and must be counted.
- Spec: pre-task config unchanged; global OFF / workspace ON; a save during an A→B switch; unknown throws.

### Task 5.3: HarnessPolicySync — COMPLETE

- Plan reference: implementation-plan.md:323-328
- Quality requirements: `apply(physicalRoot, fingerprint)`. It forces when the fingerprint differs from
  `lastAck`, runs at most one extra forced pass on a mismatched or joined result, and records `lastAck` only when
  `isHarnessPassAcknowledged`.
- Spec: acknowledged; mismatch → second pass; `writeFailed` not acknowledged; `null` not acknowledged; a legacy
  CLI save → forced.
- Register the sync in `di/register.ts`, and export it and the error from `src/index.ts`.

## Batch 6: Lock-free capability toggle store and Claude approval reader (PR 1) — COMPLETE (commit d003642a9)

- Result:
  - 4 code files, as planned.
  - code-logic-reviewer: APPROVE 8/10, with all 9 D1/D2 acceptance items RESOLVED and named tests. The one
    moderate issue (a flaky 200-write test) was fixed spec-only by the senior-tester with explicit 30 000 ms
    timeouts at `capability-toggle-store.spec.ts:548,602`; two load runs gave 59/59.
  - Check: cli-agent-runtime lint, typecheck and test all pass.
  - Committed as `e9881a54e` in the b6 worktree. The drift check was clean (none of the 4 paths existed on the
    feature branch), and the commit was cherry-picked as `d003642a9`.
  - The b6 worktree is de-registered, and its junction and branch are removed. An EMPTY directory
    `.claude-worktrees/feat-task-2026-560-b6` remains, locked by a live process handle; run `rmdir` on it later.
- The team-leader verified on disk:
  - no lock, `unlink` or `rm` in the store;
  - writes go through `atomicWriteWithRetry` (`capability-toggle-store.ts:430`), and the filename is checked
    against `canonicalFilename` (`:412`);
  - zod validation;
  - the D2 pair tests are at `capability-toggle-store.spec.ts:270-273`, the tombstone test at `:199`, the `.tmp`
    re-import at `:463` and the concurrent `publishImport` at `:521`;
  - the reader runs git through `execFile` with a timeout (`claude-approval.reader.ts:84-94`).
- Carried to B7: see the B7 acceptance item on `recordWorkspaceRoot`.

- PR: 1
- Goal: C2 store (lock-free, one file per toggle, IMPORTED layer) and the C4 `ClaudeApprovalReader`.
- Nx projects: `@ptah-extension/cli-agent-runtime`
- Depends on: B1 (codec and types; harness-sync `atomicWriteWithRetry` already exists at
  `harness-sync/src/index.ts:296,301`)
- Recommended executor: backend-developer (store, reader and base specs), then senior-tester (the C2 concurrency
  and interruption tests in the same spec file), in sequence within the batch
- Fallback: general-purpose | Mode: sequential
- Rationale: the plan handoff assigns the C2 concurrency tests to senior-tester.
- Reviewers: code-logic-reviewer
- **Reviewer acceptance items (mandatory):**
  - **D1, the IMPORTED layer:**
    - `imported.json` is one file per workspace, published once by `atomicWriteWithRetry`, and its existence is the
      marker.
    - A crash that leaves only `.tmp` → re-import.
    - A corrupt `imported.json` → `error` → unverified, never absent.
    - The `inherit` tombstone skips the imported layer, so a clear written before, during or after an import stays
      cleared.
    - An imported OFF over an inherited ON stays OFF.
    - Two concurrent `publishImport` calls → one complete file, never a mix.
  - **D2, the `l_`/`h_` namespaces:**
    - The reader recomputes `canonicalFilename(kind, id)` from the content and rejects a mismatch (→ `error`).
    - The collision pair `"x".repeat(121)` (→ `mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`) and id
      `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` (→ `mcp__l_h_79072a47….json`) map to different files.
    - Toggling or clearing one leaves the other byte-identical.
- ACs proved: AC-1.1 (persistence), AC-1.4 (EACCES or rename failure rejects; the prior file stays
  byte-identical), AC-2.3 (the global snapshot is unchanged after a workspace write), D1, D2, N7 (`wsKey` on a
  win32 alias vs case-sensitive roots)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime --parallel=2`
- Commit: `feat(cli-agent-runtime): batch 6 - add lock-free capability toggle store`
- Files (4 code):
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-toggle-store.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-toggle-store.spec.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/claude-approval.reader.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/claude-approval.reader.spec.ts`

### Task 6.1: CapabilityToggleStore — COMPLETE

- Plan reference: implementation-plan.md:166-241
- Pattern to follow: `libs/backend/harness-sync/src/lib/fs/atomic-write.ts:36-70`
- Quality requirements:
  - The layout is `~/.ptah/capabilities/{global,workspaces/<wsKey>/items,workspaces/<wsKey>/imported.json,root.json}`.
  - `wsKey = sha256(policyKey).slice(0,32)`.
  - Items are validated by zod.
  - Every read is a fresh `readdir` with no cache. Unknown names are ignored and logged; 0-byte or unparseable
    files are errors.
  - `setExplicit` writes `on`.
  - Ptah never deletes an item.
  - The class implements `ICapabilityGlobalLayer` and exposes `fingerprintEntries` (skill and plugin items only).
  - It logs through `IOutputChannel` (`PLATFORM_TOKENS.OUTPUT_CHANNEL`).
- Validation notes: no lock, and no import of harness-sync `file-lock.ts`. The tests use a real temp directory:
  200 interleaved writes from two instances on different items → all present.

### Task 6.2: ClaudeApprovalReader — COMPLETE

- Plan reference: implementation-plan.md:101-110, :283-284
- Quality requirements:
  - It reads `~/.claude.json` `projects[<physicalRoot>]` with the existing key-folding rule.
  - It reads `.claude/settings.local.json` only when git reports the file ignored AND untracked.
  - git runs with argument arrays and a 2 s timeout, and an expected non-zero exit is distinguished from a git
    failure.
  - It never throws, and returns `{status, approvals}`.
- Spec: the tracked, non-git and git-timeout cases.

## Batch 7: Capability resolver, single inventory and DI (PR 1) — IN_PROGRESS

- PR: 1
- Goal: C4 resolver and inventory, plus registration of the store, reader and resolver under the `SDK_TOKENS`.
- Nx projects: `@ptah-extension/cli-agent-runtime`
- Depends on: B4 (done, `5f6a750e8`), B5 (must be COMMITTED first), B6 (done, `d003642a9`)
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- **Reviewer acceptance items (mandatory):**
  - (from the B6 review) `CapabilityToggleStore.recordWorkspaceRoot` (`capability-toggle-store.ts:301-315`) has no
    try/catch around its diagnostics-only `root.json` write. The resolver must call it best-effort (catch, log
    through `IOutputChannel`, continue), so a failed diagnostics write never fails `resolve`, `set` or a session.
    A spec proves that a rejecting `recordWorkspaceRoot` still yields a verified set.
  - (P9) The resolver's skill and plugin inputs come ONLY from `await getEffectivePluginConfig(physicalRoot)`.
    There are no calls to the workspace-only `resolveCurrentPluginPaths`, `getDisabledSkillIds` or
    `getWorkspacePluginConfig`. `deniedSkillNames` includes global-OFF skills and the children of global-OFF
    plugins. `CapabilityPolicyUnknownError` → `unverified`.
  - (P9 G7) Skill and plugin workspace writes use `saveWorkspacePluginConfig(…, physicalRoot)` with a
    workspace-only payload built from the stored workspace config, never from the layered `config`, so global
    items are never copied into the workspace.
  - (R7/N2) `set` awaits `ensureImported` first, and the "first `set()` in a fresh workspace" spec exists.
  - (Declared deviation, approved by the orchestrator on 2026-09-26)
    - What it does: for skill and plugin writes, `set()` reads `getWorkspacePluginConfig(physicalRoot)` as the
      WRITE-payload base. That read comes immediately after a strict `await getEffectivePluginConfig(physicalRoot)`,
      with no `await` in between.
    - Why: it is how the G7 rule "build the payload from the stored workspace config, never the layered one" is
      met.
    - The reviewer confirms three things:
      - (a) there is no `await` between the two reads;
      - (b) resolution inputs (effective state, denied sets, the fingerprint) still come ONLY from
        `getEffectivePluginConfig`;
      - (c) the strict effective read fails closed (`CapabilityPolicyUnknownError` → the write is rejected)
        before the workspace read is used.
- ACs proved:
  - AC-1.2 (A vs B), AC-1.3 (on-again writes the `inherit` tombstone; the entry shows inheriting);
  - AC-2.1 (scope and paths), AC-2.3 (user files unchanged), AC-3.1 (backend: skill and plugin workspace
    writes);
  - AC-4.1 (three `settings.local.json` fixtures with `imported.json` present);
  - N2 (first `set()` in a fresh workspace), N6, N7.
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime --parallel=2`
- Commit: `feat(cli-agent-runtime): batch 7 - add capability resolver and inventory`
- Files (6 code):
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/di/register.ts`
  - M `libs/backend/cli-agent-runtime/src/index.ts`

### Task 7.1: CapabilityResolverService — IN_PROGRESS

- Plan reference: implementation-plan.md:80-110, :286-309
- Quality requirements:
  - `resolve(cwd)`: physical root via `realpathSync.native(resolveHarnessWorkspaceRoot(cwd))`. The
    `policyKey` is lower-cased on win32 only. Then single-flight `ensureImported`, then store + inventory +
    `getEffectivePluginConfig` + back-off.
  - It produces denied, approved (explicit or imported ON only) and `deniedSkillNames` (including the
    children of disabled plugins, bare and `plugin:skill`), plus `harnessFingerprint` and `status`.
  - `list(root)` shares the same inputs.
  - `set` awaits `ensureImported` first.
  - Skill and plugin workspace writes go through `saveWorkspacePluginConfig(…, physicalRoot)`.
  - An unknown id is rejected.
- Validation notes: R7 and R8. An `.mcp.json` error or an unreadable Codex config → `unverified`. A source error
  publishes nothing, and a retry imports. A server added later is OFF. Two concurrent `resolve` calls → one
  import. It logs through `IOutputChannel`.

### Task 7.2: McpInstallService.listDeclarations — IN_PROGRESS

- Quality requirements: `listDeclarations(root) → {declarations, sourceStatus}` uses facet `inspect` (B4) and
  feeds both `listInstalled` (which dedupes including scope) and the resolver. Claude user rows use the existing
  `entry.scope`. The #16 reader switch is PR 2 (Batch 19).

### Task 7.3: DI — IN_PROGRESS

- Quality requirements:
  - Register the store as `SDK_CAPABILITY_GLOBAL_LAYER` and the resolver as `SDK_CAPABILITY_RESOLVER`.
  - Export `CapabilityResolverService` and `CapabilityToggleStore` from `src/index.ts`.
  - Record the write-path trace notes for Mode 3.

## Batch 8: Claude SDK enforcement (PR 1) — IN_PROGRESS

- PR: 1
- Goal: C5 builder, runner (one-shots), model probe and executor. Verified policy → flags. Unverified → strict MCP
  + `skills: []` + notice.
- Nx projects: `@ptah-extension/agent-sdk`
- Depends on: B5 (must be COMMITTED first; the resolver is mocked through `ICapabilityResolver`, and B7 is not
  needed at compile time)
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- Unplanned files (recorded 2026-09-26; counted in the running count):
  - `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
  - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.output-style.spec.ts`
- Follow-up for a later batch:
  - After B2 lands, the NEXT batch that touches `sdk-query-options-builder.ts` must remove the local
    `'capability-policy-unverified' as SessionMcpNotice['code']` cast. B2 adds the literal to
    `SessionMcpNoticeCode`, so the cast becomes redundant.
  - **Owning batch: B8's revise round** (orchestrator decision, 2026-09-26; B2 is now on the branch). The B8
    reviewer checks that the cast is gone and that the literal typechecks directly.
  - (Superseded text follows.) Owning batch: TBD. The B8 reviewer names it, and the team-leader then copies this
    item into that batch's
    acceptance items.
- **Reviewer acceptance items (P9):**
  - The builder, runner, model probe and executor take skill and plugin policy ONLY from
    `EffectiveCapabilitySet` (`deniedSkillNames`, `disabledPluginIds`, `harnessFingerprint`). None of them calls the
    loader's workspace-only sync methods.
  - `HarnessPolicySync.apply` gets the set's `harnessFingerprint`.
  - Spec: a global-OFF skill (it arrives in `deniedSkillNames` from a mocked resolver) is denied through
    `skillOverrides`.
- ACs proved: AC-3.4, AC-4.2, AC-4.3 (built options, direct and proxied), AC-4.6 (ptah OFF honoured; ptah present
  by default), AC-4.7 (back-off wins), AC-4.9, and unit coverage for A1 and A2
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/agent-sdk --parallel=2`
- Commit: `feat(agent-sdk): batch 8 - enforce capability policy in claude sessions`
- Files (8 code):
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
  - C `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.capabilities.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.harness-preflight.spec.ts`

### Task 8.1: Builder flags and fail-closed mode — IN_PROGRESS

- Plan reference: implementation-plan.md:329-346; existing deny plumbing is at `sdk-query-options-builder.ts:373-410`
- Quality requirements:
  - Verified: `deniedMcpServers` / `disabledMcpjsonServers` (flag tier), explicit-only `enabledMcpjsonServers`,
    `skillOverrides`. ptah is filtered only when explicitly OFF, and denied overrides are removed.
  - Unverified: `strictMcpConfig: true` with ptah only (omitted only if a readable store says OFF), `skills: []`,
    and the `capability-policy-unverified` notice.
- Spec: a repository server OFF is denied under a user `enableAll`; explicit ON is approved; proxied parity; ptah
  default and OFF; back-off; parent-off children; unverified.

### Task 8.2: Executor, runner and model probe — IN_PROGRESS

- Quality requirements:
  - `SessionQueryExecutor` runs `HarnessPolicySync.apply` before the build. Unacknowledged is logged and not
    fatal. Unverified → no preflight.
  - One-shots use the same flags, or strict mode when unverified.
  - The model probe uses `strictMcpConfig: true`, `mcpServers: {}` and `skills: []`.

## Batch 9: Ptah CLI enforcement and chat notice (PR 1) — PENDING

- PR: 1
- Goal: C5 Ptah CLI ordering (resolve policy → `HarnessPolicySync.apply` → `assembleSpawnOptions`), and the chat
  chip rendering the unverified notice.
- Nx projects: `@ptah-extension/cli-agent-runtime`, `@ptah-extension/chat`
- Depends on: B2, B7, B8
- Recommended executor: backend-developer (the chip is a single template/notice change) | Fallback:
  frontend-developer for the chip | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer (chat UI)
- ACs proved: AC-4.5 (Ptah CLI lane), AC-4.6 (unverified chip notice), AC-3.3
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime,@ptah-extension/chat --parallel=2`
- Commit: `feat(cli-agent-runtime,chat): batch 9 - enforce policy for ptah cli agents`
- Files (4 code):
  - M `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-capabilities.spec.ts`
  - M `libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.ts`

### Task 9.1: Registry ordering and spawn flags — PENDING

- Plan reference: implementation-plan.md:336-337, :346; reorders `ptah-cli-registry.ts:657-659`
- Quality requirements: the assembly carries the flags, or strict mode when unverified.
- Spec: ordering (the policy is resolved before preflight), flags present, strict when unverified.
- Pattern: `ptah-cli-registry-harness-preflight.spec.ts`.

### Task 9.2: Chat chip notice — PENDING

- Quality requirements: render the plan text "Only Ptah tools are loaded and skills are off: Ptah couldn't read
  <path> (<reason>). Fix the file and start a new session." Use OnPush and signals, as the component already does.

## Batch 10: Capabilities RPC handlers (PR 1) — PENDING

- PR: 1
- Goal: C8 `CapabilityRpcHandlers` with a zod schema, the handler index and exports, and the host-profile
  manifest entry.
- Nx projects: `@ptah-extension/rpc-handlers`
- Depends on: B2, B7
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: AC-1.4 (store error → RPC error), AC-3.1, AC-5.2 (no `schemaTokens` without `SDK_MCP_SCHEMA_SIZE`
  → "size unknown")
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/rpc-handlers --parallel=2` (includes `host-profile/resolve-handler-plan.spec.ts`, P4)
- Commit: `feat(rpc-handlers): batch 10 - add capabilities rpc handlers`
- **Reviewer acceptance items:**
  - `rpc-allowlist.spec.ts:41-43` ("claims every registry method exactly once") PASSES, because the manifest entry
    owns `capabilities:getState`, `capabilities:getEffective` and `capabilities:setEnabled` (the transient failure
    B2 introduced).
  - The zod request schemas live INSIDE `capability-rpc.handlers.ts` (budget fallback, applied 2026-09-26). No
    separate `capability-rpc.schema.ts` is created. The schemas are module-level constants at the top of the file,
    named as `agent-rpc.schema.ts` would name them, so a later extraction is mechanical.
- Files (5 code; the schema file was dropped by the budget fallback):
  - C `libs/backend/rpc-handlers/src/lib/handlers/capability-rpc.handlers.ts` (handlers plus their zod schemas)
  - C `libs/backend/rpc-handlers/src/lib/handlers/capability-rpc.handlers.spec.ts`
  - M `libs/backend/rpc-handlers/src/lib/handlers/index.ts`
  - M `libs/backend/rpc-handlers/src/index.ts`
  - M `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` (pattern: the `HarnessRpcHandlers.METHODS` entry at `manifest.ts:197`)

### Task 10.1: Handlers — PENDING

- Plan reference: implementation-plan.md:360-366
- Quality requirements:
  - `getState`, `getEffective` and `setEnabled`; the root comes from `canonicalPolicyRoot`.
  - zod runs at entry, and ids are validated against the inventory.
  - `schemaTokens` is attached only when the optional `SDK_MCP_SCHEMA_SIZE` is registered.
  - A write failure → RPC error naming the item.

## Batch 11: Install writes explicit ON, CLI host wiring (PR 1) — PENDING

- PR: 1
- Goal: `McpDirectoryRpcHandlers` install calls `setExplicit` (N6), with a `capabilityWarning` on failure, and the
  cli-engine container registers the capability handlers and services.
- Nx projects: `@ptah-extension/rpc-handlers`, `@ptah-extension/cli-engine`
- Depends on: B10
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: N6 (a workspace install with a same-name Codex-global entry ends up approved), AC-3.1 (CLI host has
  the RPC)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/rpc-handlers,@ptah-extension/cli-engine --parallel=2`
- Commit: `feat(rpc-handlers,cli-engine): batch 11 - write explicit on at install`
- **Reviewer acceptance items:**
  - `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:60` PASSES (it currently fails at 391 vs 388). The
    three `capabilities:*` methods are either registered on the CLI surface through the `container.ts`
    registration, or explicitly excluded with a stated reason.
  - Registering is preferred, because AC-3.1 wants the CLI host to have the RPC and it needs no new file.
  - If an exclusion or surface-list file outside `container.ts` must change, it is an unplanned file: the executor
    reports it, and the team-leader re-counts the budget before commit.
  - The check already includes `@ptah-extension/cli-engine`.
- Files (3 code):
  - M `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts`
  - M `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts`
  - M `libs/backend/cli-engine/src/lib/container.ts`

## Batch 12: Electron and VS Code host registration (PR 1) — PENDING

- PR: 1
- Goal: register `CapabilityRpcHandlers` in both desktop hosts (NFR: both hosts surface the controls).
- Nx projects: `ptah-electron`, `ptah-extension-vscode`
- Depends on: B10
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: NFR compatibility (VS Code + Electron), and AC-1.1 across app restart (a host-wired handler)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p ptah-electron,ptah-extension-vscode --parallel=2`
- Commit: `feat(electron,vscode): batch 12 - register capabilities rpc handlers`
- Files (2 code):
  - M `apps/ptah-electron/src/di/phase-4-handlers.ts` (pattern: `:43,105,160`)
  - M `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts` (pattern: `:48,82`)

## Batch 13: Marketplace capability store, toggle control and shell banner (PR 1) — PENDING

- PR: 1
- Goal: C10 foundation. The store does an optimistic update and reverts on error. `CapabilityToggleComponent`
  carries the badges, the accessible name and the scope-of-write text. The shell shows the policy banner.
- Nx projects: `@ptah-extension/marketplace`
- Depends on: B2. Entry step: the visual-reviewer captures the BEFORE screenshots (dark + light) at `c4bdc87dd`
  before this batch is committed.
- Recommended executor: frontend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer
- ACs proved: AC-1.4 (revert + error naming the server), AC-1.5 (accessible name with name + state; keyboard
  operable), AC-2.2 ("This workspace only"), AC-2.4 (override indicator), AC-4.6 (ptah OFF warning), AC-4.8
  ("not enforced" from `CAPABILITY_ENFORCEMENT`), AC-4.9 ("applies to the next session")
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace --parallel=2`
- Commit: `feat(marketplace): batch 13 - add capability toggle store and control`
- Files (5 code; R4 allows +1 `marketplace-shell.component.html`):
  - C `libs/frontend/marketplace/src/lib/data/capability-toggles.store.ts` (pattern: `data/connector-links.store.ts`)
  - C `libs/frontend/marketplace/src/lib/data/capability-toggles.store.spec.ts`
  - C `libs/frontend/marketplace/src/lib/ui/capability-toggle.component.ts`
  - C `libs/frontend/marketplace/src/lib/ui/capability-toggle.component.spec.ts`
  - M `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts`

### Task 13.1: Store — PENDING

- Quality requirements: signals only. `setEnabled` is optimistic → reconcile with the returned entry, or revert
  and surface the error on failure. Unverified status → banner state with the paths (each bad item file named).

### Task 13.2: Toggle control — PENDING

- Quality requirements:
  - OnPush.
  - Badges: new workspace server, imported, parent-off, unknown, inheriting/override.
  - The ptah-OFF warning copy is AC-4.6: agent lanes, memory and browser become unavailable.
  - The accessible name includes the item name and the state.

### Task 13.3: Enforcement labels and shell banner — PENDING

- Validation notes: A-UI and R6. Labels are derived from `CAPABILITY_ENFORCEMENT` and never hard-coded, so the
  PR 2 flip needs no UI edit.

## Batch 14: Server pages - toggles, scope, declarations and size (PR 1) — PENDING

- PR: 1
- Goal: wire the toggle into the Installed servers rows and the server detail. The UI shows the scope label and
  source paths as a declaration LIST (#16-ready), the scope-of-write text, and "size unknown" (which is always the
  case in PR 1).
- Nx projects: `@ptah-extension/marketplace`
- Depends on: B13
- Recommended executor: frontend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer
- ACs proved: AC-1.1 (UI), AC-1.3 (inheriting shown), AC-1.5, AC-2.1, AC-2.2, AC-2.4, AC-4.6, AC-4.8, AC-5.2
  ("size unknown", and a failed server doesn't block the page)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace --parallel=2`
- Commit: `feat(marketplace): batch 14 - add server toggles, scope and size labels`
- Files (9 code):
  - M `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.component.html`
  - M `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.component.spec.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.testing.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/server-detail.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/server-detail.component.html` (paths block at `:335-363`)
  - M `libs/frontend/marketplace/src/lib/pages/servers/server-detail.component.spec.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.spec.ts`
- Validation notes:
  - A-UI: render N declarations generically. In PR 1 there is one `~/.claude.json` declaration per name.
  - The figure renders only when `schemaTokens` is present, labelled with the estimate method.
  - The ptah CLI proxy row shows "not enforced".

## Batch 16: Webview e2e for Marketplace capability controls (PR 1) — PENDING

- PR: 1
- Goal: C11 scenarios in the existing harness marketplace e2e location
  (`libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/`, next to `marketplace-servers.e2e.spec.ts`).
  The skill and plugin scenario moved to PR 2 with B15 (P9 budget).
- Nx projects: `@ptah-extension/webview-e2e-harness`
- Depends on: B13, B14
- Recommended executor: senior-tester | Fallback: frontend-developer | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer
- ACs proved:
  - AC-1.1 (toggle write + reload), AC-1.4 (revert on failure), AC-2.2 (scope text);
  - AC-4.6 (ptah OFF warning), AC-4.8 (rival lanes and CLI proxy "not enforced"), AC-5.2 ("size unknown");
  - the new repository server badge, where ON sends `{scope: 'workspace', enabled: true}`, the imported badge
    and the unverified banner;
  - NFR (an e2e spec for each new PR 1 control).
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/webview-e2e-harness --parallel=2`
  plus `NX_DAEMON=false npx nx run @ptah-extension/webview-e2e-harness:e2e -- capability-toggles` (this project
  has no `test` target).
- Commit: `test(e2e,webview-e2e-harness): batch 16 - cover capability toggles`
- Files (1 code; `marketplace.fixtures.ts` was dropped by the budget fallback applied 2026-09-26):
  - C `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/capability-toggles.e2e.spec.ts` (P3)
- Validation notes: R6. The "not enforced" assertions derive from fixture or constant data. The spec uses
  `installRpcAutoResponder` to fail `capabilities:setEnabled` for the revert case.
- **Reviewer acceptance item (budget fallback):**
  - The capability fixtures (the RPC responses for `capabilities:*`, and the entries for a repository server, an
    imported entry and an unverified policy) live INSIDE `capability-toggles.e2e.spec.ts`.
  - The spec reuses `baseMarketplaceFixtures`, `installHost`, `installRpcAutoResponder` and the other helpers by
    importing them from `./marketplace.fixtures`.
  - `marketplace.fixtures.ts` is NOT modified.

## Batch 25: In-session skill list and spawned-agent plugins use the layered policy (PR 1) — PENDING

- PR: 1 (added at the P9 amendment; the id is out of sequence so earlier ids stay stable)
- Goal: P9 G3 and G4. The code-execution `ptah.harness.searchSkills` and the plugin paths given to spawned agents
  follow `workspace ?? global ?? default`, and fail closed when the policy is unknown.
- Nx projects: `@ptah-extension/vscode-lm-tools`
- Depends on: B1 (the `isCapabilityPolicyUnknownError` guard). B5 at runtime: the structural
  `getEffectivePluginConfig`.
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- **Reviewer acceptance items (mandatory, P9 G3/G4):**
  - `searchSkills` awaits `getEffectivePluginConfig(root)` once and uses its `overlayPluginPaths` and
    `config.disabledSkillIds`; there is no sync `resolveCurrentPluginPaths()` or `getDisabledSkillIds()` left on
    this path.
  - Spec: a global OFF skill → not offered as invocable; a global OFF opt-out plugin → none of its skills are
    listed; unknown policy → no local plugin skills and a logged reason; the remote results are unchanged.
  - `getPluginPaths` uses the effective `config.enabledPluginIds`: a global ON opt-in plugin's path reaches the
    spawned agent, and unknown → `undefined`.
  - `protocol-dispatcher.ts` is untouched (TASK_2026_559).
- ACs proved: AC-3.4 (a disabled skill is excluded from the session's skill surface), D1 for skills and plugins
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/vscode-lm-tools --parallel=2`
- Commit: `feat(vscode-lm-tools): batch 25 - use layered policy for in-session skills`
- Files (3 code):
  - M `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts` (`:273-284` interface, `:420-440` `searchSkills`)
  - M `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts`
  - M `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (`PluginLoaderLike` `:242-255`; `getPluginPaths` `:668-683`)

## Batch 17: PR 1 live verification and AC report (PR 1) — PENDING

- PR: 1
- Goal:
  - close A1 and A2 live;
  - capture the AC-4.3 proxied first request;
  - produce the AC report, the after screenshots (dark + light, recorded in a "Visual evidence" section of
    `test-report.md`) and the write-path trace (including G7: no workspace save persists a layered config);
  - re-test P9 live: a GLOBAL OFF skill with no workspace entry is absent from the workspace `.claude/skills`
    copies and from `ptah.harness.searchSkills`, and a global OFF opt-out plugin's skills are absent from both.
- Nx projects (full PR 1 regression): all PR 1 projects
- Depends on: B1-B14, B16, B25
- Recommended executor: senior-tester (+ visual-reviewer for the after screenshots) | Mode: sequential
- Reviewers: code-logic-reviewer (on the report's evidence)
- ACs proved: AC-4.3 live, A1, A2, R11, and the PR 1 AC map (implementation-plan.md:456-480). The AC-3.1 UI
  moved to PR 2 (B15); PR 1 proves AC-3.1 on the backend (B7, B10).
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/cli-agent-runtime,@ptah-extension/agent-sdk,@ptah-extension/chat,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/vscode-lm-tools,ptah-electron,ptah-extension-vscode,@ptah-extension/marketplace,@ptah-extension/webview-e2e-harness --parallel=2`,
  then `git diff --stat origin/main | tail -1` (must be under 100), then a `git diff --name-only origin/main`
  that contains no `protocol-dispatcher.ts` and no `*.generated.*`.
- Before this commit, if lever L1 (merge the plan-review history files, see the running count) has not been
  applied yet, the team-leader applies it in the Mode 3 completion step. The saving is confirmed with
  `git diff --stat c4bdc87dd | tail -1`.
- Commit: `docs(task-specs): batch 17 - record pr 1 acceptance and live checks`
- Files: `.ptah/specs/TASK_2026_560_2ae5/test-report.md` (C). This is a doc, already counted.
- PR 1 description must state:
  - the P8 e2e path deviation;
  - the #16 single-scope disclosure;
  - that the skill and plugin Marketplace toggles (AC-3.1 UI) arrive in PR 2. Meanwhile, workspace skill and
    plugin toggles remain in the existing Plugins panel, and global skill and plugin items are only settable via
    `capabilities:setEnabled`.

---

## Batch 18: Codex quoted MCP keys (#12) (PR 2) — PENDING

- PR: 2
- Goal: C4b, quoted-header parsing in the Codex facet (corrects `codex-toml-mcp-facet.ts:423-428`).
- Nx projects: `@ptah-extension/harness-sync`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-4.4 prerequisite; unit half of A3
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-sync --parallel=2`
- Commit: `fix(harness-sync): batch 18 - parse quoted codex mcp server keys`
- Files (2): M `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts`, M `.../codex-toml-mcp-facet.spec.ts`

## Batch 19: Claude user MCP declarations in both scopes (#16) (PR 2) — PENDING

- PR: 2
- Goal: C4c. `readClaudeUserMcpDeclarations` yields non-collapsing declarations, and `mcp-install` switches to it.
- Nx projects: `@ptah-extension/cli-agent-runtime`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-2.1 (a name in both `~/.claude.json` maps shows both scopes and paths), AC-2.5
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime --parallel=2`
- Commit: `feat(cli-agent-runtime): batch 19 - keep both claude user mcp scopes`
- Files (3):
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts`

## Batch 20: MCP schema-size measurement (PR 2) — PENDING

- PR: 2
- Goal: C7 `McpSchemaSizeService` (N5). It runs `mcpServerStatus()` and `getContextUsage({detail: 'summary'})`
  under one 3 s bound, keeps figures only for servers `connected` now, re-checks the token, and memos by
  `(token, server, configHash)`.
- Nx projects: `@ptah-extension/agent-sdk`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-5.1, AC-5.2, AC-5.3 (fixture within 10%), AC-5.4 (the total equals the sum of enabled servers),
  and the unit halves of A4 and A5
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/agent-sdk --parallel=2`
- Commit: `feat(agent-sdk): batch 20 - measure mcp schema size per session`
- Files (4):
  - C `libs/backend/agent-sdk/src/lib/helpers/mcp-schema-size.service.ts`
  - C `libs/backend/agent-sdk/src/lib/helpers/mcp-schema-size.service.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/di/register.ts`
  - M `libs/backend/agent-sdk/src/index.ts`
- Validation notes:
  - Tests: connected→failed in one session → unknown; pending→connected → figure; ended → unknown; timeout; no
    cross-session reuse.
  - Never spawn a disabled server to measure it.
  - Logs through `IOutputChannel`.

## Batch 21: CLI proxy collector policy filter (#14, #9) (PR 2) — PENDING

- PR: 2
- Goal: C9. The policy is checked before every cache hit, and cached inventory is filtered. Parent-OFF skills are
  filtered, and a known ptah OFF is preserved when unverified (ptah tools only otherwise).
- Nx projects: `ptah-cli`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-4.3 (CLI proxy path), AC-4.9 (no stale cache across toggles, TTL test), fail-closed for the proxy
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p ptah-cli --parallel=2`
- Commit: `feat(cli): batch 21 - filter proxy mcp tools by capability policy`
- Files (2): M `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts` (bypass at `:89-91`, cache at `:152-154`), M `.../workspace-mcp-collector.spec.ts`

## Batch 22: Codex and OpenCode lane enforcement (PR 2) — PENDING

- PR: 2
- Goal: C6 part A. The spawn path resolves the policy and runs `HarnessPolicySync.apply`; unverified → the lane is
  refused (`CapabilityPolicyUnavailableError`). The Codex lane gets `enabled=false` for denied servers with
  pre-quoted `tomlKeySegment` keys, and OpenCode's inline `mcp` gets only the enabled servers. An unacknowledged
  pass → a warning with `partial` skill/plugin labels.
- Nx projects: `@ptah-extension/cli-agent-runtime`
- Depends on: B18, B19 (same project, sequential)
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-4.4, AC-4.5 (OpenCode), AC-4.8 (warning naming the provider and the item); the serialised-argv
  half of A3
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime --parallel=2`
- Commit: `feat(cli-agent-runtime): batch 22 - enforce policy in codex and opencode lanes`
- Files (6; A-PR2, re-verify at kickoff):
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts` (`:592-643`)
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` (`:534,605-607`)
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts`

## Batch 23: Antigravity lane enforcement and enforcement-table flip (PR 2) — PENDING

- PR: 2
- Goal: C6 part B.
  - Antigravity uses ownership-gated cleanup: cleanup runs only after a successful setup ownership
    (`antigravity-cli.adapter.ts:573-579,628-634,826-829`).
  - Refused when unverified.
  - The `CAPABILITY_ENFORCEMENT` codex, opencode, antigravity and `ptah-cli-proxy` rows flip to enforced.
- Nx projects: `@ptah-extension/cli-agent-runtime`, `@ptah-extension/shared`
- Depends on: B20, B21, B22 (the rows flip only after every lane and the proxy enforce)
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-4.5 (Antigravity), AC-4.8 (the "not enforced" labels disappear through data only, A-UI)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime,@ptah-extension/shared --parallel=2`
  plus the marketplace test and the harness e2e, both unchanged and still passing (this proves A-UI).
- Commit: `feat(cli-agent-runtime,shared): batch 23 - enforce antigravity lane policy`
- Files (4):
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.mcp.spec.ts`
  - M `libs/shared/src/lib/types/capability-toggle.types.ts`
  - M `libs/shared/src/lib/types/capability-toggle.types.spec.ts`

## Batch 24: PR 2 live verification (PR 2) — PENDING

- PR: 2
- Goal: close A3, A4 and A5 live; run the lane tests for AC-4.4 and AC-4.5; confirm the schema figures in the UI
  (AC-5.1 and AC-5.4); write the after screenshots for the size figure.
- Depends on: B18-B23
- Recommended executor: senior-tester | Mode: sequential | Reviewers: code-logic-reviewer
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/cli-agent-runtime,@ptah-extension/agent-sdk,ptah-cli,@ptah-extension/marketplace --parallel=2`,
  plus the per-PR `git diff --stat` budget.
- Commit: `docs(task-specs): batch 24 - record pr 2 acceptance and live checks`
- Files: `test-report.md` (M), `batches.md` (M). These are docs only.
- Depends on (amended at P9): B15 and B26 as well. The B24 check adds `@ptah-extension/rpc-handlers` and
  `@ptah-extension/webview-e2e-harness`.

## Batch 15: Skill and plugin pages - toggles (PR 2; moved from PR 1 at the P9 amendment) — PENDING

- PR: 2. It was moved from PR 1 to keep PR 1 at 96 or below after P9 added 4 files. This is the lowest-risk
  deferral:
  - AC-3.1's backend lands in PR 1 (B7, B10);
  - workspace skill and plugin toggles already exist in the Plugins panel, so nothing regresses;
  - no enforcement moves.
  - The task completes only when PR 2 merges.
- Goal: the same toggle, scope label and scope-of-write text on the Installed skills page and the skill detail
  (skills and plugins, including parent-off), plus the skill and plugin e2e scenario.
- Nx projects: `@ptah-extension/marketplace`, `@ptah-extension/webview-e2e-harness`
- Depends on: PR 1 merged (B13's store and toggle, B16's spec file)
- Recommended executor: frontend-developer (pages), then senior-tester (the e2e scenario) | Fallback:
  general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer
- ACs proved: AC-3.1 (UI), AC-2.2, AC-1.5, AC-3.4 (UI side: a parent-off child is shown OFF), NFR e2e for the
  skill and plugin toggles
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace,@ptah-extension/webview-e2e-harness --parallel=2`
  plus `NX_DAEMON=false npx nx run @ptah-extension/webview-e2e-harness:e2e -- capability-toggles`
- Commit: `feat(marketplace,e2e): batch 15 - add skill and plugin toggles`
- Files (5 code):
  - M `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.spec.ts`
  - M `libs/frontend/marketplace/src/lib/pages/skills/skill-detail.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/skills/skill-detail.component.spec.ts`
  - M `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/capability-toggles.e2e.spec.ts` (skill and plugin scenario)

## Batch 26: Harness wizard and collision prediction use the layered policy (PR 2) — PENDING

- PR: 2 (P9 G5/G6; display only, so it never widens a session)
- Goal: the harness wizard's skill summary and the install-time collision prediction stop showing
  globally-disabled skills as available or active.
- Nx projects: `@ptah-extension/rpc-handlers`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- **Reviewer acceptance items:**
  - both sites await `getEffectivePluginConfig(root)` and use its overlay and disabled ids;
  - unknown → restrictive (no skill offered as available; collision owners computed from no overlay);
  - the G7 read-modify-write paths in `plugin-rpc.handlers.ts` stay workspace-only.
- ACs proved: consistency of AC-2.4/AC-3.1 across surfaces
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/rpc-handlers --parallel=2`
- Commit: `fix(rpc-handlers): batch 26 - use layered policy in harness wizard views`
- Files (about 3; the executor confirms the spec file names at kickoff):
  - M `libs/backend/rpc-handlers/src/lib/harness/workspace/harness-workspace-context.service.ts` (`:350,353`)
  - M `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts` (`:873-874`)
  - M or C a spec covering both (existing spec preferred)
