# P3 fix lane report: findings 1, 2, 3, 5 (lane side)

## Backend implementation: `TASK_2026_719_4f64`, P3 fixes 1/2/3/5

**Verdict**: all four findings are fixed. Lib and spec typecheck are clean. Scoped jest passed: 62 suites, 1771 tests. ESLint reports 0 errors.

### Files

Every path is under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/`.

- MODIFIED `claude/claude-sdk-lane-runner.ts`: fixes 1 and 5.
- MODIFIED `cli-agents/cli-adapters/claude-cli.adapter.ts`: fixes 2 and 3 (adapter validation).
- MODIFIED `cli-agents/agent-process-manager.service.ts`: fix 2 (manager derivation) and fix 3 (explicitness kept).
- MODIFIED `cli-agents/cli-adapters/claude-cli.adapter.spec.ts`: fixture plus tests for fixes 1, 3 and 5, and the omitted-resume success case.
- MODIFIED `cli-agents/agent-process-manager.account-binding.spec.ts`: manager-to-real-adapter tests for fixes 2 and 3; the B14 omitted-resume pin was updated.
- `claude/claude-sdk-lane-runner.spec.ts` was not changed. The new lifecycle tests sit in the adapter spec, because that spec has the full bootstrap-plus-final child fixture.

### Per finding

1. **Init `apiKeySource` tripwire** (`claude-sdk-lane-runner.ts`)
   - Change:
     - New `INIT_PERSONAL_KEY_SOURCES = {'none','oauth'}` (~:331).
     - The init branch in `launch()` (~:645-651) now refuses `identity-unproved` unless `claude_code_version` matches and init `apiKeySource` is exactly `none` or `oauth`. A missing field fails.
     - The refusal is thrown before `commitRunBinding`, attach, the receipt callback and the task enqueue. That is the same path as the version check, so `runSdk` disposes the admission and the final child.
   - Fixture: `namedFixture()` now carries a mutable `initKeySource`, default `'none'`, emitted on the init message. The old fixture omitted it (~:606).
   - Tests (adapter spec, "named Claude lane certified launch boundaries"):
     - `accepts init apiKeySource none|oauth and completes the named lifecycle`.
     - `refuses a missing | ANTHROPIC_API_KEY | apiKeyHelper init apiKeySource despite valid account info…`. These check that account info was read, and that there is no commit, no attach, no callback, the final gate is drained and the child is closed.
5. **Account-info `apiKeySource: 'none'`** (`claude-sdk-lane-runner.ts:351`)
   - Change: `personalClaudeLogin()` accepts `undefined` or `'none'`. This stays separate from the init allowlist.
   - Test (adapter spec): `accepts account-info apiKeySource none through bootstrap and final`. Both children report `'none'`, and the lifecycle completes with the binding.
2. **Omitted resume of a bound named lane**
   - Change, manager (`agent-process-manager.service.ts`, new `boundResumeAdmission()` ~:506-530; used at ~:479-486):
     - Applies when the gate returned a stored reference and the request is a real resume (`gated.resumeSessionId` set).
     - It builds the Claude admission from the stored binding's `runId` and the requested `workingDirectory`.
     - `selection` is the caller's selection unchanged, or `{kind:'omitted'}` when absent.
     - The workspace default is never read on resume.
   - Change, adapter (`claude-cli.adapter.ts` ~:321-332): with a stored binding, `omitted` continues. The admission request is then given the stored profile and run, as before, so `commitRunBinding` is skipped and no second run binding is made.
   - Tests:
     - Manager spec, new describe `P3 bound lane resume through the real Claude adapter`. It uses the real `ClaudeCliAdapter` with fake persistence and a fake admission port, and admission stops at a typed `busy`. `omitted` and `same named` resumes both reach `admitClaudeRoute` once, with `runId: run12345`, the stored profile and the requested working directory. The workspace-default reader is never called, and `commitRunBinding` is not called.
     - Adapter spec: `resumes a bound lane on the stored run without a second binding (an omitted selection)` runs through to a handle with the stored binding, with one admission and no `commitRunBinding`.
     - The B14 pin `keeps the session's stored account on an omitted resume` now expects the derived admission (`omitted` with the stored `runId`) instead of `undefined`.
3. **Explicit conflicting selection on resume**
   - Change, adapter (`claude-cli.adapter.ts` ~:321-332): after the authoritative lookup and `validateResume`, and before admission:
     - Stored binding with explicit `ambient`, or `named` with a different `profileId`: refuses `claudeLaneRefusal('conflict')`.
     - Same profile or `omitted`: continues.
     - No stored binding and a non-named selection: refuses.
   - Change, manager: explicitness now crosses the boundary. Explicit ambient on a bound resume used to become "no admission"; it is now forwarded as `{kind:'ambient'}`. An explicit named selection is forwarded as given.
   - Tests, covering all four cases with the real adapter:
     - Manager spec `refuses another named account | explicit ambient … with conflict before admission`: `code: 'conflict'`, no `admitClaudeRoute`, no SDK load, no commit. The `omitted` and `same` cases are covered above.
     - Adapter spec `refuses a resume selecting another named account | explicit ambient … with conflict`, plus the `same`/`omitted` resume success cases.

### Specs that mock or pin changed members (rule 5)

- `claude-cli.adapter.spec.ts`:
  - `namedFixture` (init message, `accountInfo`).
  - The `trips on … in the final child` cases.
  - `resumes a bound lane…`.
- `agent-process-manager.account-binding.spec.ts`: the `Claude lane account selection precedence` describe (`runSdk.accountAdmission` pins).
- `claude-sdk-lane-runner.spec.ts`: `named lane identity proof` tests `personalClaudeLogin` through bootstrap. Its `apiKeyHelper` case still trips.
- No ambient-path pin changed. Fresh ambient spawns and explicit-ambient fresh spawns still forward no admission.

### Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json` | 0 errors |
| `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.spec.json` | 0 errors |
| `npx eslint` on the 5 changed files | 0 errors, 14 warnings (see below) |
| `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/claude libs/backend/cli-agent-runtime/src/lib/cli-agents --maxWorkers=2` | 62 suites, 1771 tests passed |

The concurrent agent-sdk edits caused no errors in either typecheck. Three of the ESLint warnings are new and come from my spec lines: `no-non-null-assertion` in `claude-cli.adapter.spec.ts` at ~:1150, ~:1228 and ~:1252 (`getMockImplementation()!`, `accountAdmission!`). The rest were already there: `max-lines` in `agent-process-manager.service.ts`, which I grew by about 25 lines; a `no-empty-function` warning; and other non-null assertions.

`ptah_get_diagnostics` was not run. The lane's tsc checks cover the same files. `npm run verify` was not run, per rule 12.

### Decisions

- **Where the bound-resume admission is derived**
  - Decision: the manager derives it from the gate's authoritative reference; the adapter stays the validator.
  - Options considered: the manager derives it, or the adapter builds the admission itself.
  - Evidence: the finding allows either; `ClaudeAccountAdmissionRequest.selection` already allows `omitted` and `ambient`, so no shared type changed.
  - Reversible: yes.
- **Fresh handoff**
  - Decision: derivation applies only when `gated.resumeSessionId` is set. A fresh handoff from a bound session keeps today's behaviour.
  - Evidence: a fresh handoff has no resume id and no stored run to reuse; reusing the old `runId` without a stored lookup would be wrong.
  - Reversible: yes.

### Out-of-scope observations

- A **fresh handoff** from a bound named lane (`gateResume` decision `fresh`) forwards the old `accountReference` with no resume id. With an omitted selection, the adapter refuses (binding fields with no admission). With an explicit named selection, a new run is admitted, but the manager's `onAccountBinding` compares the new reference to the old one and refuses `invalid-bound`. This predates P3 and is not one of findings 1-3/5. The decision belongs to the plan owner: drop the reference, or re-admit the stored profile on a new run.
- Findings 4, 6 and 7 (agent-sdk) were not touched.
