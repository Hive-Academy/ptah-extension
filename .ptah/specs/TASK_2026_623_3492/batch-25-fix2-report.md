# Batch 25 fix round 2 (spec-only) — decision #105 review, question 4

## Files changed

- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts` (spec only; no production code touched)

## Changes and what they prove

1. **Destroyed/remount case** (`a destroyed transcript never publishes; a remount and another tab publish only their own turns`):
   replaced `expect(published).toEqual(expect.arrayContaining(['tab-1:u9', 'tab-2:t2-u1']))` plus the `!includes(':u1')` filter with
   `expect(published).toEqual(['tab-1:u9', 'tab-2:t2-u1'])`.
   This asserts the complete `setSummaries` call log: exactly two calls, with those exact `(tabId, keys)` pairs, in mount order. Any extra
   transient write (a stale `tab-1:u1`, a cross-tab `tab-1:t2-u1`, a duplicate, or an empty-map write) now fails the test, which the
   previous `arrayContaining` allowed. The order is deterministic: both transcripts register their `.then` on the one pending promise in
   `detectChanges` order (`remounted` before `other`), and the publication effects run in the same `settle` order.

2. **New integration case** (`two transcripts share one pending load of the root loader and each publishes only its own tab`):
   mounts two summary-eligible transcripts (`tab-1` with `SUMMARY_MESSAGES`, `tab-2` with `t2-u1`/`t2-a1` running a jest command) against
   one `TRANSCRIPT_TURN_RECAP_LOADER` provided as `cachedTurnRecapLoader(underlying)` (the same cache function the token's root factory uses),
   with `underlying` held on a pending deferred. It proves:
   - `TestBed.inject(TRANSCRIPT_TURN_RECAP_LOADER)` is the shared loader instance;
   - the shared loader is called twice (once per transcript) while `underlying` is called exactly once (the second caller joined the attempt
     in flight);
   - nothing is published while the load is pending;
   - after resolution `underlying` is still called once, and the full `setSummaries` log is exactly `['tab-1:u1', 'tab-2:t2-u1']`, with the
     dock's final per-tab maps `['u1']` and `['t2-u1']` (distinct tab ids, no cross-tab keys).

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts .../chat-transcript.display.spec.ts .../chat-transcript.change-set.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{...}'`
  → `Test Suites: 2 passed, 2 total`; `Tests: 17 passed, 17 total`.
- `npx nx lint chat --parallel=1` → `Successfully ran target lint for project @ptah-extension/chat`; uncached re-run reports
  `34 problems (0 errors, 34 warnings)` (pre-existing warnings, none in the changed spec). Nx Cloud printed a plan-disabled notice, unrelated.

## Production code

No change needed; the strengthened assertions pass against the current `transcript-turn-summaries.ts` and `transcript-turn-recap-loader.ts`.
