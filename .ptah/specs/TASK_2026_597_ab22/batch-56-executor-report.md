# Batch 56 executor report: N7 `chat:continue` gate and resume budget

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget`. Nothing is committed. Only the Batch 56
service file and one new colocated spec were touched. Batch 57 and Batch 61 files were not edited.

**Tasks completed**: 56.1 (send gate with the `/compact` and `/clear` allowlist), 56.2 (resume attaches the budget)

## Files

All paths are under `libs/backend/rpc-handlers/src/lib/chat/session/`.

| Task      | File                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 56.1/56.2 | `chat-session.service.ts` (MODIFIED)    | See the bullets below this table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 56.1/56.2 | `chat-session-budget.spec.ts` (CREATED) | 15 tests. Gate: a plain prompt is refused before any resume, routing or send; `/compact`, `/clear` and their whitespace-padded forms pass without `canSend`; `/orchestrate …`, `/compact keep the plan` and `/clearall` are blocked; an unknown figure passes (real `SessionBudgetService`); a host with no budget registration passes; the real stage machine allows the turn at 99% and refuses after the figure crosses 100%; Ptah CLI sessions are not gated. Resume: parity `budget.used === stats.tokenCount` (41M of 50M gives `handoff`, revision 12, not blocked, `stats` passed through by reference); `null` stats gives no `budget` key (`observeLoaded(null)`); no registration gives no `budget` key. |

The changes to `chat-session.service.ts`:

- **Injection:** a new last constructor parameter,
  `@inject(SDK_TOKENS.SDK_SESSION_BUDGET, { isOptional: true }) sessionBudget: ChatSessionBudget | null = null`. It
  copies the existing optional `AGENT_PROCESS_MANAGER` parameter. `ChatSessionBudget` is a local
  `Pick<SessionBudgetService, 'canSend' | 'observeLoaded'>`, imported as a type from the `@ptah-extension/agent-sdk`
  barrel, which Batch 55 exports.
- **56.1 gate:**
  - `refuseIfBudgetReached(sessionId, prompt)` is called right after the Ptah CLI branch returns, so Ptah CLI sessions
    stay ungated, as the plan accepts. It runs before the MCP registration and the slash/resume branch.
  - The gate is open when there is no budget service or when the trimmed prompt is exactly `/compact` or `/clear`
    (`BUDGET_EXEMPT_PROMPTS`). Otherwise it calls `canSend`.
  - When `canSend` refuses, it logs one INFO line (`sessionId`, `stage`, `percent`, `extensions`) and returns
    `{ success: false, errorCode: 'SESSION_BUDGET_REACHED', error }`.
  - The `error` text names both Gate 2 choices: `Session budget reached. Choose "Allow 20% more" or "Continue in new session" to keep working.`
- **56.2 resume:** `observeLoaded(stats ?? null)` runs right after `result.stats` is read. When it returns a state, the
  result gets `...(budget ? { budget } : {})`. `null` stats, or no service, adds no field.

Gate 2 behaviour: the gate refuses only when `canSend` reports `blocked`. Batch 54 sets that on the result that crosses
100% (with `blockAtLimit`). So the crossing turn finishes, and the next send pauses until the user acts. The action RPC
belongs to Batch 57.

**Stack observed**:

- Runtime: tsyringe constructor `@inject`, with `{ isOptional: true }` for host-optional collaborators (precedent:
  `chat-session.service.ts`, `AGENT_PROCESS_MANAGER`).
- Errors: structured results, `{ success:false, errorCode?, error }`, from `ChatContinueResult` in
  `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:163`.
- Spec pattern: hand-built constructor harness, copied from `chat-continue-slash-before-resume.spec.ts`.
- Budget API: `canSend` and `observeLoaded` never throw, because both catch internally
  (`session-budget.service.ts:200-215, 264-281`). So the gate adds no catch, and therefore no degradation-audit site.

## Verification

| Command                                                                                                          | Result                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers ptah-extension-vscode ptah-electron ptah-cli` | "Successfully ran targets typecheck, lint for 4 projects" (8 tasks, 0 cache hits)                                                             |
| `npx nx run-many -t test -p @ptah-extension/rpc-handlers --maxWorkers=2 --skip-nx-cache`                         | "Successfully ran target test for project @ptah-extension/rpc-handlers"                                                                       |
| `npx jest -c libs/backend/rpc-handlers/jest.config.ts …/chat/session --maxWorkers=2`                             | 14 suites, 170 tests passed. The new spec on its own: 15 passed.                                                                              |
| `npx nx run di-lint:lint`                                                                                        | "di-lint OK: 1731 @inject sites all resolve to a registered token (759 tokens)"                                                               |
| `npx nx run degradation-audit:lint --skip-nx-cache`                                                              | Succeeded. `libs/backend/rpc-handlers: 1 ok (baseline 1)`. The findings it lists are in files from earlier work, none of them Batch 56 files. |

Prettier was run on both files.

## Deviations

- **Budget state is not in the `chat:continue` refusal (requested extra, from the Batch 59 gap):**
  - `ChatContinueResult` (`rpc-chat.types.ts:163-171`) has only `success`, `sessionId`, `error`, `errorCode` and
    `providerId`. There is no field that can carry a `SessionBudgetState`.
  - Carrying it would mean adding an optional `budget?: SessionBudgetState` to that shared type. That is not a new
    public type, but it is an edit to a `libs/shared` file outside Batch 56's ownership. A separate unit of work would
    also need to typecheck the consumers of `ChatContinueResult`.
  - So the refusal carries only `errorCode` and the message. The state is logged at INFO on the backend.
  - Suggested follow-up: one line in `rpc-chat.types.ts`
    (`/** Budget state that refused the send, with SESSION_BUDGET_REACHED. */ budget?: SessionBudgetState;`). Then
    `refuseIfBudgetReached` adds `budget: check.state`, and Batch 59's send path installs it. This is a one-line
    change, because `check.state` is already in hand at the refusal.
- **Spec file name:** the batch says "+ spec", but no `chat-session.service.spec.ts` exists. Every sibling spec is
  topical (`chat-session-*.spec.ts`, `chat-continue-*.spec.ts`), so the new spec is `chat-session-budget.spec.ts`.
- **Gate position:** the gate sits right after the Ptah CLI branch, as the plan says, and before the
  `ensureRegisteredForSubagents` call. So a refused send does no MCP registration work. That is still before the
  slash/resume branch the plan names.

## Out-of-scope observations

None.
