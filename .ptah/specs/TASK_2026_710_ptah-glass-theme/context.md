# CI correction context

PR #805, existing branch feat/ptah-glass-theme. Changes stay in this worktree.

## Lane evidence

- Implementer: opencode, f379ce3f-7666-480d-be17-c156864d3341, CLI session ses_e9be4f5cdffevB75nAU1z8s0nc. Produced six-file patch and ci-fixes.md, reported completion but process did not exit. Orchestrator stopped it before review. One queued follow-up supplied remaining CI failures; report covers them. Patch requires independent verification, not accepted from report alone.
- Exhausted lane: opencode, family opencode. Discovery on 2026-10-22 reported AT LIMIT, Go Monthly 100%, reset 2026-11-04 11:44 UTC. Do not resume until fresh discovery confirms room. No forced spawns.
- Codex and Copilot disabled in discovery despite installed binaries. Do not use while disabled.
- Reviewer: grok, 87a0ac95-79d3-49c1-ba00-616d6e253b0e, completed independent review: NEEDS_REVISION, 5/10. Two serious findings: default gold hint rearms write on second boot; shrink-0 clips Git tab with workspace sidebar open. Popover and theme expectation edits passed source review; rendered evidence still absent.
- Revision 1 executor: grok, 8aba9088-a9dd-45c7-82a9-48e8d64f019b, confirmed room on discovery. Fallback because opencode is AT LIMIT and other enabled families have unverified capacity. Orchestrator (OpenAI model) will independently review Grok-authored corrections; original Grok reviewer will not approve its own family correction. No checks authorized in lane. Deliverable ci-revision-1.md. Maximum two revision rounds unchanged.

## Verification

Only CI-failure reproductions ran locally, serially with peer coordination:

- Jest core theme.service.spec.ts: PASS, 33 tests, --coverage=false --maxWorkers=2.
- Jest webview theme-boot-lists.spec.ts: PASS, 7 tests, --coverage=false --maxWorkers=2.
- Logs: ci-core-repro.log, ci-boot-repro.log (local evidence).
- Electron/webview E2E, visual evidence and pre-push gate not run for this patch.
- Revision 1 independently approved in code-logic-review-ci-r1.md by OpenAI orchestrator (different family from Grok author).
- Revised theme.service.spec.ts reproduced: PASS, 34 tests; log ci-core-revision-1.log. Together with unchanged boot-list reproduction, 41 tests pass.
- Heavy-check slot reacquired from peer PR #803 for this reproduction and pre-push. Release on push completion or blockage.

## Open verification concerns

- Popover ancestor lift must solve both stacking and backdrop-filter containing blocks/clipping.
- Git dock shrink-0 may move overflow to trailing tab at 1200px. Do not accept clipped controls.
- Accent absent-state fix must retain valid mirror/invalid-state behavior, including reloads.
- No test skips, forced clicks, or weakened geometry assertions.

Unrelated .gitignore modification remains untouched.
