# Closing logic review — Error-block hiding in `tool-output-display`

Score: **9/10** — Verdict: **APPROVED**

Scope: the `errorMessage` computed in
`libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:145-160`
and every rendering path it trusts (code-output fence, marked + extensions,
DOMPurify, clipping, surface gate). Read-only review; no source file was edited.

Evidence baseline: `npx nx test chat-ui --parallel=1` — 68 suites, 1343 tests,
all passed. The regression matrix in
`tool-output-display.component.spec.ts:398-524` already pins the earlier
rounds' fixes (image alt, fence info strings, unclosed fences, multi-line,
links, entities, escapes, HTML comments, `<b>`/`<script>`, ANSI, `.md` Read).

## Defects

**None found.** No input exists, in this rendering pipeline, where the Error
block is hidden and the error's words are invisible. The reasoning, so the
clean verdict is auditable:

The hide is reachable through exactly two paths.

1. Non-markdown output — `formattedOutput` wraps the plain output in a code
   fence (`code-output.component.ts:227-234`). `fenceCodeBlock`
   (`code-fence.ts:1-8`) counts the longest backtick run in the content and
   opens with one more backtick, so no inner line can close the fence
   (a closing fence must use the SAME character — CommonMark — so a content
   `~~~` line cannot close a backtick fence either, and the info string is a
   fixed language id with no backticks). The code renderer emits the content
   verbatim, escaped (`marked-extensions.ts:184-219`). Words are always
   visible, including a trailing error line after an embedded ``` line.
   Pinned by `code-fence.spec.ts` and `code-output.component.spec.ts:110-138`.

2. Markdown output, single line — the guard
   (`tool-output-display.component.ts:33,150-158`) allows hiding only when the
   whole trimmed plain output contains none of `\r \n < & \ [ ] ` ~` AND
   equals the error. Every construct that can hide words needs one of those
   characters (enumerated over the full CommonMark + GFM block and inline
   construct space): HTML `<`, entities `&`, backslash escapes `\`,
   links/images/footnotes/reference definitions `[ ]`, code spans and fences
   `` ` ``, strikethrough `~`, and any multi-line restructure (setext
   underline, tables, an earlier line opening a fence or comment) `\r\n`.
   The constructs left inside the guard all keep the words as DOM text (see
   Verified safe). The error carries the same characters as the output
   (hiding requires equality), so the guard also reads the error itself.

## Verified safe

1. **Blockquote `>` (unguarded).** `> Error words` falls to marked's default
   blockquote renderer (`marked-extensions.ts:76-80` returns `false` for
   non-callout quotes); the callout rewrite needs `[!TYPE]`
   (`marked-extensions.ts:28`), and `[` is guarded. Words render inside
   `<blockquote>`. Not a defect under the "words visible" rule.
2. **Heading, list, ordered list, emphasis/strong.** ATX headings
   (`marked-extensions.ts:257-279`), list cards
   (`marked-extensions.ts:292-316`) and `**…**` drop only markers; the words
   stay DOM text. Pinned end-to-end by
   `tool-output-display.component.spec.ts:398-411`
   (`**fatal**: build stopped` hides the block, `host.textContent` still
   holds the words).
3. **Thematic break `***` / `---` / `___`.** Renders through the `hr` override
   (`marked-extensions.ts:234-244`) with no text — but a line of only those
   characters equals an error with no words, so nothing can be hidden.
   `--- Error words` is not a thematic break; it renders as a paragraph.
4. **GFM bare autolinks `www.x.com`, `https://x`, `a@b.com`.** The anchor text
   is the URL itself; the file-link rewrite
   (`marked-extensions.ts:335-351`) keeps the link text, and DOMPurify's
   `ALLOWED_URI_REGEXP` (`provide-markdown-rendering.ts:281-283`) admits
   http/https/mailto. Words stay visible.
5. **Table header without separator (`| Error | words |`).** A GFM table needs
   the delimiter row; one line renders as a paragraph. `|` needs no guard.
6. **4-space indented code.** `stripSystemReminders` trims the plain output
   (`tool-text.utils.ts:16-20`), so a leading indent cannot reach the
   renderer; even if it did, the code renderer shows it verbatim.
7. **Fence break-out via embedded ``` in text output.** Prevented by
   `code-fence.ts:3-7` (longest-run + 1); tildes cannot close a backtick
   fence. Pinned by `code-output.component.spec.ts:110-138`.
8. **Clipped trailing error line ("Show full output").** The clip is CSS only
   (`code-output.component.ts:151-159`): `max-height` + `overflow-y: hidden`
   keeps the text in the DOM, and the toggle renders under
   `@if (collapsible())` (`code-output.component.ts:98-108,241-259`) with the
   same condition that enables the clip — so the toggle is always visible
   when clipping. Acceptable per the task's stated rule.
9. **15+ line fenced blocks inside `<details>`.** The wrapper carries `open`
   (`marked-extensions.ts:205-212`), `details`/`summary` survive the
   sanitizer (`provide-markdown-rendering.spec.ts:233-237`), and `open` is in
   DOMPurify's default attribute allowlist (verified in the installed
   `node_modules/dompurify/dist/purify.js`). Content renders expanded; the
   hidden `.code-block-toggle` (`tool-output-markdown.styles.ts:31-34`) only
   removes the generated collapse summary.
10. **Guard/display consistency.** Both sides call the same
    `toolOutputPlainText` (`tool-text.utils.ts:33-41`) and the same
    `detectToolLanguage` (`tool-language.utils.ts:133-164`), so no stripping,
    MCP-extraction (`tool-text.utils.ts:116-137`) or language-detection
    mismatch can separate the compared text from the displayed text.
    Retention truncation applies before both, in the safe direction.
11. **Surface gate (`surfaceMarkdown.pipe.ts:14-17`).** While a surface is
    inactive the markdown data can be empty or stale, but an inactive surface
    is not observable; activation flips the `active` input, the pure pipe
    re-runs and re-publishes the raw output in the same change-detection pass
    that makes the surface visible. No observable state hides the words.
12. **TodoWrite / Edit exclusion.** `tool-output-display.component.ts:154-156`
    blocks hiding for both tools. A malformed or retention-folded `toolInput`
    can defeat the type guards, but the fallback is the fenced CodeOutput
    path — words visible — so no invisible-words case results.
13. **Non-string / degenerate outputs** (`0`, `[]`, whitespace-only,
    `[{type:'text',text:''}]`): all collapse to an empty plain output, which
    fails `outputShowsError` (`tool-text.utils.ts:98-101`) and the Error
    block is shown. Safe direction.

## Remaining uncertainty

The renderer behaviour (marked v17 with the six repo extensions, DOMPurify
'full' preset) was verified by reading code and pinned specs, not by
rendering each candidate input in a live browser. The safety of items 1, 4 and
9 rests on current renderer/sanitiser behaviour rather than on construction —
that is why this is 9 and not 10. Two coverage notes (not defects):

- No spec pins a single-line `>` blockquote hide case
  (`tool-output-display.component.spec.ts:398-463` covers `**`, fences,
  links, entities, escapes, comments, headings — not `>`).
- No spec pins the `open` attribute on `<details>` surviving the full
  sanitiser; if a sanitiser update ever dropped `open`, long fenced outputs
  would render collapsed behind a `display: none` summary. One assertion in
  `provide-markdown-rendering.spec.ts` would close it.