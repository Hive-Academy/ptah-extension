# Backend implementation — `TASK_2026_719_4f64`, batch 16

**Verdict**: Task 16.1 is code-complete in the 4 owned files. The batch verify will FAIL on one
sibling spec outside this batch (`agent-rpc.handlers.resume-parent-session.spec.ts`, 12 tests)
until one mock line is added there. Details and the exact fix are under Blocker.

**Tasks completed**: Task 16.1 (`account_refused` mapping, named resume forwarding,
`accountProfileId`).

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - `:39` imports the value `LaneAccountResumeError` from the `@ptah-extension/cli-agent-runtime`
    barrel (exported at `cli-agent-runtime/src/index.ts:50`).
  - `:337-343` adds `LANE_ACCOUNT_REFUSED_ERROR`, the fixed reply text: "The Claude account for
    this agent was refused. The agent did not run on another account."
  - `:345-362` `laneAccountRefusalCode` now matches with `error instanceof LaneAccountResumeError`.
    The name match is removed. The code is used for the host log only. A code outside the
    whitelist is logged as `unavailable-storage`, which is also the class default.
  - `:364-386` `resumeSpawnAccountSelection` returns `cli === 'claude' ? selection : undefined`.
    A restated named selection is now forwarded, and the D7 release-held doc text is removed.
  - `:1330-1338` in `agent:continue`, a `LaneAccountResumeError` returns
    `{ success:false, code:'account_refused', error: LANE_ACCOUNT_REFUSED_ERROR }` (was
    `code:'unknown'` with the code in the text).
  - `:1463-1470` in the `agent:resumeCliSession` catch, a `LaneAccountResumeError` returns
    `{ success:false, error: LANE_ACCOUNT_REFUSED_ERROR }`. The comment at `:~1390` drops
    "release-held, D7".
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts`
  - The barrel mock now has a `LaneAccountResumeError` class with the real shape. The test
    imports it from the (mocked) barrel.
  - The continue tests (D28) cover:
    - `account_refused` with fixed text. A message containing a path, `.credentials` and an
      email does not leak (`expectNoLeak`).
    - The specific code is logged and kept out of the reply.
    - A non-whitelisted code is logged as `unavailable-storage`.
    - An impostor error that only carries the name is treated as an ordinary failure, which
      proves the match is `instanceof`.
  - The resume tests cover:
    - "forwards a restated named selection to the runtime for claude": spawn receives
      `accountSelection: {kind:'named', profileId}`. This replaces the D7 release-held test.
    - "maps a runtime LaneAccountResumeError to the fixed refusal text".
  - The existing "refuses a named account on a CLI without account bindings" (codex) and
    "resumes a CLI without account bindings on ambient" tests still pass, so non-Claude
    selections are not forwarded.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`
  - `:566-571` in the `session:list` row:
    `...(s.accountBinding?.profileId ? { accountProfileId: s.accountBinding.profileId } : {})`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts`
  - Imports the type `ProviderAccountBinding`.
  - `MetadataFixture` gains `accountBinding?`.
  - New test "reports only the bound profile id as accountProfileId": the bound row carries the
    profile id, the ambient row has no key, and the run id, fingerprint and ownerKey are not on
    the wire.
  - The pinned fixtures (forkSession / rewindFiles refusal codes, formerly `:2746-2786,3051`)
    are unchanged in content. They moved down about 35 lines because of the insertion at
    `:656`.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| `instanceof LaneAccountResumeError` maps to `account_refused` with fixed text | `agent-rpc.handlers.ts:354,1336-1337`; the continue tests, including the impostor test |
| No secret, path, email or CLI text in the reply | `LANE_ACCOUNT_REFUSED_ERROR` is a constant; `expectNoLeak` in the continue and resume tests |
| Named resume selections forwarded for `claude` only | `:385`; the "forwards a restated named selection" test; the codex tests are unchanged and pass |
| `accountProfileId` from `metadata.accountBinding?.profileId` | `session-rpc.handlers.ts:568-570`; the new session:list test |

## Stack observed

- tsyringe handler classes with `rpcHandler.registerMethod`; read from `agent-rpc.handlers.ts`.
- zod validation of params (`AgentResumeCliSessionParamsSchema`).
- Contract types in `libs/shared` (`rpc-agents.types.ts:525-542` already has
  `'account_refused'`; `execution/node.ts:264` already has `accountProfileId`).

## Verification

- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.lib.json`: no output, exit 0.
- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.spec.json`: no output, clean.
- `npx eslint` on the 4 files: 0 errors and 10 warnings. All warnings are existing `max-lines`
  and `preserve-caught-error` hits on untouched lines.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts .../agent-rpc.handlers .../session-rpc.handlers.spec.ts --maxWorkers=2`.
  The `agent-rpc.handlers` prefix also picked up the 6 sibling `agent-rpc.handlers.*.spec.ts`
  files.
  - Result: 8 suites, 7 passed and 1 failed. Tests: 391 passed, 12 failed.
  - The 2 assigned specs pass in full.
  - The failing suite is `agent-rpc.handlers.resume-parent-session.spec.ts`. See Blocker.
- `ptah_get_diagnostics` was not run. The tsc runs above cover the same project.

## Blocker (outside batch ownership; not edited)

`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts:32-37`
mocks `@ptah-extension/cli-agent-runtime` without `LaneAccountResumeError`. Whenever a resume
fails, the handler's catch evaluates `error instanceof undefined`. That throws a TypeError, so
12 tests that expect `{ success:false, error }` fail.

The old name-matching code existed only to avoid this (its removed doc comment said
"`instanceof` waits for those mocks"). The plan requires `instanceof` (D28, plan:848).

- **Fix (recommended).** Add one entry to that spec's mock, for example:
  `LaneAccountResumeError: class LaneAccountResumeError extends Error { constructor(readonly code: string) { super(code); this.name = 'LaneAccountResumeError'; } },`
  Then re-run that spec.
- **Other option, not taken.** Keep a name precheck before `instanceof` in production code. It
  only exists to satisfy a test mock and keeps the name-match residue that D28 removes.
- The other 5 sibling specs mock the barrel the same way but passed. None of their paths reach
  the lane refusal catch.

## Plan deviations / contract note

- Requirement 6 (task-description.md:344) says `agent:resumeCliSession` also reports the
  `account_refused` code. The shared contract `rpc.types.ts:1405-1411` (`agent:resumeCliSession`
  result) has no `code` field. Per the brief ("if an RPC contract type in libs/shared must
  change, stop and report"), I did not add one.
  - Resume returns only the fixed text.
  - `agent:continue` returns the code, because its contract (`AgentContinueErrorCode`) already
    has it.
  - To close requirement 6 for resume: an additive `code?: AgentContinueErrorCode` (or a narrower
    `'account_refused'`) on that result in `libs/shared`, then one line at
    `agent-rpc.handlers.ts:1470`.
- Pre-spawn refusals by the handler's own `resumeAccountRefusal` (conflict, invalid-bound,
  unavailable-storage) keep their existing text `Agent resume account refused (<code>).`. They are
  not `LaneAccountResumeError` and their tests are unchanged.

## Specs that mock or pin the changed members (rule 5)

- `laneAccountRefusalCode` / `resumeSpawnAccountSelection` / the reply texts:
  `agent-rpc.handlers.spec.ts` (updated here) and
  `agent-rpc.handlers.resume-parent-session.spec.ts` (barrel mock; see Blocker).
- `session:list` row shape: `session-rpc.handlers.spec.ts` (additive key; existing assertions
  unchanged).
- No ambient-path pins (plan 943-953) were touched.

## Decisions

- **Reply text without the code.** Options: (a) a fixed constant; (b) the whitelisted code
  interpolated into the text, as before. The brief and plan:848 say "fixed text", and the code is
  now carried by `code: 'account_refused'` plus the log. Reversible.
- **Non-whitelisted code logged as `unavailable-storage`.** This matches the class's own
  constructor default (`lane-resume-gate.ts:157`). Reversible.

## Out-of-scope observations

- The resume-parent-session spec mock (Blocker).
- The missing `code` on the `agent:resumeCliSession` result contract (contract note).
