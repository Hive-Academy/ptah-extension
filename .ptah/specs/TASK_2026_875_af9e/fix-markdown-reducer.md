# Fix: markdown.reducer.spec.ts cost tests: TASK_2026_875_af9e

File changed: `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.spec.ts`,
only inside the `reduceMarkdown — cost on crafted input` describe, plus the `Tokenizer` import
on line 1. The reducer was not changed. `git diff --quiet` on the reducer passes after the
temporary proof edits were reverted.

## Root cause (file:line)

Line numbers below are from HEAD `18f2143e2`.

- `markdown.reducer.spec.ts:913` `MAX_CAP_MS = 1500` is an absolute wall-clock bound. The 16-level
  list costs about 460 ms on an idle machine and 2,092 ms on the loaded CI runner.
- `:864-874` `expectLinearTime`: when the test is over the bound, `:873` compares it with
  `LOAD_FACTOR (4) × fastestMs(referenceDocs.cap)`. That reference is a different document
  (`- x\nx\n`, `:846-852`), and it is timed after the test run, at another moment. CI load changed
  between the two measurements, so the ratio moved from 2.0x (idle) to 4.66x and failed
  (`Expected < 1797.27, Received 2092.43`, at `:941`).
- `:920-930` `timedReduce` takes the fastest of three runs, all from one burst. A burst that is
  slow for its whole length still fails.
- The same weakness is in the sibling tests: the crafted lines use 250 ms with the `small`
  reference, the size-cap document uses 250 ms, and the families use `MAX_CAP_MS` at `:976`.

What the tests protect against (from the reducer and the history in `466925a34` and `dc5f43b50`):

1. Regex backtracking over a long run. The crafted lines are 65,000 characters long. Spec comment:
   "a `(.*)$` after the run would backtrack through all 65,000 backticks (Batch 2a r3)". The risk
   sits in marked's block regexes and in the reducer's own guard regexes.
2. marked re-reading the rest of a block quote on each restart. In marked 18's `blockquote`
   tokenizer, every restart runs `lines.slice(i)`. A list or quote restart calls
   `this.list(newText)` or `this.blockquote(newText)` on all remaining lines. The reducer's
   `quoteRestartCost` / `MAX_QUOTE_RESTART_COST` guard (`markdown.reducer.ts:40-50, 131-166`)
   keeps those inputs from reaching the lexer.
3. Guards that skip the lexer: the container-prefix guard (`MAX_CONTAINER_PREFIX`) and the 256 KiB
   size cap. The tests already asserted these with a `blockTokens` spy, and those spies are kept.

## Change (summary + key hunks)

Each shape is now reduced at full size and at 1/8 of that size (`SCALE = 8`), and two growths per
character are bounded. A linear path grows about 1x per character, a quadratic path about 8x:

- **Deterministic counter.** `offeredChars` adds up the `src.length` of every call to
  `Lexer.prototype.blockTokens`, `Tokenizer.prototype.blockquote` and `Tokenizer.prototype.list`.
  These are marked's re-entrant block entry points, and the quote restart calls them again on the
  rest of the quote. The check is `growth < 1.5`. It is skipped when nothing is lexed (guarded
  paths), and the test then asserts that both sizes offer nothing.
- **Same-moment time ratio, for what no counter can see.** `timeGrowth` takes the fastest of 3
  interleaved samples of each size. One small sample reduces the small document `copies` (8)
  times, so both samples last about as long and share the machine load. Very fast paths repeat
  until a sample lasts at least `MIN_SAMPLE_MS = 10`. The check is `growth < 4`.
- `expectLinearCost` also asserts that both sizes take the same path: the same `reducer`, and for
  an unchanged result the same reason note.
- The crafted lines are now builders `(k) => string`, so the same shape can be built at
  `n / SCALE`.
- Size-cap test: the timing is replaced by `expect(lexed).not.toHaveBeenCalled()` (see D7).
- Families: the lexer-call count is taken before `expectValidResult`, so the validation's own
  lexing cannot change it.
- Removed: `LOAD_FACTOR`, `HARD_CEILING_MS`, `referenceDocs`, `fastestMs`, `expectLinearTime`,
  `MAX_CAP_MS` and `timedReduce`. No timeout was raised (still 120 s per test) and no retry was
  added.

Key hunk:

```ts
const SCALE = 8;
const MAX_OFFERED_GROWTH = 1.5;
const MAX_TIME_GROWTH = 4;
const ROUNDS = 3;
...
function expectLinearCost(small: string, large: string): void {
  const smallRun = offeredChars(small);
  const largeRun = offeredChars(large);
  expect(smallRun.result.reducer).toBe(largeRun.result.reducer);
  ...
  expect(smallRun.offered > 0).toBe(largeRun.offered > 0);
  if (smallRun.offered > 0) {
    const offeredGrowth =
      largeRun.offered / large.length / (smallRun.offered / small.length);
    expect(offeredGrowth).toBeLessThan(MAX_OFFERED_GROWTH);
  }
  expect(timeGrowth(small, large)).toBeLessThan(MAX_TIME_GROWTH);
}
```

## Why the new bound still catches the regression (numbers)

Calibration came from two runs with temporary logging (removed afterwards), on a 4-core machine
with load average 9-14.

| Shape | counter growth | time growth |
| --- | --- | --- |
| all 9 lexed crafted lines | 1.000-1.001 | 0.60-0.95 |
| 2 guarded crafted lines | n/a (0 offered) | 0.78-0.94 |
| 16-level list at cap | 1.000 | 1.06 |
| 6 unguarded families | 1.000 | 0.70-1.19 |
| 3 guarded families | n/a | 0.64-1.55 |

Worst linear value: 1.55, against a bound of 4 (2.6x headroom). A 5-round run under the same
load had a worst value of 1.17.

Regressions were injected temporarily and then reverted. The reducer is back to HEAD.

1. **Restart guard off.** Temporarily set `MAX_QUOTE_RESTART_COST = Infinity` and ran
   `expectLinearCost` on the guarded shapes:
   - `> - x\nx\n`, 4 KiB → 32 KiB: counter 1,065,438 → 67,243,998 chars, **growth 7.88**
     (bound 1.5; fails deterministically). Time growth 5.90 (bound 4; also fails).
   - `> x\nx\n`, 8 KiB → 64 KiB: counter 28,645 → 229,363, growth 1.000 (blind, as expected: its
     cost is `lines.slice` array copies inside the tokenizer). **Time growth 10.06** (fails).
   - A scratch run of marked alone confirms the shape: `> - x\nx\n` offered-char growth 7.94 at
     8 → 64 KiB. Every lexed linear shape gave exactly 1.000.
2. **Backtracking regex.** Temporarily changed the reducer's blank-line test to
   `/[ \t]*$/.test(line) && /^[ \t]*$/.test(line)`. This has the same meaning but is quadratic on a
   long run of spaces: 7.0 s for 65,000 spaces versus 0.15 s for 8,125. Results:
   - Counter growth 1.000 on all three affected crafted lines (blind, as expected).
   - Time growth **7.96 / 7.22 / 8.08** (bound 4) for `a fence, 65,000 spaces, then` `` `x ``,
     `65,000 spaces then x` and `65,000 spaces then a fence run`. All three fail.
   - The guarded `a list marker then 65,000 spaces` stayed at 0.90 (control: the guard returns
     first).

A false failure would need the growth to more than double the worst value measured under load.
The real regressions above produced 1.8-5x the bound. Load affects both sizes in each sample
alike, so a slower or busier machine changes both sides of the ratio together.

## Stability runs (each: command, result, duration)

The command was the same for every run:
`npm run verify -- -t test -p tool-output-reducers -- --skip-nx-cache --testPathPatterns=markdown.reducer`.
The `--skip-nx-cache` flag has to go after the first `--`; in `verify.mjs`'s own options it is
rejected with "Unknown option".

| Run | Result | Jest time | Wall | Load avg |
| --- | --- | --- | --- | --- |
| 1 | 123 passed / 123 | 34.1 s | 43 s | 4.7 |
| 2 | 123 passed / 123 | 29.8 s | 37 s | 4.8 |
| 3 | 123 passed / 123 | 37.6 s | 69 s | 5.1 |
| 4 | 123 passed / 123 | 36.4 s | 45 s | 5.4 |
| 5 | 123 passed / 123 | 46.7 s | 55 s | 6.5 |
| 6 (`--verbose`) | passed | 28.4 s | — | 3.2 |

Earlier runs of the same final logic (before the logging was removed) also passed: 39.6 s at
load 8.8, and 137 s at load 13.9 with `ROUNDS = 5` (since lowered to 3).

Baseline for comparison: the HEAD spec ran once in the same session and took 14.8 s (load 4.7).
The new suite takes about 2-2.5x longer.

`npm run verify -- -t lint,typecheck -p tool-output-reducers` passed: 2 of 2 tasks succeeded,
16.5 s.

## Decisions

These are recorded in `decisions.md`:

- **D6.** Counter plus a same-moment time ratio replace the absolute and different-moment bounds.
  The time check stays because regex backtracking and marked's line-array copies cannot be counted
  through any marked hook (proof numbers above). Reversible: test-only.
- **D7.** The size-cap test has no timing. Its path is O(1) (`markdown.reducer.ts:91-93`), so
  microsecond samples are jitter. A `blockTokens` spy shows that it never lexes.
- **D8.** The worktree had no `node_modules`, and `jest.preset.js:34-36` maps `marked` to
  `<worktree>/node_modules/marked/lib/marked.umd.js`. The suite failed with "Could not locate
  module marked". Added an untracked, git-ignored symlink
  `node_modules -> /home/amun/ptah-extension/node_modules`. Nothing tracked changed.

Other choices, all reversible:

- `SCALE = 8` rather than 4: 8x separates linear from quadratic better than 4x (√8 vs 2), and costs
  the same time, because small samples are equal-duration.
- `ROUNDS = 3`, the same count as the old `timedReduce`. At 5 rounds the suite took 137 s under
  load 14, for a gain in noise of only about 1.55 → 1.17.
- The counter covers only `blockTokens` / `blockquote` / `list`, not every tokenizer. The other
  tokenizers each receive the remaining `src`, so their sum is quadratic in the number of
  top-level tokens even for linear documents. That would make the counter wrong for many-section
  documents.

## Open items

- Runtime: this spec now takes about 30-47 s locally, against 14.8 s before. CI will be
  proportionally slower. The 16-level list test alone runs about 11 reductions at the cap, and
  took about 8.7 s in `timeGrowth` under load 13. If that is too much, lower `ROUNDS` to 2, or
  reuse the test body's reduction in `expectLinearCost`.
- Not touched, outside this describe: `markdown.reducer.spec.ts:372-379`
  (`returns input larger than 256 KiB unchanged, quickly`) still has an absolute
  `toBeLessThan(250)` around `reduce()`. It has not been seen to fail (the path is O(1)), but it is
  the same pattern.
- The `node_modules` symlink (D8) is environment state for this worktree only. Other worktrees
  without `node_modules` will hit the same `marked` mapping error in `jest.preset.js`.
- The HEAD spec has prettier drift outside this describe (lines 19-60 and others). lint-staged's
  `nx format:write` will reformat the whole file on commit. The rewritten describe is already
  prettier-clean.
