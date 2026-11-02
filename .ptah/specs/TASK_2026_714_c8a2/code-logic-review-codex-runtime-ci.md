# Code Logic Review — codex-runtime CI test fixes (after 1a70e28d9)

Scope: uncommitted diff under `libs/backend/codex-runtime/` (two spec files). Static read; no tests were run.

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE (one new test assertion is wrong and will fail) |
| Blocking | 1 |

## 1. Allowlist vs the pinned-schema check — OK
`codex-protocol-validator.spec.ts:1070-1110`.
- The allowlist is keyed by exact `"<group>/<method>"` and has one entry, `ClientRequest/thread/list: ['ancestorThreadId']`. Every other field of every method still has to appear in the pinned params; the skip only fires for names in the list.
- It also asserts that each allowlisted field is modeled and is not pinned. That catches a typo and a stale entry if the pinned schema later gains the field as stable.
- The pinned-required-fields loop is untouched. This does not weaken the contract for other fields.
- The justification matches the implementation: `codex-session-history.ts` `listPages` sends `ancestorThreadId` only when `targeted`, and retries without it on RPC `-32602`.

## 2. Fallback-retry fixture change — genuine inconsistency, impl is right
`hydrateThread` (`codex-session-history.ts` ~L110-117) rejects a descendant when `metadata.parentThreadId !== listedThread.parentThreadId`. In the `fallbackPages` fixture, `thread/list` returned `other` with `parentThreadId: 'child'`, while `thread/read` returned `other = {...child, ...}` with `parentThreadId: 'root'`. The list and read data disagreed, so the implementation correctly dropped the thread with `malformedPage`. The new `grandchild` constant makes both sides agree (`parentThreadId: 'child'`). The change fixes the fixture and does not mask an implementation bug; the parent-mismatch protection is still covered by the existing `childMismatch` test.

## 3. Split of conflicting vs unbounded cases
The split is correct in principle:
- `conflict`, `duplicateTurn` and `duplicateItem` fail in the root hydration path (turns/items of the root), which is not wrapped in the descendant try/catch, so they still reject with `malformedPage`.
- `blankCursor` / `endless` fail inside `pages()` called from `listPages`, whose outer catch records the failure and degrades to root-only history with one warning (`~L190-230`). That is what the new test intends.

### BLOCKING: the new degradation test's expected metadata is wrong
`codex-session-history.spec.ts` new test `keeps root history and warns after listing pages fail`:
```
partialListing: false, completedLists: 0, failedLists: 2, failures: [ {archived:false,...}, {archived:true,...} ]
```
The shared fixture answers every archived listing with a terminating page: `'archived' in params && params.archived ? { data: [] }` (fixture, `thread/list` case) — no `nextCursor`. So `blankCursor` and `endless` only break the `archived: false` listing. The `archived: true` listing completes normally. The implementation therefore yields `completedLists: 1`, `failedLists: 1`, `partialListing: true` (`completedLists > 0 && failedLists > 0`), and a single failure `{ archived: false, reason: code, issues: '[]' }`. The test expects two failures and `failedLists: 2`, so `toEqual` will fail, which would fail the CI job this change is meant to fix. (The other test that expects both archived listings to fail does so through its own request wrapper that rejects every call, not through this fixture.)
- Fix: expect `{ partialListing: true, completedLists: 1, failedLists: 1, failures: [{ archived: false, reason: code, issues: '[]' }] }`. The rest of the assertions (threads `['root']`, root turns `['r1','r2']`, one warn with the expected message) look consistent with the implementation.
- Risk note: I derived this by reading the fixture and the implementation, not by running the test. If the fixture's archived branch was edited elsewhere in this diff I would have seen it; it was not.

## Other checks
- `logger.warn.mockClear()` precedes the new test, and `warnMeta` reads `calls[0]`; one warning is expected. OK.
- No implementation, pinned schema, or bench files changed. OK.

## Verdict
REVISE, 6/10. Allowlist and fixture changes are sound; correct the `completedLists` / `failedLists` / `partialListing` / `failures` expectation in the new degradation test before pushing.
