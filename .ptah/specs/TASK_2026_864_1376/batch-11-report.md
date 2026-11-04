# Batch 11 test report

## Task 11.1: Explicitly empty Codex home

- Added four test executions across two spec files. The adapter case injects a home resolver that rejects with `Codex home is empty` after a binary resolves. It asserts the exact `{ cli: 'codex', installed: false, messagingMode: 'queue' }` result, the specific warning, no credential check, and no runtime open.
- The composition parameterized case covers `CODEX_HOME=''` and `HOME=''` without `CODEX_HOME` or `USERPROFILE`. A registered selection snapshot supplies a resolvable fake binary. Each case asserts the exact unavailable result and that binary selection occurred once.
- The composition control case supplies non-empty `HOME` and the same binary, asserting `installed: true` and the selected path and version.
- Existing test cases were not edited. The adapter harness gained an optional home resolver so the test exercises the intended dependency boundary.

## Files modified

- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.spec.ts`

## Verification

- Ran once from the worktree root: `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/cli-engine 2>&1 | tail -40`. The underlying verify process exited 1 before any targets ran: Nx daemon socket connection and plugin worker socket were denied with `EPERM`. The shell pipeline reported exit 0 because `tail` completed. The orchestrator must run the scoped check.
- `ptah_get_diagnostics` returned unavailable after its 45-second TypeScript check timeout; both changed specs remained unchecked. No test pass or fail result is claimed.
- Other concurrent changes shown by `git status` in `auth-providers` and the task folder were not made or reverted by this lane.

## Decisions

- Injected the rejecting home resolver through the existing adapter harness, rather than making the credential probe throw. Evidence: `detect()` calls `ensureTokensFresh()`, which awaits `home()` before credential checking. Reversible: yes.
- Registered a fake `CodexSelectionSnapshotPort` in the composition tests to supply a resolvable binary without filesystem or CLI probing. Evidence: the composition's binary probe calls `selectForOpen()`. Reversible: yes.
