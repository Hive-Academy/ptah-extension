# Task Context - TASK_2026_611_8fe7

## User Request

From the TASK_2026_609 session (2026-10-04), after PR #635 was merged: "push as a follow up PR with those follow up tasks". This task files the follow-ups of TASK_2026_609_c495 so that they are tracked; it does not implement them.

## Source

- Parent: `.ptah/specs/TASK_2026_609_c495/` (filed in the same PR as this task).
- Consolidated list: `completion-report.md` "Check 4 - Open follow-ups", plus `batches.md` (FU sections, CI round, CodeRabbit round).
- Already closed in PR #635, not repeated here: FU-4 (`6d9dcba5e`), FU-10 (`faa768e31`, CodeRabbit item 1), the `AgentModelsStore` part of FU-3 (`7dca3b7cc`).

## Follow-ups

| ID | Item | Severity | Where / evidence | Suggested fix |
| --- | --- | --- | --- | --- |
| FU-1 | The Claude target and the MCP fragments overwrite a hand-edited owned copy with no `.history` snapshot. | Moderate (data) | `claude-target.ts:381`, `mcp-facet-planner.ts:184` (harness-sync) | Apply the detach-then-exclusive-publish rule from B-FIX-1 (`artifact-retirement.ts` `detachForOverwrite`); widen the guard sentence and the `localEdit` doc. |
| FU-2 | `wizard-generation-rpc.handlers.ts` is 1112 lines (max-lines 700). | Maintainability | rpc-handlers | Move the preview helpers into `wizard-generation.preview.ts` (facade rule). |
| FU-3 | `skill-clones-view.component.ts` is 967 lines; no view-level wiring spec. | Maintainability + test gap | skill-synthesis-ui | Split the Agents-tab harness wiring out; add a spec: `getAgentModels` mock, model guard only on the desktop Agents tab, models reloaded on Refresh and tab entry. |
| FU-5 | Retirement can still delete a tree when the hash read fails transiently and the recorded hash already holds the `unreadable` sentinel (hash read and readability read are separate). | Blocking-class, narrow (data) | `artifact-retirement.ts` `isProvablyUnchanged`; `content-hash.ts:316`; code-logic-recheck.md | A retirement-only strict digest with `hashDir` semantics that throws on any read failure, compared with the recorded hash; drop the separate readability read. Regression: failure injected in the hash read only. |
| FU-6 | The model section makes agent cards ~2.5x taller and pushes actions below the fold; badges wrap in 2-column cards; cramped edit form; the editor's own `text-warning` messages (`agent-model-guard-failed`, `sync-failed`) are ~2.4:1 in light. | Moderate (UX / a11y) | visual-b7-report.md; bfix3-executor-report.md:141 | Collapse the model section by default or move actions above it; fix the two message contrasts (AA 4.5:1). |
| FU-7 | (a) A Windows path that differs only in letter case (other than the drive letter) hashes to a different `workspace.<hash>` key. (b) Model-read failures are silent in the source resolver and when the settings are not registered. | Moderate | `workspace-scope-resolver.ts:16-31` (`normalizeActivePath`); `plugin-config-source-resolver.ts:283`; partb-review-lanes.md | (a) Case-fold on win32 WITH a one-time rehash migration of existing `workspace.<hash>.*` keys (otherwise existing workspace settings are lost). (b) Optional warn callback on the resolver, log once per root. |
| FU-8 | `wizard:preview-generation` labels a foreign (not-owned) existing copy as "will overwrite", but reconcile refuses to overwrite it. | Moderate | `wizard-generation-rpc.handlers.ts:524,574,597`; partb-review-backend.md #4 | Carry foreign/blocked evidence into the preview and label the path as blocked with the reason. |
| FU-9 | The wizard confirm-preview can continue to `submitAgentSelection` after the component is destroyed. | Moderate | `agent-selection.component.ts:1024,1045`; partb-review-frontend.md #6 | Invalidate `previewRequest` on destroy and check `DestroyRef` before submit; deferred-preview regression. |
| FU-11 | The generated `code-logic-reviewer` role tells a lane to run no git and to write only `code-logic-review.md`. Per-commit reviews need `git show` and a named deliverable; one lane refused, one overwrote the original review. | Process | `.claude/agents/code-logic-reviewer.md` and its template in agent-generation | Allow read-only git and honour an explicit deliverable path from the task. |
| R-1 | No regression for an untouched copy when the history folder is not writable (B-FIX-1 fail-safe: update fails and retries). | Minor, test gap | partb-recheck.md:24 | Add the spec. |
| R-2 | No spec for the 15 s CLI model-list timeout (`lists = null` ⇒ `unverifiable`, save not blocked). | Minor, test gap | `skills-synthesis-rpc.handlers.ts:279,2459` | Fake-timer spec: rejection and late resolution. |
| R-3 | `skills-synthesis-rpc.handlers.ts` is 3137 lines. | Maintainability | rpc-handlers | Extract the agent-model methods (~380 lines) into a collaborator. |
| R-4 | The unlisted-model confirmation is inline, not a modal; the in-row Sync does not emit to the view. | Minor, by design | B-6 notes | Decide; no change required. |
| R-5 | Visual minors: mixed filled and plain chips; a disabled Cursor "Edit" pill in light looks like a filled button. | Minor | visual-b7-report.md | Style pass. |
| T-1 | harness-sync: 17 tests fail locally on Windows (agent-consent 2, skill-consent 7, gitignore E23 5, cancellation B8 2, write-failure E21 1) and `capability-policy` C3 fails on `main`; CI does not show them. | Test hygiene | TASK_2026_609 handoff | Separate investigation. |

## Suggested grouping

1. Data safety (harness-sync): FU-1, FU-5, R-1.
2. Settings identity (settings-core): FU-7, with a migration.
3. Wizard (rpc-handlers + setup-wizard): FU-8, FU-9, FU-2.
4. Agents tab (skill-synthesis-ui): FU-3, FU-6, R-5, R-2/R-3 (rpc-handlers).
5. Process: FU-11. Test hygiene: T-1.

## Conversation Summary

TASK_2026_609 shipped the per-workspace subagent setup fixes and the per-agent model control (PR #635). Its rule was at most one fix round per review; the user approved one extra round for Part A and a CodeRabbit round. Everything above was found and deliberately deferred.
