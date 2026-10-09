# Current PR CI and review status

Checked 2026-10-08 after fetching `origin`. PR #677 is the open review-notes PR (`fix/task-2026-ui-defects-review-notes`). CI counts below are each PR's single snapshot, except #669, which was re-checked once about a minute later because `electron-e2e` was pending; it remained pending.

| PR   | Base                                  | CI                          | Sonar               | CodeRabbit                                                   | Mergeable            |
| ---- | ------------------------------------- | --------------------------- | ------------------- | ------------------------------------------------------------ | -------------------- |
| #669 | `main`                                | 8 pass / 1 fail / 1 pending | Pass (quality gate) | Completed; 5 former threads resolved; 6 open threads (4 new) | MERGEABLE / BLOCKED  |
| #670 | `fix/task-2026-ui-defects-a-backend`  | 3 pass                      | —                   | Skipped (reviews disabled for base)                          | MERGEABLE / CLEAN    |
| #671 | `fix/task-2026-ui-defects-b-frontend` | 3 pass                      | —                   | Skipped (reviews disabled for base)                          | MERGEABLE / CLEAN    |
| #673 | `fix/task-2026-ui-defects-c-chat`     | 3 pass                      | —                   | Skipped (reviews disabled for base)                          | UNKNOWN / UNKNOWN    |
| #674 | `fix/task-2026-ui-defects-c-chat`     | 3 pass                      | —                   | Skipped (reviews disabled for base)                          | UNKNOWN / UNKNOWN    |
| #675 | `fix/task-2026-ui-defects-c-chat`     | 2 pass / 1 fail             | —                   | Skipped (reviews disabled for base)                          | MERGEABLE / UNSTABLE |
| #676 | `feat/streaming-p1-host-coordinator`  | 2 pass                      | —                   | Skipped (reviews disabled for base)                          | MERGEABLE / CLEAN    |
| #677 | `fix/task-2026-ui-defects-c-chat`     | 2 pass                      | —                   | Skipped (reviews disabled for base)                          | MERGEABLE / CLEAN    |

`electron-e2e` on #669 (run `37705652836`, job `113079267246`) was still pending at the sole permitted re-check. It has no failure log yet. The #675 failed check is SonarCloud's external check; it has no GitHub Actions run ID, so `gh run view --log-failed` is not applicable.

## Failures

### #669 — `main` / degradation-audit

Run `37705652957`, job `113079267709` failed in `degradation-audit:lint`, not in a product test. The audit reports `libs/frontend/marketplace: 28 ok (baseline 32)` and exits non-zero because its checked-in ratchet baseline is stale at [tools/degradation-audit/baseline.json:43](tools/degradation-audit/baseline.json#L43). Root cause: the baseline still declares 32 unsuppressed sites for that scope while the audit finds 28. The workflow's final error is the resulting `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exit 1.

### #675 — SonarCloud Code Analysis

The external SonarCloud check is failed. This audit was only asked to query the SonarCloud gate/issues API for #669, so no reliable file:line cause was collected for #675; inspect its SonarCloud PR dashboard for the gate condition.

### #669 SonarCloud

Quality gate API result is **OK**. No Sonar issue query was needed (it is required only for an `ERROR` gate).

## New CodeRabbit findings

Only #669 received new actionable inline comments after the prior report (all are from 2026-10-08 00:10 UTC). Checked against `origin/fix/task-2026-ui-defects-a-backend`.

1. [libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:757](libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L757) — resumed sessions do not carry `providerProfile.reasoningEffort` into `sessionConfig`, unlike new sessions. **Valid:** the nearby new-session config maps it to `effort`; the resume config maps only model and session name.
2. [libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1043](libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts#L1043) — `options?.budget ?? null` turns an omitted resume budget into an explicit clear, discarding saved budget state. **Valid:** forwarding `options?.budget` preserves `undefined`, while explicit `null` can still clear the budget.
3. [libs/shared/src/lib/utils/turn-tests.utils.ts:57](libs/shared/src/lib/utils/turn-tests.utils.ts#L57) — broad `Running targets[\\s\\S]*failed` can classify a passing log as failed when ordinary output later contains “failed”. **Valid:** the current unanchored regex has exactly that false-positive path.
4. [libs/shared/src/lib/utils/turn-tests.utils.ts:99](libs/shared/src/lib/utils/turn-tests.utils.ts#L99) — case-insensitive, unanchored `FAIL` matching can extract prose such as “expected ... to fail” as a test failure. **Valid:** the current `/gim` pattern permits it; uppercase, line-anchored Jest matching is appropriate.

Of the seven #669 findings in the previous report, CodeRabbit now marks five resolved: the Ollama reader, plan-owner discovery, and all four original turn-test parser threads. The earlier `ptah-cli.types.ts:31` profile-plumbing thread remains open, as do the four findings above.

## Suggested fix batches

1. **Audit-baseline batch** — [tools/degradation-audit/baseline.json:43](tools/degradation-audit/baseline.json#L43): reconcile the marketplace count with the intended ratchet policy. This is independent of application code.
2. **SDK profile batch** — `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` plus the previously open `libs/shared/src/lib/types/ptah-cli.types.ts`: carry profile reasoning effort through both new and resumed sessions.
3. **Resume-budget batch** — `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`: preserve omitted budgets on resume.
4. **Turn-test parser batch** — `libs/shared/src/lib/utils/turn-tests.utils.ts`: make both failure recognizers specific; keep these coupled because they parse the same output surface.

These batches are file-disjoint except that the SDK/profile batch intentionally groups the already-open profile plumbing with the new resume-path omission.
