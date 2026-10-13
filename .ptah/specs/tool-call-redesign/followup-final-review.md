# Final logic review — commit cd05a54f9

**Score: 6/10. Verdict: REVISE.** The fence defect is fixed, but a preceding Markdown line can still hide an otherwise safe one-line error. This is a narrow input, which keeps the score above the significant-problems band; silently losing the error keeps it below the sound band.

## Fence defect status

**Fixed.** `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:33,148-156` now retains the Error block for both multiline fences and one-line backtick or tilde fences. The regression cases at `tool-output-display.component.spec.ts:415-440` cover `~~~`, closed and unclosed backtick fences, and assert that the block contains the full error. The ordinary one-line emphasis case still suppresses a duplicate and checks that its words remain in the output (`tool-output-display.component.spec.ts:398-411`).

## New defect

1. **Blocker — an earlier HTML comment opener hides a plain final error line.** `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:148-156`. For an errored `mcp__server__run` with `toolOutput: '# Log\n<!--\nfatal disk full'` and `error: 'fatal disk full'`, the heading makes `detectToolLanguage` select Markdown (`tool-language.utils.ts:87-93,133-139`). The error contains none of the guard characters, and `outputShowsError` accepts it as the final whole line (`tool-text.utils.ts:91-102`), so the separate Error block is suppressed. Marked parses the final words inside the unclosed HTML comment: its output is `<h1>Log</h1>\n<!--\nfatal disk full`; a DOM check found text nodes only for `Log` and a newline, with `fatal disk full` in a comment node. The user sees no error words. **Fix:** base suppression on visible rendered text, or conservatively retain the block when the entire Markdown output contains HTML syntax capable of hiding a later line. Add a component test for a safe one-line error after an unclosed comment, asserting visible error words.

## Logic questions

1. **Silent failure:** the raw suffix match suppresses the block although the renderer puts the error in a comment (`tool-output-display.component.ts:148-156`).
2. **User action:** opening the failed MCP result above shows the heading without the error words (`code-output.component.ts:139-142`; `tool-output-display.component.ts:148-156`).
3. **Wrong answer from input:** `# Log\n<!--\nfatal disk full` produces a false deduplication decision for `fatal disk full` (`tool-text.utils.ts:95-102`; `tool-output-display.component.ts:148-156`).
4. **Dependency shape:** Marked returns an HTML comment rather than visible text for the matched suffix; raw matching does not account for that rendering step (`code-output.component.ts:139-142`; `tool-output-display.component.ts:155-156`).
5. **Missing requirement:** deduplication must account for Markdown context before the matched line, not only characters in the error itself (`tool-output-display.component.ts:33,148-156`).

Verification: `npx nx test chat-ui --parallel=1` passed (68 suites, 1,337 tests). A direct Marked plus jsdom check confirmed the concrete comment-node case. Scoped diagnostics reported no errors in the reviewed component and spec; eight errors appeared in sibling files. The new specs cover the fence fix but not an earlier line that opens an HTML block (`tool-output-display.component.spec.ts:398-440`).
