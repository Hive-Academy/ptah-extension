# Commit 876f741c3 — behavioral follow-up review

**Score: 6/10. Verdict: REVISE.** The ordinary duplicate-error case is fixed and the refactors mostly preserve behavior, but the new Markdown guard can silently remove the only visible error message. This places the commit in the 5–6 band rather than 7–8; the affected path is a user-facing error, not a cosmetic edge.

## Defects

1. **Major — Markdown can hide the only visible error.** `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:140-147`. For an errored `mcp__server__run` with both `toolOutput` and `error` equal to `![fatal: disk full](https://example.com/icon.png)`, `looksLikeMarkdown` detects the link syntax, `HTML_LIKE_MARKUP` is false, and `outputShowsError` suppresses the Error block. Marked renders the string as `<img ... alt="fatal: disk full">`; with a successfully loaded image, the error text appears only in the non-visible `alt` attribute. A `.md` Read has the same path. Link syntax also removes the destination from visible text, and sanitization can remove unsafe destinations even when the label remains. **Fix:** decide deduplication from the rendered/sanitized visible text, or conservatively keep the Error block when the matched Markdown contains image/link syntax or other transformations that can hide error content. Add a DOM assertion for a visible error, not only an assertion that `[data-testid="tool-error"]` is absent.

2. **Minor — MCP splitting is not equivalent for line breaks.** `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.ts:270-276`. `splitMcpToolName('mcp__a__b\nc')` now returns `{server:'a', tool:'b\nc'}`; the old `/^mcp__(.+?)__(.+)$/` returned `null` because `.` excludes a newline. An external tool name with a line break can now enter the server/tool badge path and disturb the one-line header. **Fix:** reject `\r`, `\n`, U+2028, and U+2029 in both parts, or retain a non-backtracking split with the old dot semantics. Add a boundary test.

3. **Minor — the new palette test does not verify the palette is applied.** `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts:643-652`. The test scans the source string for a selector and one color. It passes if Angular drops or rewrites `:host-context(...) ::ng-deep` so the rule never matches; it also does not check precedence over the global Prism rules or a dark-theme computed color. **Fix:** add one rendered light/dark computed-style check in the existing component test environment if its stylesheet processing is representative, or capture this as a scoped visual verification gate. Keep the source assertion as a structural check only.

## Verified OK

- `describeToolChips` preserves the prior Read range first, Write line-count second, and remaining `Object.entries` order, including consumed `keys`; `tool-target.utils.ts:160-254` was compared against `876f741c3^`. Normal MCP names also split the same way.
- The revised Markdown signals use bounded line prefixes and delimiter-excluding inline spans; the table check accepts `---|---`, alignment colons, and CRLF after trimming (`tool-language.utils.ts:87-118`). The changed cases are consistent with Markdown indentation rules; no remaining super-linear regex was found in this set.
- The light palette is scoped to a light-theme ancestor and `.tool-output-markdown` (`tool-output-markdown.styles.ts:66-135`); ThemeService writes `data-theme-mode` on `<html>` for every theme (`libs/frontend/core/src/lib/services/theme.service.ts:185-195`). The selectors have greater specificity than Prism Tomorrow's token selectors; no dark selector was added. Actual compiled CSS behavior remains unverified by the new spec.
- `RegExp.exec` in `tool-text.utils.ts:109` is behavior-equivalent to the former non-global `String.match` call.
- Targeted verification: 4 changed chat-ui spec suites passed, 295 tests total, using the requested Jest command with coverage off and two workers. Scoped diagnostics found no errors in the five requested source files; it reported eight errors in unrelated sibling files.

## Five logic questions

1. **Silent success-looking failure:** defect 1 suppresses the Error block while the visible Markdown can omit the message.
2. **Unexpected user action:** opening a failed MCP result containing Markdown image syntax can show an image without the error sentence.
3. **Wrong answer from input:** a newline-bearing MCP tool name changes from unsplit to split; defect 2.
4. **Dependency failure or malformed shape:** if sanitization removes a URL or Markdown changes the visible output, raw-string equality still says the error is shown; defect 1. No changed async dependency or disposal path was found.
5. **Missing requirement:** the tests need to establish visible error content after Markdown rendering and computed light/dark token colors, not merely raw-input equality and source text.

## Decisions

- Preserve the deduplication for plain text and Markdown whose rendered visible content demonstrably contains the error. Tighten the guard for Markdown transformations; the current HTML-like test alone is insufficient.
- The newline split discrepancy is low impact in normal generated tool names but contradicts the requested all-input equivalence.
