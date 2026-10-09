# PR 669–671 CI and CodeRabbit status

Checked 2026-10-08. Stack: #669 → `main`, #670 → #669, #671 → #670. Counts reflect one `gh pr checks` snapshot per PR; no polling was performed. CodeRabbit findings below were checked against each PR head with `git show origin/<branch>:<path>`.

| PR   |                          CI | CodeRabbit state                                                                                     |
| ---- | --------------------------: | ---------------------------------------------------------------------------------------------------- |
| #669 | 6 pass / 2 fail / 1 pending | Completed; 7 actionable inline findings (0 nitpicks)                                                 |
| #670 | 3 pass / 0 fail / 0 pending | No CodeRabbit review or inline finding was published; check is successful, with no skip reason shown |
| #671 | 3 pass / 0 fail / 0 pending | Skipped: “reviews are disabled for this base branch”                                                 |

The pending #669 job is `main` (GitHub Actions run `37701476580`, job `113065867080`).

## Failing CI

### PR #669 — `electron-e2e`

Run `37701476551` fails while copying renderer assets because the dependent Angular webview build has three TypeScript errors:

- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.ts:28:6` — `Readonly<Record<TurnTestOutcome, string>>` is missing the required `running` key.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1043:6` — `SessionBudgetState | null | undefined` is passed where only `SessionBudgetState | undefined` is accepted.
- `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:159:60` — the same nullable `SessionBudgetState` type mismatch.

Root cause: compile-time type errors in the webview dependency build, not an Electron test assertion.

### PR #669 — `SonarCloud Code Analysis`

The external SonarCloud check is failed. Its check URL does not expose a GitHub Actions run ID, so `gh run view <run-id> --log-failed` is not applicable and no file/line root cause is available from GitHub CLI. Inspect the SonarCloud PR #669 dashboard for the gate condition.

## CodeRabbit findings

### PR #669

1. **Major** — `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts:17`: the reader relies on `/api/balance` and its `BalanceSchema`, an endpoint/contract CodeRabbit says is not established; any non-2xx or schema mismatch becomes `service-unavailable`. Suggested fix: use the established `/api/usage` endpoint and its confirmed response shape (or retain compatible usage parsing). **Assessment: valid** — the checked branch hard-codes `/api/balance` at line 10 and exclusively accepts the new balance payload.

2. **Major** — `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:295`: a slow Codex owner lookup can be discarded by aggregate source-deadline handling, omitting selected-provider and detected-lane usage. Suggested fix: retain/refresh a completed Codex lookup after the deadline while keeping the selected-provider RPC behavior scoped as intended. **Assessment: valid** — aggregate discovery wraps both `selectedProvider()` and `detectedLanes()` in `fromSource()` (lines 201–210), and each can call `resolveCodexHomeOwner()` (295, 342).

3. **Minor** — `libs/shared/src/lib/types/ptah-cli.types.ts:31`: interactive Ptah CLI chats do not carry saved `reasoningEffort` through the profile. Suggested fix: add it to `ProviderProfile`, return it from `getProfile()`, and apply it to the interactive query session configuration. **Assessment: valid** — configuration contains `reasoningEffort`, but the checked `getProfile()` return only contains provider ID, auth environment, model, base URL, and CLI path; `startChatSession()` only overlays the profile model.

4. **Minor** — `libs/shared/src/lib/utils/turn-tests.utils.ts:55`: `Tests: 0 failed, 5 passed` matches the failed regex and is reported failed. Suggested fix: parse the failure count and require it to be greater than zero. **Assessment: valid** — line 53 matches any numeric value before `failed`.

5. **Major** — `libs/shared/src/lib/utils/turn-tests.utils.ts:76`: `Running target app:test` is recorded as passed before the command has finished. Suggested fix: record passing projects only from an explicit success line, preserving an unknown/running state otherwise. **Assessment: valid** — the same regex accepts `Successfully ran target` and `Running target`, then unconditionally stores `passed`.

6. **Major** — `libs/shared/src/lib/utils/turn-tests.utils.ts:87`: when project parsing finds only successes, it can discard a command-level failed outcome. Suggested fix: preserve/add a failed command-level run unless parsed failed projects account for it. **Assessment: valid** — for non-empty `projects`, the return maps project outcomes only and never uses the `outcome` argument.

7. **Minor** — `libs/shared/src/lib/utils/turn-tests.utils.ts:117`: partial output can override an active command state to passed. Suggested fix: apply a parsed passing result only once the command is complete. **Assessment: valid** — `parsedOutcome` wins over `outcomeFor()` without checking completion/finalization.

### PR #670

No actionable CodeRabbit inline findings or CodeRabbit review summary were returned. No nitpicks.

### PR #671

No actionable findings: CodeRabbit explicitly skipped the PR because reviews are disabled for its base branch. No nitpicks.

## Suggested fix batches

1. **Ollama usage reader lane** — `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts` (finding 1).
2. **Plan-owner discovery lane** — `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts` (finding 2).
3. **Ptah CLI profile plumbing lane** — `libs/shared/src/lib/types/ptah-cli.types.ts`, `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`, and `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (finding 3).
4. **Turn-test parsing lane** — `libs/shared/src/lib/utils/turn-tests.utils.ts` (findings 4–7; keep together because the fixes overlap the same parser/control flow).

These lanes do not overlap files. The separate CI compile failures should be assigned independently from the CodeRabbit batches.
