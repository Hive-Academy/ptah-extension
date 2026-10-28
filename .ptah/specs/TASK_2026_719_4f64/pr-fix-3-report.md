# PR #827 fix 3 — fresh handoff of a bound named Claude lane

## Finding

CodeRabbit (Major): when the resume gate returned `fresh` for a session with a
stored named binding, `spawn` still forwarded `gated.accountReference` while
`boundResumeAdmission` returned nothing, because the gate had cleared the
resume id. `laneAccountAdmission` had also skipped the stored-selection read,
because the request carried a resume id. `ClaudeCliAdapter.prepareNamed` then
received a binding with no admission and refused it. As a result, every bound
named lane that the gate started fresh failed.

## Change

File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`

- :477-486 `spawn` forwards `accountReference` only on a true resume
  (`gated.resumeSessionId` set). A fresh handoff is a new run. Forwarding the old
  reference would also make the `onAccountBinding` checkpoint refuse the new run
  as `invalid-bound`. The admission now comes from `boundLaneAdmission(...)`,
  with the existing `accountAdmission` as the fallback.
- :505-553 `boundResumeAdmission` is replaced by `boundLaneAdmission(request, cli, gated, workingDirectory)`:
  - Not Claude, or no stored binding: returns `undefined`. Ambient sessions and
    other CLIs do not change.
  - True resume: the same behaviour as before. It reuses the stored `runId`, so
    there is no second run binding or lease (D27, P3 finding 2). It forwards the
    caller's selection (`omitted` when absent), so the adapter still refuses a
    conflicting named selection or explicit ambient with `conflict` (P3 finding 3).
  - Fresh handoff: an explicit `ambient` selection, or a `named` selection of
    another profile, throws `LaneAccountResumeError('conflict')`. Otherwise it
    admits a NEW run (`runId: randomUUID()`) with
    `selection: { kind: 'named', profileId: <bound profile> }` and the requested
    working directory. This goes through the normal adapter admission path. The
    workspace default selection is never read.

The conflict check for the fresh case lives in the manager. No session is
resumed, so the adapter has no stored binding to compare against.

## Tests

File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts`

The new block is `describe('fresh handoff of a bound named lane')` at :794,
inside the existing "P3 bound lane resume through the real Claude adapter"
suite. A restored lane record dated 1970 drives the gate to `fresh` through
the real `LaneResumeGate` idle limit (the gate clock is 2_000_000 ms).

1. Real `ClaudeCliAdapter`, fake persistence and admission port:
   - The fresh handoff reaches `admitClaudeRoute` once.
   - The admission names the bound profile, uses a new `runId` (not `binding.runId`) and the requested working directory.
   - It never calls `readStoredSelection` and never calls `lookupBySdkSession`.
2. Fake `runSdk`:
   - The run options carry no `accountBinding` or `accountBindingId`. The old reference is not forwarded.
   - There is no `resumeSessionId`, and the admission is named on the bound profile with a new run.
   - The new-run `onAccountBinding` checkpoint persists the new reference without an `invalid-bound` refusal.
3. Real adapter: an explicit different named selection and explicit ambient
   both refuse with `LaneAccountResumeError` `conflict` before admission. There
   is no commit and no query load.
4. Real adapter: an explicit selection of the same bound account is admitted as a new run.

The existing true-resume tests are unchanged and pass: omitted or same-named
resume reuses the stored run with no `commitRunBinding`, and a conflicting
selection or ambient on resume refuses with `conflict`.

## Checks

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager --maxWorkers=2`: Test Suites 7 passed, Tests 307 passed.
- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json`: exit 0, no errors.
- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.spec.json`: exit 0, no errors.
- `npx eslint` on both changed files: 0 errors and 6 warnings. All 6 were already there before this change: spec non-null assertions at :268/:284/:300/:328, service `max-lines`, and one empty arrow at :2407.
- I did not run `npm run verify`, a build, an install or any git command, as the brief required.

## Decisions

- Where the fresh-handoff `conflict` is refused: in the manager, not the adapter. The
  options were the manager, or passing the stored binding into the adapter. The
  adapter files belong to another developer, and on a fresh handoff the adapter
  has no resume id and so no stored binding. Reversible.
- What the fresh-handoff admission selects: always `named` on the bound profile,
  even when the caller's selection was omitted. This keeps the lane on the same
  profile and never reads the workspace default (D27). Reversible.

## Out of scope

- `prepareSdkHandleSpawn` (Ptah CLI registry path) still returns the gate's
  `accountReference` on `fresh`. That path does not use `ClaudeCliAdapter` and
  is not part of this finding. I did not touch it.
- No third file was needed. I did not touch any file owned by another developer.
