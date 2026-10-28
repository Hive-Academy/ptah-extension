# Bugfix: named admission refusal reasons and first-message wait (D76 item 1)

## Files changed

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`

I did not touch `sdk-agent-adapter.ts` or `chat-session.service.ts`. The other changes to those files in the
working tree belong to the parallel developers.

## Design

- `export type NamedRefusalReason` is a union of 25 fixed string literals.
- The reason is kept in a module `WeakMap<object, NamedRefusalReason>` keyed by the refusal object. It replaces
  the former `issuedRefusals` WeakSet, so `isNamedRefusal` behaves the same. The refusal object stays
  `{ code, summary }`, so the renderer still receives the same code and text. Existing
  `toEqual({ code, summary })` specs still pass.
- `namedAccountRefusal(code = 'identity-unproved', reason = 'unclassified')` takes a second argument. It
  stays signature-compatible, so the existing calls in `sdk-agent-adapter.ts` still compile and get
  `unclassified`.
- `export function namedRefusalReason(error)` returns the stored reason. It returns `launch-refused` for a
  `ClaudeCertifiedLaunchRefusal` and `step-failed` for any other error.
- The private `rewrapNamedRefusal(error)` replaces every `namedAccountRefusal(namedRefusalCode(error))`
  re-wrap. Code and reason now both survive the catch blocks in `bootstrap`, `launch`, the gate `approve`
  callback and the executor's init catch.
- Logging changes:
  - The existing `[SessionLifecycle] Query init failed ...` error log now carries
    `new Error('Named account query initialization refused (reason: <reason>).')`.
  - The named bootstrap catch in `SessionQueryExecutor` did not log before. It now logs
    `logger.warn('[SessionLifecycle] Named admission refused', { reason, step: 'bootstrap' })`.
  - Only fixed literals are logged: no ids, paths, tokens or message text.

## Reason-code table

| Site | Reason |
| --- | --- |
| `namedIdentity`: not a personal login | `identity-unproved` |
| `namedIdentity`: owner key mismatch or null | `identity-mismatch` |
| `refuseIfExpired` | `expired` |
| `wait`: abort listener | `aborted` |
| `wait`: timer, admission end reached | `expired` |
| `wait`: timer, per-step limit reached | `step-timeout` |
| `wait`: disposed or aborted after race | `aborted` |
| `bootstrap`: resume binding missing or unknown | `resume-unproven` |
| `bootstrap`: admission port not ok (keeps port code) | `admission-refused` |
| `bootstrap`: resources not named | `not-named` |
| `bootstrap`: no certified launch | `launch-missing` |
| `bootstrap`: launch cwd differs | `launch-cwd-mismatch` |
| `bootstrap`: stored route differs | `binding-mismatch` |
| `bootstrap`: stored identity differs | `identity-mismatch` |
| `checkBoundary`: no certified launch | `launch-missing` |
| `checkBoundary`: `assertCertifiedLaunch` throws | `launch-refused` (via `namedRefusalReason`) |
| `checkBoundary`: boundary outcome not ok (keeps outcome code) | `boundary-refused` |
| `launch`: disposed or aborted at entry (2 sites) | `aborted` |
| `launch`: no certified launch | `launch-missing` |
| `launch`: stream ended before init | `stream-ended` |
| `launch`: init version or key source not certified | `init-unproven` |
| `launch`: more than 64 buffered messages | `buffer-overflow` |
| `launch`: no reservation or baseline | `state-missing` |
| `launch`: `bindAccountRoute` false (`conflict`) | `route-conflict` |
| `launch`: resume SDK session id differs (`conflict`) | `session-mismatch` |
| `launch`: committed binding differs | `binding-mismatch` |
| `launch`: attach not attached (`conflict`) | `attach-conflict` |
| `launch`: disposed or aborted before admit | `aborted` |
| `verifyIdentity`: no child, baseline or launch | `state-missing` |
| `verifyIdentity`: identity differs | `identity-mismatch` |
| Executor: auth env override (`wrong-provider`) | `wrong-provider` |
| Executor: no admission or persistence port | `storage-unavailable` |
| Executor: empty project path (`conflict`) | `project-path-invalid` |
| Any non-refusal error that is re-wrapped | `step-failed` |
| `sdk-agent-adapter.ts` sites (not edited) | `unclassified` |

## First-message wait change

- `wait(pending, bound: 'step' | 'first-messages' = 'step')` sets the limit as follows:
  - before admission, `'first-messages'` uses `max(0, admissionEndsAt - now)`;
  - `'step'` keeps `min(deadlineMs, remaining)`;
  - after admission, the limit is `deadlineMs`, as before.
- Only the `query.next()` loop in `launch()`, which waits for `system/init`, passes `'first-messages'`.
- These behaviours are unchanged:
  - the 90 s `admissionEndsAt` bound;
  - `refuseIfExpired()` before and after each race;
  - the M1 handling, where `pending` is observed before an expiry refusal is rethrown;
  - the settlement bound in `dispose()`.
- The timer now rejects with its reason before it calls `abort()`, so the timeout reason wins the race over
  the abort listener's `aborted`. The public code is `identity-unproved` either way.

## Specs (session-query-executor.accounts.spec.ts)

- New: `admits when the first stream message is slower than the step limit but inside the budget`. It pauses
  `init` for 20 s with a 15 s step limit and a 60 s budget, and the run admits.
- New: `refuses with reason expired when the first stream message outlasts the budget`. With a 20 s budget,
  the run has not settled at 15 s and is refused at 20 s with reason `expired`. The public refusal is
  unchanged and there is no binding.
- New: `keeps the step limit for other steps and refuses them with reason step-timeout`. A `commit` pause
  is refused at 15 s with reason `step-timeout`.
- New: `carries the refusing step as the reason without changing the public refusal`. An unknown resume
  is refused with reason `resume-unproven` and `toEqual({ code, summary })` still holds.
- Updated: `refuses when no init arrives before the admission end, with the first turn only and no binding`.
  It was `... before the deadline`. It now passes `budgetMs: 200`, because the wait for init is now bounded
  by the admission end rather than the 50 ms step limit (the intended D76 change). Otherwise the spec ran
  into the real 90 s budget and hit the 5 s Jest timeout.

## Verification

- `node D:/projects/ptah-extension/scripts/verify.mjs -t test,typecheck -p @ptah-extension/agent-sdk -- --output-style=static -- --testPathPatterns=session-query-executor`
  - First run: 1 failure, the old init-deadline spec described above, which I then updated. The nested `--`
    form also passed the path filter on to `tsc` (TS5023), so I ran the targets separately.
- `node .../verify.mjs -t test -p @ptah-extension/agent-sdk -- --output-style=static -- --testPathPatterns=session-query-executor`
  - Result: `Test Suites: 6 passed, 6 total` / `Tests: 184 passed, 184 total`, exit code 0.
- `node .../verify.mjs -t typecheck -p @ptah-extension/agent-sdk -- --output-style=static`
  - Result: `Successfully ran target typecheck for project @ptah-extension/agent-sdk`, exit code 0.
  - An earlier attempt exited 3221226505 (a process crash) after 6 s with no TS errors. The re-run passed.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
  - Result: exit 0, `TOTAL 278 unsuppressed site(s)`, within baseline. No catch blocks were added.

## Decisions

- **Where the reason lives.** I keep it in a WeakMap keyed by the refusal object rather than as a property.
  - Options: an own property on the object, or a WeakMap beside it.
  - Evidence: existing specs assert `toEqual({ code, summary })`, and the refusal crosses to the renderer.
  - Reversible: yes.
- **How the reason reaches the log.** The "Query init failed" log is in the same file, so the reason goes into
  its fixed Error text. I also added one fixed-field warn on the bootstrap catch, which had no log before.
  - Reversible: yes.

## Out-of-scope observations

- The `namedAccountRefusal` calls in `sdk-agent-adapter.ts` (`conflict` and `invalid-bound`) carry the
  `unclassified` reason. Their owner can add reasons later.
