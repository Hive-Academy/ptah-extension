# Code Logic Review — Batch 3 (`TASK_2026_533`)

Scope: `libs/frontend/marketplace/src/lib/data/server-ref.ts` (+ `.spec.ts`),
`libs/frontend/marketplace/src/lib/data/skill-ref.ts` (+ `.spec.ts`),
`libs/frontend/marketplace/src/lib/layout/marketplace-layout.ts` (+ `.spec.ts`).
Reviewed against implementation-plan.md D1 (`:91-127`, R6 `:773`) and D3
(`:166-181`), and batches.md Batch 3 (`:229-268`).

## Summary

| Metric              | Value                                                         |
| ------------------- | ------------------------------------------------------------- |
| Overall score       | 9/10                                                          |
| Assessment          | APPROVED                                                      |
| Blocking issues     | 0                                                             |
| Serious issues      | 0                                                             |
| Moderate issues     | 1                                                             |
| Minor issues        | 1                                                             |
| Failure modes found | 2 (both handled correctly; documented below for completeness) |

Verification run: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`
— lint, typecheck and all 16 suites / 411 tests green. `ptah_get_diagnostics`
scoped to the three files surfaces only pre-existing, unrelated errors in
`connected-surface.component.spec.ts`, `harness-health.store.spec.ts` and
`core`'s `mock-rpc-service.ts` (files this batch does not touch; `connected-surface`
is scheduled for deletion in a later batch per D4/D5). No TODO, stub or
placeholder text in any of the three files (grepped).

## Five logic questions

### 1. How does this fail silently?

Nowhere found. Both codecs are pure and total: every malformed input returns
`null` rather than a partial or guessed `ServerRef`/`SkillRef`, and the plan
requires the caller to render "Not found" on `null` (D1, C5 verification
seam) — there is no path where a bad ref produces a _plausible-looking_ ref.
`MarketplaceLayout.observe()` never throws and never leaves `tier()` in an
inconsistent state; the worst case is a stale-but-valid tier (see Moderate
finding below), not a wrong one silently presented as fresh.

### 2. What user action produces unexpected behaviour?

- A user who has a server key that legitimately contains a colon (e.g. a
  Smithery namespaced key `ns:server`) still round-trips correctly because
  decoding splits at the _first_ colon and the origin enum never contains one
  (`server-ref.ts:55-60`, exercised by `server-ref.spec.ts:53-61,17-38` including
  `smithery::` and `oauth:a:b`). No user-visible action regresses.
- A user resizing a VS Code panel or Electron window across 900px/1400px gets
  a tier flip with no hysteresis, by design (D3: "Selection lives in the
  URL, so a flip mid-drag re-renders the same detail in the other frame and
  loses nothing" — confirmed behaviourally by the A1 probe's round-trip test,
  `marketplace-layout.spec.ts:396-403`).

### 3. What input data produces a wrong answer?

None found for the codecs — see the prototype-pollution and malformed-input
handling below (Failure modes). For the layout, the only way to get a "wrong"
(non-representative) tier is the real-host fallback discussed under Moderate
issue #1: a host with no `ResizeObserver` that is later resized never updates
`tier()`. No currently supported runtime (VS Code webview, Electron, both
modern Chromium) lacks `ResizeObserver`, so this does not currently produce a
wrong answer for a user, only for a hypothetical future host.

### 4. What happens when a dependency fails?

`ResizeObserver` unavailable (jsdom, or hypothetically a very old host) is
the only "dependency" here, and it is handled: `observe()` seeds
`window.innerWidth` once instead (`marketplace-layout.ts:87-96`, covered by
`marketplace-layout.spec.ts:260-288`). `ResizeObserver` construction itself
cannot throw in any realistic browser; no other external dependency is
touched by these three files.

### 5. What is missing that the requirements never mentioned?

- No `resize` listener backs the no-`ResizeObserver` fallback (see Moderate
  finding #1) — the plan's pattern reference (`chat-view.component.ts:329-360`)
  has the same gap, so this is consistent with the codebase's existing
  precedent, not a new omission.
- Neither codec spec asserts that `encodeServerRef`/`encodeSkillRef` are
  themselves total for adversarial input (e.g. an origin/kind value not in
  the union, which TypeScript prevents at compile time but a caller using
  `as` could still produce) — acceptable, since the plan scopes totality to
  the _decode_ direction only ("a malformed ref decodes to null"), and encode
  is typed to only accept valid unions.

## Failure modes

### Malformed `:serverRef` / `:skillRef` (including prototype-chain keys)

- Trigger: any route segment that is missing, empty, has no colon, has an
  empty origin/kind or key/id, or names something that exists only on
  `Object.prototype` (`constructor`, `toString`, `__proto__`, etc.).
- Symptom (per plan): the page renders "Not found" with a link back.
- Evidence: `server-ref.ts:65-67` and `skill-ref.ts:70-72` both guard with
  `Object.prototype.hasOwnProperty.call(KNOWN_*, value)` rather than the `in`
  operator or a direct index lookup — this is the correct guard. `KNOWN_ORIGINS`/
  `KNOWN_KINDS` are plain object literals, so `'constructor' in KNOWN_ORIGINS`
  would be `true` (inherited from `Object.prototype`) and a naive `KNOWN_ORIGINS[value]`
  lookup would return the `Object` constructor function (truthy) for
  `value === 'constructor'`, both of which would have let a prototype-chain
  name masquerade as a known origin/kind. `hasOwnProperty.call` correctly
  returns `false` for these. Explicitly tested:
  `server-ref.spec.ts:74` (`'constructor:sentry'` → null) and
  `skill-ref.spec.ts:86` (`'toString:x'` → null).
- Current handling: correct — this is a defended case, not a live defect.
- Recommendation: none; flagged here only because the review brief asked for
  it explicitly.

### Zero-width / detached-host `ResizeObserver` reports

- Trigger: the observed element is temporarily detached, `display:none`, or
  mid-layout when the browser delivers a `ResizeObserverEntry` with a
  `contentRect.width` of 0 and a `clientWidth` of 0.
- Symptom without the guard: the layout would collapse to `compact` for a
  frame even though the element is actually wide, causing a visible flicker
  in the structural switch (table↔cards, drawer↔docked).
- Evidence: `marketplace-layout.ts:99-109` only calls `this._width.set(measured)`
  when `measured > 0`; a zero report is dropped and the previous width is
  kept. Tested at `marketplace-layout.spec.ts:212-220`.
- Current handling: correct.
- Recommendation: none.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### 1. (Moderate) No-`ResizeObserver` fallback is a one-shot value, not one-shot-then-tracked

- File: `libs/frontend/marketplace/src/lib/layout/marketplace-layout.ts:87-96`
- The `typeof ResizeObserver === 'undefined'` branch seeds `window.innerWidth`
  once inside `observe()` and returns; there is no `window.addEventListener('resize', …)`
  to keep it current. If a real host without `ResizeObserver` existed and the
  user resized its window after the marketplace mounted, `tier()` would never
  change again for that shell instance — a genuinely stale, one-shot value,
  not a periodically-refreshed fallback.
- Is this a real-host bug or acceptable jsdom-only behaviour? **Acceptable as
  implemented, but the code and its doc comment overstate the risk they
  guard against.** `ResizeObserver` has been supported in every Chromium
  release since M64 (2018); both the VS Code webview host and Electron
  (`electron-shell.component.ts:263`, cited by D3) are always on a modern
  embedded Chromium, so in this codebase's actual runtimes the fallback path
  is dead code that only ever executes under jsdom (tests) or a
  hypothetical, currently-nonexistent "very old host" the doc comment names.
  The plan's own pattern reference, `chat-view.component.ts:329-360`, has the
  identical gap (no `resize` listener in its fallback either), so this is
  consistent with existing precedent, not a new regression. Recommend (not
  blocking): drop the "very old hosts" justification from the doc comment
  since no supported host lacks `ResizeObserver`, or add the listener for
  genuine defense-in-depth — either is fine, and neither is required for this
  batch to be accepted.

### 2. (Minor) `observe()` can show a stale tier for one frame when re-pointed at a smaller element with a still-unlaid-out `clientWidth`

- File: `libs/frontend/marketplace/src/lib/layout/marketplace-layout.ts:79-97`
- When `observe(element)` is called a second time (e.g. the shell re-parents
  its host), the previous observer is disconnected and `_width` is only
  updated if `element.clientWidth > 0` at that instant. If the new element's
  layout has not been computed yet (`clientWidth === 0`), `_width` keeps the
  _previous_ element's value until the new `ResizeObserver`'s first
  asynchronous callback arrives (which the spec, per the ResizeObserver
  spec, fires shortly after `observe()` is called even with no size change).
  This is a sub-frame staleness window, not a persistent one, and is the
  same trade-off the "ignore zero-width reports" rule intentionally makes to
  avoid flicker. No test exercises the re-`observe()`-with-still-zero-width
  case specifically (the existing "disconnects the previous observer" test
  at `marketplace-layout.spec.ts:222-232` uses a zero-width element for
  _both_ elements and does not assert on `width()`/`tier()` afterward, only
  on which observer got disconnected). Not blocking — this scenario does not
  arise in the current usage (`observe()` is called once per shell mount per
  D3/D4), but worth a one-line test if `observe()` is ever called with a
  changing host at runtime.

## Data flow

1. Router activates a `:serverRef` or `:skillRef` segment → `decodeServerRef`/
   `decodeSkillRef` runs. OK — total, `null` on anything malformed.
2. A page renders `ServerDetailComponent`/`SkillDetailComponent` from the
   decoded ref, or "Not found" from `null`. OK (asserted by the plan's
   contract; the "Not found" page itself is out of this batch's scope).
3. Shell host element → `MarketplaceLayout.observe(host)` → initial
   `clientWidth` seeds `_width`, then `ResizeObserver` (or the
   `window.innerWidth` fallback) keeps it current. OK, with the caveats in
   Moderate #1/Minor #2 above, both non-blocking.
4. `tier()` (`computed` over `_width` through `marketplaceTierForWidth`) is
   read directly in templates (`@switch (layout.tier())`, per the A1 probe
   component at `marketplace-layout.spec.ts:306-326`). Angular 22
   (`package.json:93`) schedules change detection on a signal write that is
   read by a template-bound consumer independently of whether the write
   happened inside `NgZone` — this has been true since Angular's
   scheduler-based CD unification (well before v22), and the app is on
   `provideZoneChangeDetection({ eventCoalescing: true })`
   (`apps/ptah-extension-webview/src/app/app.config.ts:130`), which layers on
   top of, rather than replaces, that signal-driven scheduling. So the "no
   `NgZone.run`" choice documented in `marketplace-layout.ts:55-57` and
   pinned as a binding deviation in batches.md (`:47-49`) is sound for this
   Angular version, unlike the older `ngZone.run(...)` wrapping still used
   by the pattern reference `chat-view.component.ts:353`, which predates
   (or is simply more conservative than) that guarantee. I could not
   observe this in a real webview/Electron host from a static review —
   the A1 probe itself calls `harness.detectChanges()` explicitly after
   every `report()` (`marketplace-layout.spec.ts:378-381`), so it proves the
   _router-outlet re-activation_ behaviour (its stated purpose) but does
   not, and does not claim to, prove automatic (non-forced) CD scheduling
   from an out-of-zone signal write. That residual gap is inherent to
   jsdom/TestBed unit testing generally, not specific to this batch, and
   does not change the verdict.
5. Tier flip re-creates the `RouterOutlet` in a different `@switch` branch
   (A1). OK — verified by 5/5 passing probe assertions
   (`marketplace-layout.spec.ts:328-423`): first render in the compact
   branch, re-activation after compact→wide, a wide→regular→wide round
   trip, a _new_ selection made after the flip, and the empty-child case
   (no detail in either branch). These assertions match router-outlet
   identity, URL and rendered text, which is exactly what A1's plan-level
   concern requires (Batch redesign of C7 detail placement).

## Requirements fulfilment

| Requirement                                                                                          | Status               | Gap                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `serverRef` = `${origin}:${serverKey}`, split at first `:`, all origins round-trip                   | COMPLETE             | none                                                                                                                                       |
| Malformed `serverRef` → `null`, incl. prototype-chain keys                                           | COMPLETE             | none                                                                                                                                       |
| `skillRef` = `${kind}:${id}`, three kinds, external ids keep `:`/`/` in tail                         | COMPLETE             | none                                                                                                                                       |
| Skill kinds contain no `:`                                                                           | COMPLETE             | enforced by the literal union; no runtime assertion needed                                                                                 |
| R6 probe: single segment, percent-encoded `/`, decoded param equals input                            | COMPLETE             | 4/4 assertions pass (`skill-ref.spec.ts:148-238`); no base64url fallback needed                                                            |
| `marketplaceTierForWidth`: compact <900, regular 900–1399, wide ≥1400                                | COMPLETE             | boundary-inclusive test coverage at 899/899.5/900/1399/1400                                                                                |
| NaN / negative / Infinity → compact                                                                  | COMPLETE             | covered explicitly                                                                                                                         |
| Zero-width reports ignored                                                                           | COMPLETE             | covered explicitly                                                                                                                         |
| `ResizeObserver` lifecycle: second `observe()` disconnects the first; `disconnect()` on `DestroyRef` | COMPLETE             | covered explicitly, including idempotent `disconnect()`                                                                                    |
| `window.innerWidth` fallback without `ResizeObserver`                                                | PARTIAL              | one-shot, no live tracking after mount (Moderate #1); acceptable given current supported hosts                                             |
| A1 probe: outlet re-created in a `@switch` branch re-activates the child route                       | COMPLETE             | 5/5 assertions pass (`marketplace-layout.spec.ts:328-423`)                                                                                 |
| No `NgZone.run` for signal writes from the observer callback                                         | COMPLETE (by design) | sound for Angular 22's scheduler; not independently provable from a static review or the current unit tests, which force `detectChanges()` |

Implicit requirements not addressed: none found beyond the two moderate/minor
notes above.

## Edge cases

| Case                                                               | Handled | How                                                                                | Concern                                                  |
| ------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Key/id containing colons                                           | YES     | first-colon split, tested with `ns:server`, `a:b:c`, `trailing:`, `:leading`       | none                                                     |
| Origin/kind that is an `Object.prototype` member                   | YES     | `hasOwnProperty.call` guard                                                        | none                                                     |
| Empty string / `null` / `undefined` ref                            | YES     | `if (!raw) return null;`                                                           | none                                                     |
| Static source path mistaken for a ref (`smithery`, `ptah-plugins`) | YES     | no separator → `null`; R6 probe also proves no route collision at the router level | none                                                     |
| Width exactly at 900 / 1400                                        | YES     | inclusive/exclusive tested exactly as D3 specifies                                 | none                                                     |
| Negative / NaN / Infinity width                                    | YES     | `!Number.isFinite(width)` and `<` comparisons both cover it                        | none                                                     |
| Tier flip while a route child is active                            | YES     | A1 probe                                                                           | none                                                     |
| No `ResizeObserver`, element measurable                            | YES     | seeds from `clientWidth` first, window only if still 0                             | none                                                     |
| No `ResizeObserver`, host resizes after mount                      | NO      | not handled                                                                        | dead path on all currently supported hosts (Moderate #1) |
| `observe()` called twice, second element not yet laid out          | PARTIAL | old width kept until first async ResizeObserver callback                           | sub-frame staleness only (Minor #2)                      |

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: none blocking. The only residual uncertainty is whether Angular's
  scheduler-driven, zone-independent change detection (relied on to justify
  dropping `NgZone.run`) actually fires in the real VS Code webview/Electron
  hosts exactly as it does under forced `detectChanges()` in the unit tests —
  this is very likely correct for Angular 22 but was not, and could not be,
  proven by a static code review; it is worth a one-line note in the batch
  report so a later visual/integration pass (Batch 12, when the shell wires
  `MarketplaceLayout` for real) keeps an eye on it.
- What a robust implementation would add: a `resize` listener behind the
  no-`ResizeObserver` fallback for genuine defense-in-depth (currently
  dead code on every supported host, so optional); a regression test for
  `observe()` called twice with the second element's `clientWidth` still 0
  at call time.
