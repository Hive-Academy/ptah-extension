# Task report: codex-runtime CI test fixes (PR #881, after 1a70e28d9)

Scope: `libs/backend/codex-runtime/` only. Two spec files changed; no
implementation file, no pinned schema file, no `tools/mcp-bench` change.
No verification command was run locally (forbidden for this lane); every
decision below is backed by a manual trace of the code and fixtures.

## Failure 1 — codex-protocol-validator.spec.ts:1093

Test: `pinned schema contract › models thread/list with pinned ClientRequest
field names`.

### Root cause

Commit 1a70e28d9 added `ancestorThreadId: string.nullish()` to the modeled
`thread/list` request params (`codex-protocol-methods.ts:102`). The field is
experimental and intentionally absent from the pinned stable schema: the pinned
`v2/ThreadListParams` (in `protocol/codex-app-server-protocol.schema.json`)
lists only `archived, cursor, cwd, excludedThreadIds, limit, modelProviders,
originators, searchTerm, sectionId, sortDirection, sortKey, sourceKinds,
useStateDbOnly`. The contract test asserts that every modeled field name
appears in the pinned params, so it failed on `ancestorThreadId`.

### Decision: fix the test, not the model or the pinned schema

- The model must keep the field: it is how the runtime validates the outbound
  request before sending it (the descendant listing in
  `codex-session-history.ts:188-198`).
- The pinned schema files must not be edited (task rule, and the field is not
  part of the stable contract).
- The test now keeps an explicit, named allowlist of experimental fields and
  checks them separately instead of weakening the pinned check.

### Changes (codex-protocol-validator.spec.ts)

- Lines 1070-1077: new `experimentalParams` allowlist, keyed by
  `"<group>/<method>"`, currently only `ClientRequest/thread/list:
  ['ancestorThreadId']`, with a comment explaining why the field is absent
  from the pinned schema.
- Line 1098: per-method lookup `experimentalParams[`${group}/${method}`]`.
- Lines 1101-1104: the "every modeled field must be pinned" check now skips
  only allowlisted fields. Strictness for every other field is unchanged.
- Lines 1105-1109: separate check for each allowlisted field: it must be
  modeled (catches typos in the allowlist) and must NOT be pinned (catches a
  stale allowlist entry if the pinned schema ever gains the field as stable).

All other rows of the `it.each` get an empty allowlist and behave exactly as
before. The pinned-required-fields check is untouched.

## Failure 2 — codex-session-history.spec.ts:240

Test: `retries plain cursor listing after the experimental ancestor param is
rejected`. Expected `['root','child','other']`, received `['root','child']`.

### Root cause: the fixture contradicted itself

In the `fallbackPages` fixture the `thread/list` page 2 returned
`{ ...other, parentThreadId: 'child' }` — a genuine descendant (grandchild:
other -> child -> root). But the fixture's `thread/read` arm for id `other`
returned the base `other` object, whose `parentThreadId` is `'root'`
(inherited from `child`). So the synthetic server answered `thread/list` and
`thread/read` with two different parents for the same thread.

The implementation is not wrong here:

- The descendant selection loop (`codex-session-history.ts:223-238`) does
  select the grandchild: `child` is selected in the same pass, and `grandchild`
  is examined after it in Map insertion order.
- The drop happens in `hydrateThread` (`codex-session-history.ts:108-111`),
  which deliberately cross-checks `id`, `sessionId` and `parentThreadId`
  between the listed row and the `thread/read` metadata and throws
  `malformedPage` on disagreement. That guard predates 1a70e28d9 and is
  required by the passing test `keeps root and other child after parent
  mismatch` (spec lines 253-280), which asserts a mismatched child is dropped
  with a warning. Relaxing that check to satisfy this fixture would break that
  test and weaken a data-integrity guard; a real server cannot disagree with
  itself about a thread's parent.

### Decision: spec-side fixture fix; the expectation stays

`'other'` is a genuine descendant in the fixture, so the end state must remain
`['root','child','other']` (the expectation is NOT relaxed to
`['root','child']`). The bug was the fixture's inconsistent `thread/read`
answer, so the fixture was made self-consistent. With consistent data the
implementation hydrates the grandchild and emits no warning, which is what
the test asserts.

### Changes (codex-session-history.spec.ts)

- Lines 14-16: new `grandchild` fixture object
  `{ ...other, parentThreadId: 'child' }` with a comment that list and read
  must agree.
- Line 51: `thread/read` for id `other` returns `grandchild` when
  `fallbackPages` is set, `other` otherwise (non-fallback tests unchanged).
- Line 60: the fallback listing page 2 returns the same `grandchild` object.

Manual trace of the fixed test: targeted listing rejected with -32602 -> plain
listing page 1 `[unrelated, child]`, page 2 `[grandchild]`; selection picks
child then grandchild; both hydrate (turns c1/c2, items paged); snapshot
`['root','child','other']`; no failures recorded, so `logger.warn` is not
called; the `listParams` sequence assertions are unaffected.

## Failure 3 — codex-session-history.spec.ts:333

Test: `fails explicitly on conflicting or unbounded pages`
(`it.each` with conflict/duplicateTurn/duplicateItem -> malformedPage,
blankCursor -> stalledCursor, endless -> pageLimitExceeded).

### Root cause

The five cases do not share one failure path:

- `conflict`, `duplicateTurn`, `duplicateItem` are injected into
  `thread/turns/list` and `thread/items/list`, which run inside
  `hydrateThread(root)` (`codex-session-history.ts:156`) — the ROOT read path,
  which is not wrapped in a try/catch. These still reject; they passed.
- `blankCursor` and `endless` are injected only into the `thread/list` arm of
  the fixture, which 1a70e28d9 deliberately made auxiliary: a listing failure
  is recorded and the root-only history is returned with one aggregated
  warning (`codex-session-history.ts:200-222`, `250-256`). So these two rows
  now resolve with root-only history instead of rejecting. That degrade is the
  intended new behavior (commit message: "degrade a failed child read to root
  history with one aggregated warning").

### Decision: split the test by failure path; no implementation change

The degrade happens only in the descendant-listing path, never in the root
read path, so no real bug is hidden. The spec now asserts both paths
explicitly:

- Lines 330-337: `conflict`, `duplicateTurn`, `duplicateItem` keep the
  rejecting assertion, renamed to `fails explicitly on conflicting root
  history pages` (root read path must still reject with `malformedPage`).
- Lines 339-359: new `blankCursor`/`endless` rows in
  `keeps root history and warns after listing pages fail`: the snapshot
  resolves root-only (`['root']` with turns `['r1','r2']`), and the logger
  warns exactly once, with both archived listings recorded carrying the
  failure code as `reason` (`stalledCursor` / `pageLimitExceeded`),
  `completedLists: 0`, `failedLists: 2`, `partialListing: false`.

## Verification status

No local check was run (npm/nx/jest/lint/typecheck/build/verify are forbidden
for this lane; the coordinator runs them). Evidence above is from code and
fixture traces. Suggested coordinator command:

`npm run verify -- -t test -p codex-runtime` (expect "Running target test for
1 projects").

## Constraint compliance

- Only files under `libs/backend/codex-runtime/` touched; the concurrent
  rpc-handlers/chat/chat-streaming work was not touched.
- No pinned schema file edited; `tools/mcp-bench` untouched.
- Strict TypeScript: no `any`, no `ts-ignore`, no `as unknown as`; the only
  new typing is `Readonly<Partial<Record<string, readonly string[]>>>`.
- Injected logger only (the spec's existing `logger.warn` mock).
- No real Codex session data written; all fixtures are synthetic.