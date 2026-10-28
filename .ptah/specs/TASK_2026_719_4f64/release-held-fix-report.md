# Release-held fix report: TASK_2026_719_4f64 (test-report D-1, R4.9 / N-2)

**Verdict: DONE.** No production path produces `release-held` any more. The remaining non-spec hits are the shared
union member, the two neutral COPY entries and the drawer fallback. The scoped agent-sdk tests pass (363 of 363).
The full cli-agent-runtime `src/lib` run passes (2649 passed, 1 skipped, 0 failed). Both libs typecheck clean
(lib and spec).

The follow-up batch, approved by the coordinator, is recorded under "Follow-up batch (adapter)" at the end. The
sections between here and there describe the first batch as it was written: they are its historical record, and the
follow-up batch supersedes their blocker and failing-test details.

## Files changed in batch 1 (4, all in `libs/backend`)

- MODIFIED `agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- MODIFIED `agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
- MODIFIED `cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`
- MODIFIED `cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`

## Replaced producers

Settlement (release or retain) is unchanged everywhere. `dispose()` still decides it only from termination proof and
`boundaryUnproved`. The refusal code does not affect it.

`session-query-executor.service.ts` (line numbers are after the change):

| Line | Situation | Old -> new | Why |
| --- | --- | --- | --- |
| 597 (`namedRefusalCode` fallback) | foreign or unclassified error | `release-held` -> `identity-unproved` | Plan default of `namedAccountRefusal`. The doc comment was updated to match. |
| 689 (`wait` cancel) | caller abort during an admission await | `release-held` -> `identity-unproved` (default) | Unproved named run (D23). |
| 694 (`wait` deadline) | 15 s bootstrap/admission deadline | `release-held` -> `identity-unproved` | Unproved named run. |
| 697 (`wait` post-abort) | late value after abort | `release-held` -> `identity-unproved` | Same. |
| 800 (`launch` pre-abort) | already aborted before the final launch | `release-held` -> `identity-unproved` | Same. |
| 817 (`next.done` before init) | stream ended before init | `release-held` -> `identity-unproved` | Init tripwire never proved (D23). |
| 825 (>64 messages, no init) | no init seen | `release-held` -> `identity-unproved` | Same. |
| 827 (missing reservation/baseline) | internal state not proved | `release-held` -> `identity-unproved` | Split out of the old combined check, which now runs before the registry bind, so a missing reservation never binds. |
| 829 (`bindAccountRoute` false) | no registry record, or the session is bound to another route | `release-held` -> `conflict` | Real binding conflict. |
| 830 (resume id != init session id) | SDK started a different session than the bound resume | `release-held` -> `conflict` | Real conflict with the stored binding. |
| 842 (`attachSdkSession` status != `attached`) | `binding-absent`, `session-linked-elsewhere` or `run-linked-elsewhere` | `release-held` -> `conflict` | Store-reported link conflict. |
| 869 (`verifyIdentity` missing child/baseline/launch) | identity cannot be checked | `release-held` -> `identity-unproved` | Unproved identity. |

`claude-sdk-lane-runner.ts`:

| Line | Situation | Old -> new | Why |
| --- | --- | --- | --- |
| 314 (`claudeLaneRefusal` default) | every no-code refusal (abort, deadline, stream end, missing child, gate refusal) | `release-held` -> `identity-unproved` | Plan default. Doc comment added. |
| 332 (`claudeLaneRefusalCode` fallback) | foreign error | `release-held` -> `identity-unproved` | Plan default. A forged `code` on a foreign `Error` is still not trusted. |
| 660 (resume != init session id) | SDK started another session | default -> `conflict` | Real conflict. |
| 698 (`attachSdkSession` status != `attached`) | link conflict | default -> `conflict` | Same reason as executor line 842. |

No path in these two files is a missing storage or port case, so neither file produces `unavailable-storage`. The
missing-port producers are in `claude-cli.adapter.ts` (below).

## Grep: remaining `'release-held'` producers in libs/ and apps/ (non-spec)

These hits are allowed: `shared/.../provider-account.types.ts:52` (union member), the neutral COPY entries
`rpc-handlers/.../provider-account-rpc.handlers.ts:182` and `auth-providers/.../claude-account-command.ts:35`, and
drawer `account-details-drawer.component.ts` (`HELD_FALLBACK` and its `held` check). Comment-only mentions are in
`agent-process.types.ts:334`, `manifest.ts:515`, `capabilities.ts:87`, `cli-adapter.interface.ts:44` and
`agent-sdk/src/lib/di/register.ts:215`. Nothing in `apps/` matched.

Other producers were found but not edited because they are outside this batch's ownership:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:290-293`:
  `claudeLaneRefusal('release-held', 'Claude account admission is not available')` when the admission port is
  missing. Per D28 finding 7 this should be `unavailable-storage`.
- `claude-cli.adapter.ts:295`: `if (!persistence?.available) throw claudeLaneRefusal();`. It now yields
  `identity-unproved` through the new default. Per D28 finding 7 it should be `claudeLaneRefusal('unavailable-storage')`.
- `claude-cli.adapter.ts:297-298`: a stale comment says "`release-held` for any foreign error".

## Tests

- R4.9 timeout, new test in `session-query-executor.accounts.spec.ts:372`: "refuses when the bootstrap deadline
  expires %s, with no final query and one settlement". It uses fake timers and never aborts the controller. The
  deadline itself aborts it, and the test asserts that `signal.aborted` is false before the timers advance and true
  after. Two cases:
  - Paused at the first `assertRouteCurrent` (no SDK child): exact refusal `{code:'identity-unproved', summary}`,
    0 query invocations, no commit, no metadata, 0 yielded, release ×1 and retain ×0.
  - Paused at bootstrap identity with an unproved bootstrap child: same refusal, only the bootstrap query (no final
    query), retain ×1 and release ×0. Settlement follows termination proof.
- Repinned in the accounts spec: every `release-held` expectation is now `identity-unproved`. The one exception is the
  `fail: 'registry'` case, which now expects `conflict`. The boundary-failure test title and `toEqual` were updated.
  The held-admission case (`code: 'release-held'` returned by the fixture admission port) still expects
  `release-held`, because it checks that the executor passes through the port's own code. The executor does not
  produce that code.
- Repinned in `claude-sdk-lane-runner.spec.ts`: the late-continue-after-abort case, and the default and foreign-error
  mapping test (now `identity-unproved`).

## Checks

- `npx tsc --noEmit -p` on `agent-sdk` `tsconfig.lib.json` and `tsconfig.spec.json`, and on `cli-agent-runtime`
  `tsconfig.lib.json` and `tsconfig.spec.json`: no output (pass).
- `npx eslint` on the 4 files: 0 errors and 2 warnings. Both warnings existed before this change:
  `max-lines` on `session-query-executor.service.ts` (1112 lines), and `no-non-null-assertion` at
  `claude-sdk-lane-runner.ts:714`.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle
  --maxWorkers=2`: 14 suites passed, 363 tests passed.
- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/claude
  libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters --maxWorkers=2`: 35 of 36 suites passed;
  1012 tests, 15 failed. All 15 failures are in `claude-cli.adapter.spec.ts`, and each has the same diff:
  expected `release-held`, received `identity-unproved`, at lines 664, 755 (×4), 769, 804, 846, 861, 880, 897, 935,
  951, 970 and 1224.
- Not run (outside this brief's scope): `register.agent-process-manager.smoke.spec.ts:374`, which pins
  `release-held` and may fail the same way, and the `it.each` in `agent-process-manager.account-binding.spec.ts:202`
  and `session-spawner.accounts.spec.ts:57`. Those two use `release-held` only as a propagated input value, so they
  are probably unaffected.

## Blocker

The adapter spec failures are a direct result of the required lane default change at `:311`. Fixing them needs a fifth
file, and correct codes need a sixth (`claude-cli.adapter.ts`). Recommended next step, as one extra small batch
owning `claude-cli.adapter.ts` and `claude-cli.adapter.spec.ts`:

1. Change adapter `:290` (admission missing) and `:295` (persistence unavailable) to `unavailable-storage` (D28 finding 7).
2. Fix the stale comment at `:297-298`.
3. Repin the 15 adapter cases: the "holds unavailable persistence" case to `unavailable-storage`, the rest to
   `identity-unproved`.
4. Run `register.agent-process-manager.smoke.spec.ts`.

`claude-cli.adapter.spec.ts` was already modified in the worktree before this batch (session-start git status), so
whoever owns that edit should do it, or the batch must be coordinated with them.

## Follow-up batch (adapter): resolves the Blocker

The coordinator approved this batch. It kept the senior tester's existing D39 change in `claude-cli.adapter.spec.ts`.

Files changed:

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts`

Adapter producers:

- `claude-cli.adapter.ts:290-293`, admission port missing: `release-held` -> `unavailable-storage` (D28 finding 7).
  The fixed message is unchanged.
- `claude-cli.adapter.ts:295`, persistence port missing or `available === false`: default -> `unavailable-storage`
  (D28 finding 7).
- `claude-cli.adapter.ts:297-298`: the comment now says foreign errors map to `identity-unproved`.

The 15 adapter-spec cases were repinned one by one, each to the code for its actual situation:

| Spec line | Situation | New code |
| --- | --- | --- |
| 664 | persistence `available = false` | `unavailable-storage` (adapter :295) |
| 755 (×4) | commitRunBinding, attachSdkSession, saveAccountBound or persistReference rejects with a foreign `Error` | `identity-unproved` (unclassified failure; a status-based attach refusal would be `conflict`, but these are thrown errors) |
| 769 | manager receipt callback rejects (foreign) | `identity-unproved` |
| 804 | turn after an observed epoch change (aborted lane, default refusal) | `identity-unproved` |
| 846 | later turn after metadata deleted (`validateResume` not ok, identity no longer proved for the turn) | `identity-unproved` |
| 861 | resume with `identity.kind === 'unknown'` | `identity-unproved` |
| 880 | admission throws a foreign `Error` that carries a forged `code: 'release-held'` | `identity-unproved` (the forged code is not trusted). The fixture input stays `release-held` on purpose. |
| 897 | bootstrap `accountInfo()` rejects | `identity-unproved` |
| 935 | query throws after an uncertain spawn (retain unchanged) | `identity-unproved` |
| 951 | late callback after epoch cancellation | `identity-unproved` |
| 970 | `accountBinding` supplied without an admission request (adapter :285 default refusal) | `identity-unproved` (see note) |
| 1224 | epoch cancellation during commitRunBinding | `identity-unproved` |

Smoke spec: `register.agent-process-manager.smoke.spec.ts:374` ("still refuses named admission without full
persistence"). No persistence port is registered there, so the adapter refuses at :295. The expectation is now
`unavailable-storage`.

Note: the binding-without-admission refusal at adapter :285 still uses the plan default `identity-unproved`, because
the brief named only :290 and :295. A reviewer could argue for `invalid-bound` or `conflict` there; it is a one-line
change if the plan prefers either.

Follow-up checks:

- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json` and `tsconfig.spec.json`: no output (pass).
- `npx eslint` on the 3 files: 0 errors and 7 warnings. All are `no-non-null-assertion` in the adapter spec and were
  already there.
- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib --maxWorkers=2`:
  118 suites passed out of 118; 2649 tests passed and 1 was skipped. This covers both it.each cases that only use
  `release-held` as an input value (`agent-process-manager.account-binding.spec.ts:202` and
  `session-spawner.accounts.spec.ts:57`); both still pass.

Final grep of non-spec `libs/` and `apps/` for `'release-held'`:

- `libs/shared/src/lib/types/provider-account.types.ts:52`: union member (allowed).
- `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:35`: neutral COPY (allowed).
- `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:182`: neutral COPY (allowed).
- `libs/frontend/chat/.../account-details-drawer.component.ts:414,419`: drawer `held` check and `HELD_FALLBACK`
  selection (allowed).
- `apps/`: no hits.

No other producer remains.

## Decisions

- Map registry bind refusal, resume-id mismatch and attach-link refusal to `conflict` rather than `identity-unproved`.
  The options were `conflict` or `identity-unproved`. Evidence: `AccountSdkSessionAttachmentResult` statuses
  (`*-linked-elsewhere`) and `SessionRegistry.bindAccountRoute`, which returns false when a different binding exists.
  This is reversible: three call sites.
- Check reservation and baseline before the registry bind, so an unproved state never binds the tab. This is a
  reordering of a side effect, has no settlement effect, and is reversible.
