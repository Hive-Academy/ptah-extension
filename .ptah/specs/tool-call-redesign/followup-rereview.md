# Commit 48e2667e7 — logic rereview

**Score: 6/10. Verdict: REVISE.** The targeted fixes handle the earlier image/link and internal line-break examples, but a fenced-code language tag can still hide the only visible error words. This is a narrow Markdown input, keeping the score above the 3–4 band; the silent error loss keeps it below 7–8.

## Earlier defects

1. **Markdown error visibility — not fixed completely.** `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:31,145-153` now retains the Error block for `<`, `&`, backslash, `[` and `]`. The image, link, entity and backslash specs at `tool-output-display.component.spec.ts:413-435` assert that the block contains the full message. A fence language tag still hides words; see defect 1 below.
2. **MCP line breaks — fixed for the stated rejection policy.** `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.ts:259,271-280` rejects CR, LF, U+2028 and U+2029 before splitting; `tool-target.utils.spec.ts:173-188` covers internal breaks. Strict equivalence with `/^mcp__(.+?)__(.+)$/` is impossible under that policy: for `mcp__a__b\n`, the old `$` matches before the final LF and captures `b`, while the new function returns `null`. This deliberate rejection is not counted as a defect.
3. **Palette verification — accepted.** A computed-style check in jsdom would not represent Angular's compiled `:host-context` styling. Deferring the light/dark palette check to a screenshot review is reasonable; no defect counted. The screenshot result is still unverified.

## New defect

1. **Blocking — a Markdown fence hides error words in its language tag.** `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:31,145-153`. For an errored `mcp__server__run` with both `toolOutput` and `error` equal to `~~~fatal-disk-full\nbody\n~~~`, `detectToolLanguage` selects Markdown because the output begins with a fence (`tool-language.utils.ts:90,133-139`). The guard sees none of its five characters, and `outputShowsError` suppresses the Error block. Marked renders `<pre><code class="language-fatal-disk-full">body\n</code></pre>`: `fatal-disk-full` is only a CSS class, so the user sees `body` and no error words. A backtick fence behaves the same way. **Fix:** retain the Error block for fenced Markdown whose error contains an info string, or base deduplication on visible rendered text. Add a DOM test that verifies `fatal-disk-full` is visibly present.

## Logic checks and evidence

1. **Silent failure:** defect 1 suppresses the Error block although the rendered output omits words of the error (`tool-output-display.component.ts:145-153`).
2. **User action:** opening a failed MCP result containing the fenced input above shows only the code body (`code-output.component.ts:139-141,227-233`).
3. **Wrong answer from input:** a final lone LF makes the new MCP splitter return `null` where the old regex captured `b`; the stated reject-all-line-breaks policy explains this difference (`tool-target.utils.ts:259,271-280`).
4. **Dependency failure or unexpected shape:** Markdown rendering can transform raw output into a shape with hidden text while raw-string equality remains true; defect 1 (`tool-output-display.component.ts:145-153`). No changed asynchronous dependency path was identified in the reviewed files.
5. **Missing requirement:** deduplication needs a visible-text criterion for Markdown fence info strings, not just a character guard (`tool-output-display.component.ts:31,145-153`; `tool-output-display.component.spec.ts:398-435`).

Verification: `npx nx test chat-ui --parallel=1` passed (68 suites, 1,329 tests). A direct Marked parse of the concrete fence produced the class-only language tag shown above. Scoped `ptah_get_diagnostics` reported no errors in the two reviewed source files and eight errors in sibling files. The reviewer role forbids git operations, so commit identity and diff could not be independently checked. Review scope was the checked-out implementations and their targeted specs.
