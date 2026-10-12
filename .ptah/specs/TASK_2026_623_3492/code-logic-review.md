# Code Logic Review — Gate 3 fixes, `TASK_2026_623_3492`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 1              |
| Moderate issues     | 3              |
| Failure modes found | 6              |

Scope: full diff of the four changed units plus the new spec, `turn-tests.utils.ts` in full, `message-summary.utils.ts` in full, and the ptah-ui parser grammar (`libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts:120-175`). I ran nothing, per the memory-safe rule.

## Blocking

### B1. `summaryText('')` returns `'Display'`, so every message without text now gets the title "Display"

- File: `libs/frontend/chat/src/lib/utils/message-summary.utils.ts:51-60` and `:121`.
- `extractMessageSummary` now runs `summaryText(state.rawText)` unconditionally. When `state.rawText` is `''` (null root, tool-only turn, or an empty-text envelope), `prose.trim()` is falsy and `displayTitle` is undefined, so the function returns `'Display'`.
- Before the change `rawText` stayed `''` and the title fell to `'Assistant response'` (line 124).
- Impact: the collapsed header of every tool-only or no-text assistant message reads "Display". This is a silent wrong label on a very common path. The `description` branch is unaffected.
- The new spec has no empty-input or no-fence case, so it is not caught. No spec in the repo asserts `'Assistant response'` for this path (`compact-feed-rows.spec.ts` and the electron e2e `empty-assistant-envelope.spec.ts` should be checked by the author).
- Fix: return `text` unchanged when it contains no `ptah-ui` fence. For example, `if (!/```ptah-ui\b/i.test(text)) return text;` at the top. Only fall back to `Display` when a fence was actually removed. Add specs for `''`, plain prose and a null root.

## Serious

### S1. The title lookahead keyword list does not match the real grammar, so the body leaks into the header

- File: `message-summary.utils.ts:52-55`.
- Parser top-level words are `row col grid card section accordion stats table list chart note badge progress avatar` (`ptah-ui-parser.ts:148-172`).
- The lookahead lists `grid|card|section|stack|table|stat|avatar|text|input`.
  - It is missing `row`, `col`, `accordion`, `stats`, `list`, `chart`, `note`, `badge`, `progress`.
  - `stack`, `stat`, `text` and `input` are not parser elements. `\bstat\b` does not match `stats`, which is a very common first element after a title.
- Failure A: `title Release checklist stats ...` or `... chart ...` or `... note ...` captures the whole flattened body up to the end of the fence. The header becomes `Display: Release checklist stats | ...`, cut at 80 characters. This reintroduces the leak of transport syntax that the fix was meant to remove, and the only passing specs happen to use `grid`/`card`.
- Failure B: titles that contain a listed word are truncated. "Test table results" becomes "Test". "Text input audit" becomes an empty or partial capture.
- Failure C: when the closing fence follows the leaked body, only a trailing literal ``` is stripped (`.replace(/```$/, '')`). A nested or adjacent fence inside the capture is not handled.
- Impact: wrong preview on a likely path. The fallback is not `Display`, it is garbage.
- Fix: do not infer the title from the flattened text. Either read it from the unflattened `node.content` (the real grammar is line-based: `title <text>` on its own line, `ptah-ui-parser.ts:130-142`), or reuse the shared parser's title extraction. If the flattened string must be used, share the keyword list as a constant exported from the parser.

## Moderate

### M1. `# pass N` / `# fail 0` are matched anywhere in the output

- File: `turn-tests.utils.ts:56-72`.
- The pattern is anchored to a line start, so a markdown heading or a shell comment line `# fail 0` or `# pass 3` in a non-test command's output could flip the outcome.
- Impact is low because the path is gated by `classifyTestCommand` and by `isError` (`:151-156`). A false `passed` is only possible when `isError` is not true.
- Related: `ℹ cancelled N` with `fail 0` and `pass > 0` is reported `passed`. Node counts cancelled and timed-out tests separately from fail, and the process exits non-zero. If `isError` is not set, this is a false pass. Consider also requiring `cancelled 0` when that line is present.
- ANSI colour codes (a TTY-forced reporter) prefix the line and the `^[ \t]*` anchor will not match. The result is `unknown`, as before the change, so there is no regression.

### M2. Fence regex edge cases

- File: `message-summary.utils.ts:50`.
- `\b` after `ptah-ui` also matches `ptah-ui-foo` or `ptah-ui.x` and strips them.
- The `i` flag is looser than the parser, which is case-sensitive.
- An inline-code mention such as ```ptah-ui display``` in prose is stripped through the next ```.
- Prose around a removed fence leaves a double space (`'A  B'`). Titles and descriptions are not re-normalised after the replace.
- The title of only the first display fence is used. That is acceptable.

### M3. Spec coverage gaps

- `message-summary.utils.spec.ts` lacks: empty or no-fence input (would have caught B1), a title followed by `stats`/`list`/`chart`/`row` (S1), a title containing a keyword word, and two adjacent fences.
- `turn-tests.utils.spec.ts` lacks: a Jest failure output that also contains `# pass`, and `fail 0` with `cancelled > 0`. These are optional.

## Verified clean

- **Fraction matcher removal.** `outputOutcome` is module-private. The only other users of the utils are `turn-sources.utils.ts` and `index.ts`, which consume `collectTurnTests`. No other spec or code relied on the fraction form. The report's claim holds.
- **Jest output.** `Tests: N failed` and `Test Suites: N failed` still win first. Jest lines such as `FAIL path` do not match the `fail N` pattern. Mixed runner summaries correctly resolve to `failed` because any non-zero fail wins. The pass condition uses `some(fail === 0)`, so a second summary with `fail 2` has already returned `failed`.
- **`isError: true`** still short-circuits to `failed` (`:151`).
- **Old 'Live' label.** The only occurrences in the chat-ui ptah-ui and display-panel code are unrelated fixtures. `display-surface-sync.component.spec.ts:284` uses 'Live' as a stat label. No other spec or e2e asserts the chip badge. Doc comments in the chip component may still say "Live" (`ptah-ui-display-chip.component.ts` header around line 124 was updated in the diff, the rest is worth a grep).
- **Old 35%/50% mix.** No other spec or e2e references `--dp-text-mix` or the old values. `surface-renderer.component.ts:94,122` are the only two sites, both now use the constant. The default-theme and `anubis-light` branches are now identical, which makes the second declaration redundant (style point, not logic).

## Five logic questions

1. **Silent failure.** B1 (a wrong label with no error) and S1 (a leaked body presented as a title). Node `cancelled` runs can be reported as passed (M1).
2. **Unexpected user action.** A user whose message was tool-only now sees "Display" (B1). A streaming response with an unclosed fence is handled correctly.
3. **Wrong-answer input.** Display fences whose title is followed by `stats`, `list`, `chart`, `note`, `badge`, `progress`, `row`, `col` or `accordion`, or whose title contains `table`, `card`, `text` and the like (S1).
4. **Dependency failure.** Not applicable. The changes are pure functions and CSS.
5. **Missing.** An empty-input spec and a grammar-sharing mechanism between the parser and the summary.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH (B1 follows directly from the code. S1 follows from the grammar at `ptah-ui-parser.ts:148-172`.)
- Top risk: `summaryText` mislabels every no-text message as "Display" (B1).
- Robust version: skip stripping when no fence is present, take the title from unflattened content or from the shared parser, and add specs for empty input and the missing keywords.
- Score rationale: the contrast change, the chip label and the Node-runner matcher are sound (7-8 band). The summary change introduces a regression on a common path and has a half-correct title heuristic, which holds the overall score at 5.
