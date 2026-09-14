# Code Style Review — Batch 14 fix (`TASK_2026_437_0778`, C13 spy-transparency fix)

## Summary

| Metric          | Value                                      |
| --------------- | ------------------------------------------ |
| Overall score   | 9/10                                       |
| Assessment      | APPROVED                                   |
| Blocking issues | 0                                          |
| Serious issues  | 0                                          |
| Minor issues    | 1                                          |
| Files reviewed  | 2 (both diffed in full against `git diff`) |

Scope: `libs/backend/persistence-sqlite/src/lib/slow-statement-timing.ts` (new
`forwardingProxy` helper, `:265-300`, replacing the two near-identical `get` traps that
`wrapStatement` and `withSlowStatementTiming` each carried, plus new `set`/`defineProperty`/
`deleteProperty` traps, `:283-297`) and its spec (new `describe('transparency to spies and
reassignment', …)`, `:385-477`, 6 tests). This is a follow-up to the batch already reviewed
in `b14-code-style-review.md`; that review scored `slow-statement-timing.ts` 9/10 with 0B/0S/0M
and its one lib-level finding (CLAUDE.md missing the file from Internal Structure) is already
fixed — `persistence-sqlite/CLAUDE.md:36-42` now lists it. This review only covers the new
diff, not the whole file.

## Five style questions

### 1. What breaks in six months?

Nothing structural. The one gap is documentation reach: `persistence-sqlite/CLAUDE.md:36-42`
describes the wrapper's measurement contract ("results and exceptions pass through untouched,
… native methods are always called on the real object") but says nothing about the
spy/reassignment contract this diff adds — that `jest.spyOn(db, 'prepare')` now works and
`mockRestore()` un-wraps cleanly. A future engineer skimming the lib doc (rather than the
source JSDoc at `slow-statement-timing.ts:249-264`) has no signal that spying through the
proxy is now a supported, tested behaviour, and could reintroduce a workaround (e.g. grabbing
the raw connection to spy on) that the whole point of this fix was to make unnecessary.

### 2. What would a new team member misread?

Nothing in the diff itself — the `forwardingProxy` doc comment (`:249-264`) states the
contract precisely: cached-by-default, overridden set/defineProperty invalidates the cache
and marks the prop, deleteProperty clears the override so the next read re-wraps the
inherited method. A reader could momentarily wonder why `get`'s trap parameter is named
`real` while the outer function parameter is `target` (`:265` vs `:272`) — they are the same
object reference (a Proxy `get` trap's first argument is always the underlying target), and
`real` matches the file's own established vocabulary ("forwarded to the real object", `:13`).
Not a misread once traced, just a half-beat of naming friction.

### 3. What does this cost to maintain?

Low. The change is a pure refactor plus a genuine capability add (spy transparency), scoped
to one file. Duplication that existed before this diff — `wrapStatement` and
`withSlowStatementTiming` each carrying their own `get` trap with the same
cache-then-classify-then-wrap shape — is gone; both proxies are now built by one 36-line
generic (`:265-300`) parameterised only by the per-property `wrap` callback. That is a real
maintenance win: a future third proxy (there is none today, but the shape invites one) gets
the override/cache semantics for free instead of a third hand-copied `get` trap.

### 4. Where is this inconsistent with the rest of the repository?

One place: `persistence-sqlite/CLAUDE.md`'s wrapper description was already flagged in
`b14-code-style-review.md` as needing to stay in sync with the file's behaviour (that finding
was about the file being _listed_ at all, since fixed). This diff repeats the same category of
gap one level down — the file is listed, but the specific contract this diff adds isn't
reflected in the doc's prose. Every other guarantee the wrapper makes ("Measurement only",
"native methods called on the real object") _is_ in the CLAUDE.md; this one isn't yet.

### 5. What would you have done differently, and why is that better rather than merely other?

Add one clause to `persistence-sqlite/CLAUDE.md:36-42`, e.g. "a member reassigned through the
proxy (`jest.spyOn`, a test double) reads back as assigned, and `mockRestore()` restores timed
forwarding" — a one-line addition, no restructuring. That closes the exact gap the lib doc
otherwise leaves, using the same pattern the doc already uses for the other two contract
clauses, rather than leaving the newest and most test-heavy guarantee documented only in
source JSDoc.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `libs/backend/persistence-sqlite/CLAUDE.md:36-42` documents `slow-statement-timing.ts`'s
  measurement contract but not the spy/reassignment contract this diff adds and covers with
  6 new tests (`slow-statement-timing.spec.ts:385-477`). Low cost to fix — one sentence — but
  it is the one contract clause of three that didn't make it into the lib doc alongside the
  other two.

## File-by-file

### `libs/backend/persistence-sqlite/src/lib/slow-statement-timing.ts`

Score 9/10 — 0B, 0S, 1M (attributed to the lib doc, not this file). `forwardingProxy`
(`:265-300`) is a precise extraction: it replaces two duplicated `get` traps
(`wrapStatement`'s and `withSlowStatementTiming`'s, previously ~30 lines of near-identical
cache/classify/wrap logic each) with one generic factory taking a per-property `wrap`
callback, typed without `any` (`AnyFn = (...args: unknown[]) => unknown`, `wrap: (prop:
PropertyKey, method: AnyFn, proxy: T) => AnyFn`). The new `set`/`defineProperty`/
`deleteProperty` traps correctly invalidate the per-property cache and track overrides in a
`Set`, and the `get` trap correctly special-cases live getters (`open`, `inTransaction`) and
overridden members (`:276-278`). No behaviour change for the two call sites that use it
(`wrapStatement:308`, `withSlowStatementTiming:392`) beyond the new spy/reassignment
transparency the doc comment (`:249-264`) claims. `npx eslint` and `npx prettier --check` are
both clean on this file.

### `libs/backend/persistence-sqlite/src/lib/slow-statement-timing.spec.ts`

Score 9/10 — 0B, 0S, 0M. The new `describe('transparency to spies and reassignment', …)`
block (`:385-477`) is nested exactly the way this lib's other specs group thematic test
blocks (`sqlite-connection.service.spec.ts:62,556,625` uses the same
`describe('X — Y', …)` / nested-`describe` shape), unlike the flat `it(...)` list the rest of
this file otherwise uses — consistent with sibling specs, not a drift. The 6 tests are
precise and non-redundant: forwarder identity/caching (`:386-393`), `jest.spyOn` hands back
the real mock and routes calls through it while the original stays timed (`:395-417`),
`mockRestore()` re-wraps the inherited method and confirms the own property is gone
(`:419-437`), a pass-through spy stays timed (`:439-451`), a spy on a _statement_ method (not
just the database) works the same way (`:453-465`), and a plain non-jest reassignment is
returned as assigned (`:467-476`). Reuses the existing `BrandedDatabase`/`BrandedStatement`
fixtures (`#private`-field brand-check hazard included) rather than inventing new doubles.
`npx eslint` and `npx prettier --check` are both clean.

## Pattern compliance

| Repository rule or nearby convention                                 | Status         | Evidence                                                                                  |
| -------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| Duplication removed when a shared shape is introduced                | PASS           | `slow-statement-timing.ts:265-300` replaces two ~30-line duplicated `get` traps           |
| No `any`; Proxy handler args typed precisely                         | PASS           | `slow-statement-timing.ts:79,265-267` (`AnyFn`, `wrap` signature)                         |
| File-size soft ceiling (700 lines, CLAUDE.md guideline)              | PASS           | `slow-statement-timing.ts` is 419 lines total, well under the ceiling                     |
| Spec nesting mirrors sibling specs in the same lib                   | PASS           | `slow-statement-timing.spec.ts:385` vs. `sqlite-connection.service.spec.ts:62,556,625`    |
| Lib CLAUDE.md "Internal Structure" kept in sync with file's contract | FAIL (partial) | `persistence-sqlite/CLAUDE.md:36-42` lists the file but omits the spy-transparency clause |
| `catch (error: unknown)`                                             | N/A            | no new catch blocks in this diff                                                          |
| Lint / format clean                                                  | PASS           | `npx eslint` and `npx prettier --check` both clean on both files                          |

## Maintenance debt

- Introduced: one generic `forwardingProxy` factory (36 lines) plus 4 traps
  (`get`/`set`/`defineProperty`/`deleteProperty`), 6 new tests (94 lines).
- Retired: two duplicated `get`-trap implementations (`wrapStatement`'s and
  `withSlowStatementTiming`'s), each doing the same cache/classify/wrap dance independently.
- Net: positive — real duplication removed, a real capability (spy transparency) added with
  proportionate test coverage, no size or boundary cost.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the lib's own CLAUDE.md doesn't yet state the
  spy/reassignment contract this diff adds and tests, the one place this fix's
  documentation trail stops short of source.
- What a 10/10 version would do differently: add the one-sentence spy/reassignment contract
  clause to `persistence-sqlite/CLAUDE.md:36-42` alongside the two contract clauses already
  there.
