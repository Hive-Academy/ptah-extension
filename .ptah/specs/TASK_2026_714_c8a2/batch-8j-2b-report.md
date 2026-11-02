# Batch 8j-2b report

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8j-2b-report.md

## Fixes

1. `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:449`: Documented TASK_2026_714 8j / codex-cli 0.155.1 additive protocol stripping. Replaced extra-key-only failures with missing required `data` and incorrectly typed `model`. Made the reasoning-effort fixture explicitly wrong-type as well. Preserved recovery assertions and strengthened the sanitized error assertion to exact message matching via an Error expectation, retaining secret payload fixtures.
2. `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1081`: Idle malformed traffic now includes both `method` and `result`. This violates routing exclusivity and remains fatal, unlike an otherwise valid unknown notification.
3. `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts:675`: The invalid unknown-notification envelope now combines `method` and `result`; it no longer relies on an extra key being rejected. Existing pending-request rejection, no-dispatch, and closed-stream assertions remain.
4. `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts:708`: The malformed catalog response now contains forbidden response `params` carrying the secret fixture. The process-fatal error assertion now matches the exact sanitized message, and the stream-closed assertion remains.

## Decisions

- Production code remains unchanged. No production defect was identified in this scoped fixture review.
- Unknown additive keys alone are no longer used as evidence of malformed traffic. Routing conflicts remain process-fatal; missing or wrongly typed catalog fields remain request-local failures.
- Retained all four requested regression scenarios and their original test names. Did not add the optional extra-key success case.
- No verification commands or diagnostics were run, as instructed. The team leader must run the affected tests; passing results are not claimed.
