# P3 fix-round re-review

Verdict: **APPROVED**

Score: **9/10**

Review family: reviewer **codex**, implementer **Claude**.

Scope: uncommitted `git diff HEAD -- libs/backend/agent-sdk libs/backend/cli-agent-runtime`, limited to the seven P3 findings and regressions from their fixes. Compared with revision-4 rules and D23/D27/D28. Source and git state were not edited.

## Findings 1–7

Paths below are repository-relative.

| Finding | Status | File:line evidence |
| --- | --- | --- |
| 1. Lane init key source | closed | `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:645` checks version and the independent `none`/`oauth` init allowlist before binding, attachment or task release. Adapter spec at `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts:1112` and `:1130` covers accepted, missing and disallowed sources. |
| 2. Omitted bound-lane resume | closed | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:479` and `:515` derive admission from the gate's stored run and requested directory, preserving omitted selection. `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:334` forwards the authoritative stored profile/run. Real-adapter boundary coverage: manager account-binding spec `:728`; completed adapter lifecycle: adapter spec `:1223`. |
| 3. Explicit conflicting resume selection | closed | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:325` refuses explicit ambient or another named profile with `conflict` before admission. Same/omitted selections continue. Adapter spec `:1247` and manager account-binding spec `:728` cover the boundary. |
| 4. Main-chat working directory | closed | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:1033` requires a project path; `:717` passes it into admission; `:735` rejects a differently certified cwd. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts:603`, `:616`, `:682` cover forwarding, mismatch and missing path. |
| 5. Account-info source `none` | closed | `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:351` accepts absent or `none` while retaining token-source, provider and personal-subscription checks. Adapter spec `:1148` exercises bootstrap and final children. |
| 6. Named main-chat raw stderr | closed | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1461` selects a named callback that emits only fixed diagnostics and never forwards the chunk to back-off or notice publication. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.cli-notice.spec.ts:316` supplies adversarial credentials, identity and path text. |
| 7. Missing persistence | closed | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:1029` refuses `unavailable-storage` before admission or query loading. Accounts spec `:643` covers either port missing and both missing. |

## New defects

None found in this scoped fix round.

## Decisions

- **Finding 4:** Both refusals are correct and fail closed. Missing/blank project path is a malformed named request (`conflict`) and reaches neither admission nor SDK loading. A launch for another directory does not certify this project's settings (`identity-unproved`); it is refused before child creation and its reservation is settled. Exact cwd comparison is conservative; the current certifier carries the supplied cwd into the launch. It cannot silently run in the account directory.
- **Finding 6:** Accept the trade-off. Suppressing the connectors notice prevents raw CLI text crossing RPC; certified personal authentication also makes its third-party-auth explanation inapplicable to an admitted route. Skipping stderr-based MCP back-off loses that recording for named runs, but is an explicit, bounded observability/retry-policy cost, not a task-gate or identity bypass. The ambient callback body is unchanged. No raw CLI text, account path, identity or credential is introduced into logs/RPC by these fixes; this is not a claim about every pre-existing logging path in the product.
- **Fresh handoff:** A pre-existing functional gap, exposed/documented during this round, not introduced by P3 and outside these seven fixes. The HEAD manager already carries the old reference into a fresh handoff and compares it against the new binding (`agent-process-manager.service.ts:657`, `:838` in the current file). The adapter's pre-existing missing-admission guard (`claude-cli.adapter.ts:280`) still rejects omitted selection. Keep this gap tracked separately; approval does not assert that fresh named handoffs work.
- **Binding and lease ownership:** Resume retains the stored run and skips `commitRunBinding` (`claude-sdk-lane-runner.ts:659`). One admission occurs per resumed child lifecycle. A closed run reacquires a lease for that same run; it does not create a second concurrent lease or a second binding. The existing store enforces this through `run_id UNIQUE` (`libs/backend/persistence-sqlite/src/lib/migrations/0058_provider_accounts.ts:76`); its existing resume/duplicate-lease spec is at `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts:655`. No extra admission was added to `laneAccountAdmission`, which only constructs a request.
- **Cleanup:** No double release found. Lane disposal memoizes settlement before aborting/closing (`claude-sdk-lane-runner.ts:760`); main-chat disposal also memoizes settlement (`session-query-executor.service.ts:879`). The new cwd mismatch has no child and releases once; its executed regression test verifies that count. Init refusal uses the existing close-and-settle path before opening the task gate.
- **Ambient behavior and test discipline:** New functional branches are named/bound-Claude-only; ambient stderr remains unchanged. No `process.cwd()` occurs in the four changed specs. The only `jest.spyOn` there targets a runner instance (`claude-cli.adapter.spec.ts:104`), not a module namespace.
- **Prettier hunks:** Confirmed behavior-neutral formatting at builder `:951`, `:963`, `:1151`, and the model-discovery hunk. Strictly, they are **not all whitespace-only**: they also add trailing commas and redundant parentheses around the nullish-coalescing expression. No semantic change found in those hunks.

## Validation

Executed exactly two single specs with `--maxWorkers=2`:

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts --maxWorkers=2` — 60 tests passed.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts --maxWorkers=2` — 90 tests passed.

Both runs emitted a Node warning about loading the TypeScript Jest configuration as an ES module; both suites passed.

## Not checked

- No builds, installs, full suites, `npm run verify`, typecheck, lint or e2e.
- Manager-to-real-adapter and stderr-notice specs were inspected, not executed in this review; the two-spec allowance was used above. Their mocked ports do not themselves establish real SQLite lease behavior; that invariant was inspected in the existing schema/store and existing store test.
- No live Electron/Claude CLI, real authentication, filesystem certification or concurrent-process exercise.
- No re-review of the whole phase or unrelated uncommitted batches (rpc-handlers, shared, frontend, apps/ptah-cli).
