# PR #669 fixes report

## A. Frontend shared-type compatibility

Root cause: PR #669 added the `running` turn-test outcome and the explicit `null` session-budget marker, while the frontend revisions on this branch still assumed the earlier contracts.

Fix: added the `running` presentation class; propagated `SessionBudgetState | null`; and made the chat-state patch preserve `null` as an explicit request to clear a budget rather than discarding it.

Files changed:

- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-tests-row.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\frontend\chat-state\src\lib\services\tab-manager.service.ts`

Checks: `npx nx typecheck @ptah-extension/chat-ui --parallel=1`, `@ptah-extension/chat`, and `@ptah-extension/chat-state` all passed. Chat emitted its existing NG8107 optional-chain warning. Nx Cloud also emitted its unrelated disabled-organization warning.

## B. SonarCloud reliability findings

Root cause: the public Sonar issue API returned three promise-truthiness bugs (`S6544`) in account/session guards plus the unsafe turn-test regular expression (`S8786`). It also returned an email-redaction regex (`S8786`) and six no-op `async` wrappers (`S7503`) in the probe script.

Fix: compared nullable promises/values explicitly, replaced the turn-test project failure parsing with line-based parsing, made probe adapters return `Promise.resolve`, and replaced the potentially backtracking email matcher with bounded token redaction.

Files changed:

- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\backend\auth-providers\src\lib\providers\codex\codex-account-usage.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\shared\src\lib\utils\turn-tests.utils.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\scripts\agent-usage\probe-plan-usage.ts`

Checks: the changed shared regression spec passed (22 tests). `npx nx typecheck @ptah-extension/auth-providers --parallel=1` passed.

## C1. Ollama Cloud usage endpoint

Root cause: the reader used the undocumented `/api/balance` shape. Current public evidence from the Ollama project identifies `GET /api/usage` and its `limits.session` / `limits.weekly` usage shape; current official documentation does not publish a balance-schema reference.

Fix: switched to `/api/usage`, validates documented session/weekly limits, maps both windows, accepts either documented reset spelling, and logs schema/request failure reasons without exposing the credential.

Files changed:

- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\backend\auth-providers\src\lib\quota\readers\ollama-cloud-plan-usage.reader.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\backend\auth-providers\src\lib\quota\readers\ollama-cloud-plan-usage.reader.spec.ts`

Checks: focused reader Jest spec passed (9 tests); auth-providers typecheck passed.

## C2. Late Codex owner lookup

Root cause: `fromSource` dropped any result finishing after the aggregate deadline, including an expensive Codex-home owner resolution.

Fix: shares the in-flight Codex lookup, retains a result only after an aggregate source timed out, and consumes that result on the next aggregate refresh while direct selected-provider lookup remains uncapped.

Files changed:

- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-limit-owner-discovery.service.ts`

Checks: focused discovery Jest spec passed (24 tests).

## C3. Interactive reasoning effort

Root cause: the saved provider profile omitted reasoning effort, so interactive sessions could not restore it.

Fix: added the field to the real shared `ProviderProfile` declaration/schema, returned it from the CLI registry, and overlays it as session effort when present.

Files changed:

- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\shared\src\lib\types\provider-profile.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\shared\src\lib\types\provider-profile.schemas.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`

## C4-C7. Turn-test outcomes

Root cause: the parser treated `0 failed` as failure, treated in-progress output as pass, dropped a command failure when project passes existed, and let partial output overwrite an active command.

Fix: parses nonzero failure counts, only parses explicit completed-success target lines, preserves command-level failures, and requires completion before accepting parsed success. Added one focused regression test for each case.

Files changed:

- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\shared\src\lib\utils\turn-tests.utils.ts`
- `D:\projects\ptah-extension\.claude-worktrees\fix-task-2026-ui-defects-a-backend-aac0d528f969\libs\shared\src\lib\utils\turn-tests.utils.spec.ts`

## Decisions

- The requested `ProviderProfile` is declared in `provider-profile.types.ts`, not `ptah-cli.types.ts`; the latter already carries CLI configuration reasoning effort.
- No API token was needed for the public SonarCloud issue search.
- Full project typechecks for shared, CLI runtime, and agent SDK were not completed before handoff; the focused tests and listed frontend/auth typechecks are the completed evidence.
