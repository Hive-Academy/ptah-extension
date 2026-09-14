# Code Logic Review — `TASK_2026_437_0778` Batch 14 (CI-regression fix)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 2        |

Scope: `libs/backend/persistence-sqlite/src/lib/slow-statement-timing.ts` (uncommitted diff,
`forwardingProxy` at `:265-300` plus its two call sites, `wrapStatement` `:308` and
`withSlowStatementTiming` `:392`) and the six new tests under "transparency to spies and
reassignment" in `slow-statement-timing.spec.ts:385-477`. Confirmed against the regression this
fixes by reading `libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts:377-401`
(`jest.spyOn(dbRef, 'prepare').mockImplementation(...)`, `dbRef = service.db`, the real
`withSlowStatementTiming`-wrapped connection). Did not re-run the full suite (instructed not to
run nx); ran the allowed single spec — see Verification below. Read the full base
`b14-code-logic-review.md` (including its already-closed "delta review") first so this review does
not repeat ground already covered there; it covers only the new `forwardingProxy` write-trap
behaviour.

## Verification

`npx jest -c libs/backend/persistence-sqlite/jest.config.ts slow-statement-timing.spec.ts
--maxWorkers=2` from `D:\projects\ptah-437`: 20/20 passed, matching the executor's claim. I also
built two standalone Node reproductions of the exact `forwardingProxy` trap logic (copied
verbatim, not the real better-sqlite3 binary — native module is ABI-mismatched in this environment,
`NODE_MODULE_VERSION 143` vs `137`, consistent with the base review's own note) to test two
scenarios the spec does not cover: a non-configurable/non-writable own data property, and a
writable:false/configurable:true own data property. Both are reported below as they reproduce
real bugs in the trap logic, not speculation.

## Five logic questions

### 1. How does this fail silently?

- **A failed write through the proxy still poisons the override flag**, permanently un-timing that
  member with no error, no log line, and no test coverage. `set` (`:283-286`) and `defineProperty`
  (`:288-291`) call `methods.delete(prop)` and `overridden.add(prop)` unconditionally, _before_
  checking whether `Reflect.set`/`Reflect.defineProperty` actually succeeded. `Reflect.set` returns
  `false` (does not throw) when the target property is non-writable; `Reflect.defineProperty`
  returns `false` when the descriptor change is rejected. In both cases the trap has already marked
  the member "overridden," so the next `get` (`:278`, `if (... || overridden.has(prop)) return
value`) returns the _real, unchanged, unwrapped_ value straight through — timing silently stops
  for that member for the rest of the proxy's lifetime, and the caller attempting the write sees
  only the correct `false`/no-op return, with nothing indicating the wrapper's internal state also
  changed. Reproduced standalone (not in this codebase's test suite):
  ```
  real.run defined { writable: false, configurable: true }
  proxy.run()                       -> "TIMED:raw-run"
  Reflect.set(proxy, 'run', fn2)    -> false   (correctly rejected)
  real.run() unchanged              -> true
  proxy.run()                       -> "raw-run"   (BUG: timing silently dropped)
  ```
  This is a genuine silent-failure path even though it requires an unusual precondition (a write
  attempt against a non-writable member) that nothing in the current codebase triggers today —
  see Q3/Failure modes.

### 2. What user action produces unexpected behaviour?

- None found in the normal spy/restore/reassign flows the spec exercises. `jest.spyOn(dbRef,
'prepare')` on the inherited-method path (the actual regression) is fixed correctly: `set` fires
  once to install the mock, `deleteProperty` fires once on `mockRestore()` (verified this is how
  Jest restores a spy on an _inherited_ member — I confirmed empirically with the real `jest-mock`
  `ModuleMocker` against the exact trap logic: `hasOwnProperty` is `false` before spying, `true`
  while spied, `false` again after `mockRestore()`, and the member re-wraps and resumes timing).
  This matches `slow-statement-timing.spec.ts:419-437` and is correct.
- One subtler case the spec does not exercise: spying on a member that is already an **own**
  property of the target (not inherited) restores via **reassignment**, not `deleteProperty` — this
  is exactly what the review brief flagged as worth checking. I verified with the real `jest-mock`
  package: in this case `overridden` for that prop is never cleared (stays `true` after
  `mockRestore()`), yet the observed behaviour is still correct — Jest's `spyOn` captures the
  "original" by reading the property _through the proxy_ before installing the mock, so what it
  captures is already the wrapped forwarder (from the `get` trap's cache), and restoring
  reassigns that same wrapped forwarder back onto `real`. Because the member is still marked
  "overridden," the `get` trap returns it verbatim (no re-wrap) — but since the stored value is
  already a working timed closure, calls stay timed. This is correct today, but it is an emergent
  property of Jest's specific "capture via read, restore via write" implementation, not something
  this code guarantees; a different mocking library, or a future Jest version that captures the
  original via `Object.getOwnPropertyDescriptor` directly on the target instead of reading through
  the proxy, would silently break this. No user-facing symptom currently reproduces, so this is
  informational rather than a finding to fix now.

### 3. What input data produces a wrong answer, not an error?

- The Q1 finding is the concrete instance: a rejected write (not any thrown error) produces the
  "wrong answer" of a silently un-timed member going forward. It requires a non-writable member on
  the wrapped `db`/`statement`. I could not check the real better-sqlite3 binary in this environment
  (ABI mismatch, matching the base review's own caveat), but by construction better-sqlite3's
  `run`/`get`/`all`/`prepare`/`exec`/`pragma`/`transaction`/`iterate` are defined on
  `Database.prototype`/`Statement.prototype`, not as own instance properties, so a `jest.spyOn`
  targeting them installs an _own_, writable, configurable property on the instance (this is exactly
  what the existing spec exercises and what makes `deleteProperty`-based restore work) — the
  non-writable/non-configurable precondition for the Q1 bug does not appear to arise from any
  current call site in this codebase. This is a real logic defect in the trap, not presently
  reachable through known production or test code.

### 4. What happens when a dependency fails?

- Unaffected by this fix beyond what the base review already covered (`loadExtension`,
  open-failure, migration-runner paths are all forwarded generically via
  `method.bind(db)`/`Reflect.apply`, `:392-417`, unchanged by this diff).

### 5. What is missing that the requirements never mentioned?

- A get-trap Proxy invariant risk: if `target` (real `db`/`statement`) ever carries an **own**,
  non-configurable **and** non-writable data property whose value is a function, the `get` trap
  (`:272-282`) throws a hard `TypeError` on the very first read — it caches and returns a _different_
  function reference (the forwarder) than the real one, which V8 rejects for that specific
  combination of invariants. Reproduced standalone:
  ```
  TypeError: 'get' on proxy: property 'run' is a read-only and non-configurable data
  property on the proxy target but the proxy did not return its actual value ...
  ```
  This is not a regression from this diff (the pre-existing `wrapStatement`/`withSlowStatementTiming`
  proxies had the identical `get` trap shape before this refactor — `forwardingProxy` only
  generalised it and added the write traps), so it is not something this fix introduced, but the
  fix's own doc comment (`:250-264`) makes strong claims about transparency without mentioning this
  edge. I did not find any own, non-configurable+non-writable function property on better-sqlite3's
  `Database`/`Statement` instances in public documentation or in this repo's own structural port
  (`sqlite-connection.service.ts:44-60` — only method _names_, no descriptor requirements), and the
  repo's own fakes (`testing/fake-sqlite-database.ts`) use plain writable/configurable class methods,
  so nothing currently trips this. Flagged as residual uncertainty, same category as the base
  review's un-verified-against-real-binary caveat, not as a new blocking defect.
- No spec exercises: a rejected `set`/`defineProperty` (Q1), an own-property spy/restore round
  trip (Q2), or `defineProperty`-based spying (Jest uses this path when spying on an accessor with
  `{ getter: true }`, e.g. hypothetically `jest.spyOn(db, 'open', 'get')` — not used today but the
  `defineProperty` trap exists specifically to support it and has no test).

## Failure modes

### Poisoned override flag after a rejected write

- Trigger: any write through the proxy (`jest.spyOn`, `defineProperty`, plain assignment) that
  `Reflect.set`/`Reflect.defineProperty` rejects (returns `false`) rather than throwing — e.g. a
  non-writable member.
- Symptom: the write correctly reports failure/no-op to the caller, but the targeted member is
  permanently treated as "overridden" from then on: reads return the raw, unwrapped value and
  timing/rate-limiting silently stops for that member, with no log line anywhere.
- Evidence: `slow-statement-timing.ts:283-291` (`set`/`defineProperty` mutate `methods`/`overridden`
  before consulting the `Reflect.*` return value); reproduced live outside the repo's test suite
  (see Verification).
- Current handling: none — state is mutated unconditionally.
- Recommendation: only mutate `methods`/`overridden` when the underlying `Reflect.set`/
  `Reflect.defineProperty` call returns `true`, e.g.:
  ```ts
  set(real, prop, value) {
    const ok = Reflect.set(real, prop, value);
    if (ok) { methods.delete(prop); overridden.add(prop); }
    return ok;
  },
  ```
  (same pattern for `defineProperty`). Add a spec for a non-writable member to pin it.

### Get-trap Proxy-invariant crash on a hypothetical non-configurable/non-writable function member

- Trigger: `target` (the real `db`/`statement`) gaining an own, non-configurable, non-writable data
  property whose value is a function.
- Symptom: the very first `get` of that property throws `TypeError: 'get' on proxy: ... but the
proxy did not return its actual value`, crashing whatever code read the property (not the
  intended "never alters exceptions" contract — this is the _wrapper itself_ throwing, not a
  forwarded native exception).
- Evidence: reproduced standalone against the exact `forwardingProxy` `get` trap (see Verification);
  not observed against the real better-sqlite3 binary (ABI mismatch in this environment blocks that
  check, same limitation the base review already recorded).
- Current handling: none; not new to this diff (pre-existing shape), not currently reachable by
  anything in this repo's fakes or the real better-sqlite3 API surface as documented.
- Recommendation: no code change required unless/until such a property is shown to exist; worth a
  one-line doc-comment caveat next to `forwardingProxy`'s existing transparency claims, and — if
  the team ever gets a working native build in CI — a quick `Object.getOwnPropertyDescriptors`
  dump of a real `Database`/`Statement` instance to close this out definitively.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: `set`/`defineProperty` traps mutate `methods`/`overridden` unconditionally before
  checking the reflected operation's success — `slow-statement-timing.ts:283-291` (see Failure
  modes). Not reachable by current codebase usage but a real defect in the general contract the
  doc comment (`:254-264`) claims.
- Moderate: the six new "transparency to spies and reassignment" tests cover the regression's exact
  shape (inherited-method spy + `mockRestore`, pass-through spy, statement-method spy, plain
  reassignment) but not: a rejected write, an own-property spy/restore cycle, or
  `defineProperty`-based spying — `slow-statement-timing.spec.ts:385-477`.
- Minor: the `forwardingProxy` doc comment (`:254-264`) asserts general transparency to "a member
  assigned, defined or deleted through the proxy" without qualifying that a _rejected_ assignment
  silently degrades rather than staying transparent — worth a one-line caveat once the Q1 fix lands,
  or now if the fix is deferred.

## Data flow

1. `withSlowStatementTiming(db, options)` builds one `SlowStatementReporter` and returns
   `forwardingProxy(db, wrap)` — OK, unchanged from the base review's already-verified flow.
2. `wrapStatement` builds a second `forwardingProxy(statement, wrap)` per `prepare()` call — OK,
   unchanged logic, just now expressed through the shared helper (confirmed byte-identical
   `run`/`get`/`all`/`iterate`/chaining branches against the pre-refactor version via `git diff`).
3. Normal reads (`db.prepare`, `stmt.run`, etc.): `get` trap caches a forwarder per member on first
   read, `overridden` empty — OK, matches "two clock reads per fast call" spec.
4. A `jest.spyOn(db, 'prepare')` on the inherited case: `set` trap fires, clears cache, marks
   overridden, real gains an own `prepare` — OK, this is the fixed regression, pinned by spec and
   by the standalone `jest-mock` reproduction in this review.
5. `spy.mockRestore()` on that inherited case: Jest's own restore logic issues a `deleteProperty`
   (confirmed empirically, not just read from the code comment) — `deleteProperty` trap clears
   `overridden` and the cache, next `get` re-wraps the inherited method — OK.
6. A write that `Reflect.set`/`Reflect.defineProperty` _rejects_: trap still mutates
   `methods`/`overridden` — GAP, see Failure modes. Not on any path exercised by steps 3-5 or by
   anything in this repository today.

## Requirements fulfilment

| Requirement                                                                                             | Status   | Gap                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fix `code-symbol.store.spec.ts:387` regression (`jest.spyOn(service.db, 'prepare').mockImplementation`) | COMPLETE | none — traced the exact call site, confirmed `prepare` is inherited, confirmed `set`→install and `deleteProperty`→restore both work via standalone `jest-mock` reproduction and the passing spec |
| Stay transparent to spies/reassignment without regressing "forward bound to real object" contract       | PARTIAL  | write traps unconditionally mutate internal state even when the reflected write is rejected (Q1/Failure modes) — narrow, currently-unreachable gap in the general contract                       |
| No behavioural change to timed calls, chaining, iterate(), transactions                                 | COMPLETE | confirmed byte-identical logic moved into the shared `wrap` callbacks                                                                                                                            |

Implicit requirements not addressed: none blocking; the get-trap Proxy-invariant edge case (Q5) is
inherited from before this fix and out of this fix's actual scope.

## Edge cases

| Case                                                                     | Handled | How                                                                                                               | Concern                                                                              |
| ------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Spy on inherited method (`db.prepare`), call through, restore            | YES     | `set`→`deleteProperty` round trip, spec-pinned                                                                    | none                                                                                 |
| Spy on statement method (`stmt.run`)                                     | YES     | same mechanism, spec-pinned (`:453-465`)                                                                          | none                                                                                 |
| Pass-through spy (`jest.spyOn(db, 'exec')` without `mockImplementation`) | YES     | spec-pinned (`:439-451`)                                                                                          | none                                                                                 |
| Plain reassigned member (non-Jest)                                       | YES     | spec-pinned (`:467-476`)                                                                                          | none                                                                                 |
| Rejected write (non-writable member)                                     | NO      | none                                                                                                              | silently un-times the member going forward (Moderate, not currently reachable)       |
| Own-property spy/restore (not inherited)                                 | PARTIAL | works today, but relies on Jest's internal "capture via read" behaviour rather than anything this code guarantees | fragile, undocumented, untested                                                      |
| `defineProperty`-based spying (accessor spies)                           | NO      | trap exists, unexercised                                                                                          | untested, not currently used in this repo                                            |
| Non-configurable/non-writable function member on real `db`/`statement`   | UNKNOWN | would crash `get` on first read                                                                                   | unverifiable in this environment (ABI mismatch); not shown to exist on the real type |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM
- Top risk: the `set`/`defineProperty` traps mutate `methods`/`overridden` before checking whether
  the reflected write actually succeeded, so a rejected write permanently and silently disables
  timing for that member — real, reproduced, but not currently reachable by any call site in this
  codebase, so it does not block landing the regression fix itself.
- What a robust implementation would add: (1) guard `set`/`defineProperty` on the `Reflect.*`
  return value before mutating `methods`/`overridden`, with a spec pinning a non-writable member;
  (2) a spec for an own-property spy/restore cycle, since today's correctness there depends on an
  unstated Jest implementation detail; (3) a one-line doc caveat (or a follow-up ticket) noting the
  get-trap's Proxy-invariant precondition is unverified against the real better-sqlite3 binary in
  this environment, consistent with the base review's own residual-uncertainty note.

---

## Delta review (follow-up to Moderate 1)

Scope: only the `slow-statement-timing.ts` change addressing the "poisoned override flag on a
rejected write" finding above — `set` (`:318-322`), `defineProperty` (`:324-336`), `deleteProperty`
(`:337-344`), the new `sources` `WeakMap` (`:276`), `ownForwarder` (`:279-288`) and `afterWrite`
(`:291-302`) — plus the two new specs, "restores timing after a spy on an OWN function member is
restored by assignment" (`:467-494`) and "leaves timing intact when the target rejects a write"
(`:496-517`). Read the current file at `D:\projects\ptah-437`, not a diff. Ran the allowed command:
`npx jest -c libs/backend/persistence-sqlite/jest.config.ts slow-statement-timing.spec.ts
--maxWorkers=2` → 21/21 passed.

### 1. Reflect-first, mutate-on-success (Moderate 1 itself)

Confirmed fixed as described. `set` and `defineProperty` now call `Reflect.set`/
`Reflect.defineProperty` first and only call `afterWrite` — the sole place that touches
`methods`/`overridden` — when the reflected call returned `true` (`:318-322`, `:324-336`).
`deleteProperty` is expressed the same way for consistency (`:337-344`). The new "leaves timing
intact when the target rejects a write" spec (`:496-517`) uses a genuine rejected write
(`writable: false` own `exec`, plain assignment that throws `TypeError` under strict mode) and
asserts `db.exec` is still the _same_ cached timed forwarder (`toBe(timedExec)`, `:509`) and still
times the next call (`:513-516`). This closes Moderate 1 exactly as recommended, with a real
rejected write, not a mocked `Reflect.set`.

### 2. Own-property restore writes the original method, not the wrapper — is that observable?

Traced `ownForwarder`/`afterWrite` against real Jest semantics, not just the spec. `sources` records
`{prop, method}` only for forwarders _this proxy_ built (closure-local `WeakMap`, one per
`forwardingProxy` call — see item 4), so `ownForwarder(prop, value)` only matches when `value` is
literally a forwarder this same proxy handed out for this same `prop`. When it matches, `set`/
`defineProperty` write `restored.method` — the original raw function, never the wrapper — onto
`real`, and `afterWrite` re-caches the _same_ forwarder object without rebuilding it, so identity is
preserved.

Does this ever turn a previously-_inherited_ member into a new _own_ one where none existed? In the
scenario Jest actually produces, no: Jest's own `spyOn`/`mockRestore` branches on
`Object.prototype.hasOwnProperty.call(object, methodName)` _before_ installing the spy, and restores
an originally-inherited member via `deleteProperty` (confirmed empirically against the real
`jest-mock` package in the base review, unchanged here — `mockRestore` on `db.prepare`, inherited
from `Database.prototype`, still goes through `deleteProperty`, not `set`). The `ownForwarder`
"write original back" path is only reached when Jest _reassigns_, which per Jest's own logic only
happens when the member was already own _before_ spying — exactly what the new spec constructs
(`Object.defineProperty(real, 'pragma', {..., writable: true, configurable: true, enumerable:
true})` at `:471-476`, _before_ `jest.spyOn`). In that case the member is own both before and after,
with the identical descriptor shape restored — no observable own/inherited transition through
Jest's real usage pattern.

There is one narrow, untested path where a transition _could_ happen: `ownForwarder` only checks
"is this value a forwarder this proxy built for this prop," not "was this prop own already." A
hand-written monkeypatch that reads an inherited member and writes the same forwarder straight back
(`const f = db.prepare; db.prepare = f;`, no mocking library involved) would take this branch and
create a genuine **new own property** on `real` holding the _raw_ `Database.prototype.prepare`
function, where before there was no own property at all. Functionally harmless for better-sqlite3:
the value written is the exact same function object as the prototype method, and every call path
(`Reflect.apply(method, real, args)` inside forwarders, or a direct `real.prepare(...)`) uses `real`
as the receiver regardless of where in the prototype chain the property is found, so the brand check
and `this` binding are unaffected. The one real difference is enumerability/discoverability:
`Reflect.set` creates a new own property with default attributes (`writable: true, enumerable:
true, configurable: true`), so `Object.keys(real)` / `for...in real` / `Object.getOwnPropertyNames`
would newly include `prepare` where they previously did not (native prototype methods are typically
non-enumerable). Not exercised by Jest's actual restore mechanism, not covered by any spec; a
theoretical corner of the generic "assign a member's own forwarder back" contract the doc comment
now states in general terms (`:260-264`), reachable only by a direct, non-Jest read-then-reassign of
an inherited member. Minor — no functional break, only an enumeration-shape difference in a
scenario nothing in this repository currently constructs.

### 3. `defineProperty` with an accessor descriptor

Correct. `restored` is only computed when `'value' in descriptor` (`:325-328`); an accessor
descriptor (`{ get, set }`, no `value`) always yields `restored === undefined`, taking the plain
`Reflect.defineProperty(real, prop, descriptor)` path unchanged and, on success, recorded as an
ordinary override (`afterWrite(prop, undefined)`) — same behaviour as before this delta. No attempt
is made to run `ownForwarder` against a `get`/`set` descriptor's functions, so there is no risk of
misidentifying an accessor's getter/setter as "the forwarder for this prop." Untested by any spec
(no spec installs an accessor descriptor through either proxy), but the code path is a strict subset
of the pre-delta `defineProperty` behavior, not new logic — a coverage gap, not a defect.

### 4. `WeakMap` scope and leakage

`sources` is declared inside `forwardingProxy` (`:276`), so each call — once per `db` wrap and once
per `prepare()`-returned statement wrap (`wrapStatement`, `:355`) — gets its own fresh `WeakMap`
with no cross-instance sharing. Entries are added only when the `get` trap builds a brand-new
forwarder (`:312-316`); they are never explicitly deleted, but since the map is keyed by the
forwarder function object itself, an entry becomes unreachable (and GC-eligible) the moment nothing
— not `methods`, not a caller's own captured reference, not Jest's internal spy state — still holds
that specific forwarder. Bounded by "number of distinct forwarders this proxy has ever produced for
its own props," which is bounded by the fixed method set (`run`/`get`/`all`/`iterate`/`prepare`/
`exec`/`pragma`/`transaction`, etc.) — no unbounded growth, no leak beyond what the pre-existing
`methods` cache already retains for the proxy's own lifetime.

### 5. Cross-proxy forwarder confusion

Not reachable. `ownForwarder` looks up `value` only in _this_ proxy's own `sources` WeakMap
(`:284`); a forwarder built by a different `forwardingProxy` call (a different prepared statement,
or the top-level `db` proxy) was registered only in _that_ call's own closure-local `sources` map —
the two maps share no keys structurally, so `sources.get(value)` on proxy B returns `undefined` for
a forwarder minted by proxy A, regardless of `prop` name collisions (e.g. assigning `stmt1.run`'s
forwarder onto `stmt2.run`). The `source.prop === prop` check (`:285`) is a second, redundant guard
against the narrower case of the _same_ proxy's forwarder for a _different_ prop being written back
(e.g. `db.prepare`'s forwarder assigned onto `db.exec`) — also correctly rejected, falling through
to the plain-override branch. No test constructs either scenario, but the mechanism (WeakMap
scoping plus explicit prop equality) rules both out by construction, not merely by test coverage.

### Delta verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Moderate 1 (poisoned override flag on a rejected write) is fixed as described and pinned by a
  real rejected-write spec, not a mock. No new defect was found in the fix itself.
- Residual, all Minor and none blocking: (a) a non-Jest, hand-written "read then reassign" of a
  genuinely _inherited_ member would create a new own, enumerable property where none existed
  before — harmless for better-sqlite3's brand checks but an enumeration-visible side effect,
  untested and not reachable through Jest's actual restore mechanism; (b) `defineProperty` with an
  accessor descriptor takes the correct, pre-existing code path but has no dedicated spec; (c)
  Moderate 2 from the base review (the `get`-trap Proxy-invariant crash on a hypothetical
  non-configurable+non-writable function property) is untouched by this delta and remains an
  open, unverifiable-in-this-environment residual, unrelated to Moderate 1.
