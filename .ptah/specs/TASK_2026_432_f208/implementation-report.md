# Implementation report — TASK_2026_432

## Outcome per item

| # | Outcome |
| - | ------- |
| 1 | `visual-reviewer` and `ui-ux-designer` no longer carry `STATIC:CLI_DELEGATION`. The template side is the rule, and it matches the catalog's `-`. `template-sharing.guard.spec.ts` now pins each role's exact STATIC set in `ROLE_PARTIALS` (15 rows), and `NON_DELEGATING_ROLES` (`team-leader`, `visual-reviewer`, `ui-ux-designer`, each with a `why`) asserts that neither the marker nor `ptah_agent_list` reaches the resolved file. |
| 2 | `renderTaskSpecAgentBlock(audience)` takes a required `'coordinator' \| 'specialist'`. The resolver picks the audience with `taskSpecAudienceFor(templateId)`: `project-manager` and `team-leader` get `coordinator`, and every other id (unknown ids too) gets `specialist`. The specialist block has no allocation, no `git`, no `mkdir`, no block-scalar rule and no `Edit` instruction. It keeps the canonical-id rule, a read-only carrier, the owners of state and the recognised document names. There is still ONE STATIC id (`TASK_SPEC_CONTRACT`), because of version skew: templates mirror from `main` into installs that run an older resolver, and a new id would fail every template on those installs. The reason is written in the lib `CLAUDE.md`. |
| 3 | `_shared/cli-delegation.md`: resume only when `ptah_agent_status` reports a `CLI Session ID`, otherwise respawn fresh with the context restated (same rule as `tribunal/references/vendor-panel.md:96`). The first line also depends on availability: with no `ptah_agent_*` tools in the session, do the work yourself. |
| 4 | `team-leader.template.md`: one `## Return value` envelope, one entry per variant, and one `### Batch executor prompt` shared by `DECOMPOSITION COMPLETE` and `BATCH [N] COMPLETE` (it was written out twice before). All eight literal headers are still there, pinned by the guard. The per-variant table from context.md became a bullet list on purpose: Prettier pads an aligned table to its widest cell, and the table version measured 22,266 raw bytes against 19,377 before the change. The status vocabulary table lost a "Who sets it" column whose rows all said `team-leader`. |
| 5 | Ownership lives in the renderer. The coordinator block says the team-leader alone sets task states in `batches.md`, and that specialists never edit `task.md` or `batches.md`. The specialist block says the carrier `status:` belongs to the orchestrator, project-manager and team-leader, and the `batches.md` states to the team-leader alone. The team-leader template already agreed (`:151-153`). |
| 6 | `_shared/tooling-precedence.md` now depends on availability. When `ptah_*` tools are listed, use them first. When they are not listed, go straight to native tools and do not probe for them. The fallback line is kept. |

Also: `content-manifest.json` was regenerated. Its `contentHash` is the download cache key, so without a new hash, installs would never pick up the new templates. Three changed templates got a `templateVersion` bump to `2.2.0`.

## Expanded size (bytes; resolver output with composition markers stripped)

| Template | Before | After | Delta |
| -------- | -----: | ----: | ----: |
| backend-developer | 14703 | 13914 | -789 |
| code-logic-reviewer | 14801 | 14012 | -789 |
| code-style-reviewer | 14216 | 13427 | -789 |
| devops-engineer | 12152 | 11363 | -789 |
| frontend-developer | 15485 | 14696 | -789 |
| modernization-detector | 9590 | 8801 | -789 |
| project-manager | 12974 | 13377 | +403 |
| researcher-expert | 9690 | 8901 | -789 |
| senior-tester | 14057 | 13268 | -789 |
| software-architect | 15266 | 14477 | -789 |
| team-leader | 22750 | 22214 | -536 |
| technical-content-writer | 13941 | 13152 | -789 |
| ui-ux-designer | 9832 | 7845 | -1987 |
| video-director | 9021 | 8232 | -789 |
| visual-reviewer | 16593 | 14606 | -1987 |
| **Total** | **205071** | **192285** | **-12786** |

`project-manager` grows because it keeps the coordinator block and gains the new ownership bullet and the conditional wording in both partials. `team-leader` saves less than the 4–5 KB estimate. The old return blocks were about 5 KB in total, and most of that is contract that must stay: facts, next actions and the executor prompt. The real duplication was the second executor prompt and the repeated scaffolding.

## Verification

- `npx nx run-many -t test -p @ptah-extension/agent-generation @ptah-extension/shared @ptah-extension/task-specs @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=1`. Header: "Running target test for 4 projects". Green: shared 1398, agent-generation 1027, task-specs 489 (+23 skipped), vscode-lm-tools 1053. `task-specs` and `vscode-lm-tools` are included because their guards scan the template tree.
  - The first run used default parallelism, and 5 tests in `user-layer/*` failed on timeouts (136 s suite). The same suites pass alone (106/106) and in the serial run. This is load flakiness and has nothing to do with this change.
- `npx nx run-many -t lint,typecheck -p <same 4>`: success, 0 errors. The warnings were already there.
- `node scripts/generate-content-manifest.js --check`: up to date.

## Catalog alignment needed (TASK_2026_431 owns `agent-catalog.md`)

- CLI Delegation column: keep `-` for `visual-reviewer` and `ui-ux-designer`. Change `team-leader` from **P** to `-` (recommends CLI lanes in `batches.md`, never spawns). Change the legend's `-` line to name all three.
- Invocation table: `backend-developer` / `frontend-developer` say "Update status to IMPLEMENTED when done". They must say "Report each task's completion with evidence; do not edit batches.md — the team-leader records state".
- Any resume wording there, and in `cli-agent-delegation.md`, must use the conditional rule: resume only on a reported `CLI Session ID`, else respawn with context restated.

## Open risks

- `content-manifest.json` will conflict with any other branch that regenerates it (TASK_2026_431 edits plugins). Resolve by rerunning `npm run manifest:generate` after the merge, not by hand.
- Coordinator membership is keyed on the template id. A renamed `project-manager` / `team-leader` template silently becomes a specialist. The `names the coordinators explicitly` guard catches this.
- The repo's own `.claude/agents/team-leader.md` (and the other deployed copies) are older rendered output and were not regenerated. This is out of scope.
