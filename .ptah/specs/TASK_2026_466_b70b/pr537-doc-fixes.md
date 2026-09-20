# PR #537 Documentation Fixes

This document records the verification and resolution of the six CodeRabbit review comments on pull request #537 across documentation files in `.ptah/specs/`.

## Findings

1. `.ptah/specs/TASK_2026_465_a25a/agy-stream-json-probe.md`
   - File changed: `.ptah/specs/TASK_2026_465_a25a/agy-stream-json-probe.md`
   - What changed: Removed the unrecorded turn-2 `input_tokens: 11841` claim and replaced it with the actual comparison recorded in the probe log, where turn-2 `total_tokens` (11,867) exceeds turn-1 `total_tokens` (11,767).
   - Status: fixed

2. `.ptah/specs/TASK_2026_465_a25a/phase-a-review.md`
   - File changed: `.ptah/specs/TASK_2026_465_a25a/phase-a-review.md`
   - What changed: Replaced all workstation-local `file:///D:/projects/ptah-extension/.claude-worktrees/two-way-messaging/` evidence links across the entire document with repository-relative links starting with `../../../libs/backend/cli-agent-runtime/...`.
   - Status: fixed

3. `.ptah/specs/TASK_2026_466_b70b/batch-1-review-round-2.md`
   - File changed: `.ptah/specs/TASK_2026_466_b70b/batch-1-review-round-2.md`
   - What changed: Repaired the malformed status table by aligning the separator row to exactly three columns and escaping the unescaped pipe operators in `isUserMessage(msg) \|\| isReplayMessage(msg)` to prevent markdown cell splitting.
   - Status: fixed

4. `.ptah/specs/TASK_2026_466_b70b/batch-3-render-fixes.md`
   - File changed: `.ptah/specs/TASK_2026_466_b70b/batch-3-render-fixes.md`
   - What changed: Removed the unused `Location` column from the table headers, separator lines, and table rows in both acceptance verification tables.
   - Status: fixed

5. `.ptah/specs/TASK_2026_466_b70b/batch-5-backend-render-causes.md`
   - File changed: `.ptah/specs/TASK_2026_466_b70b/batch-5-backend-render-causes.md`
   - What changed: Verified that `AgentProcessManager.continueConversation` now calls `this.outputBuffer.markTurnBoundary(agentId)` before `sdkHandle.continue(message)`. Rewrote the open risk bullet to describe only what remains unproven (full live end-to-end interaction coverage) rather than an unwired call site.
   - Status: fixed

6. `.ptah/specs/TASK_2026_466_b70b/orchestrator-fixes-review.md`
   - File changed: `.ptah/specs/TASK_2026_466_b70b/orchestrator-fixes-review.md`
   - What changed: Verified that `flattenPeerName` strips `\p{Pi}`, `\p{Pf}`, and Markdown structural characters with unit test coverage. Updated the Fix B and Overall verdicts from `accept with fixes` to `accept`, and marked the hardening recommendations for quote and delimiter stripping as resolved and historical.
   - Status: fixed
