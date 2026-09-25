# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION (requested verdict: REVISE) |
| Blocking issues | 3 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 3 distinct defects; 4 reproduced inputs |

Batch 2b requires revision. JSON has credible preservation guards, but Markdown can invert a heading's meaning, split a fenced block, and promote HTML-comment content into an apparent document heading. These are silent misleading outputs, hence blocking under the review severity definition. A 5–6 score would require the main preservation contract to hold on ordinary Markdown constructs; it does not. The implementation is above the 1–2 band because the JSON path and ordinary Markdown path are implemented and verified, rather than fundamentally absent.

Paths below are relative to the worktree. `reducers/` means `libs/backend/tool-output-reducers/src/lib/reducers/`.

## Five logic questions

### 1. How does this fail silently?

The setext parser retains only the last paragraph line (`reducers/markdown.reducer.ts:140`), so a negated instruction can become an affirmative heading. HTML-comment heading text is promoted by the unconditional ATX branch (`reducers/markdown.reducer.ts:132`). Both return `markdown-outline`, with no indication that the retained text has changed its structural meaning.

### 2. What user action produces unexpected behaviour?

Reducing a document with a fence opened on a list-item line, or a four-space-indented fence-like line inside code, produces incomplete code or loses a subsequent real heading (`reducers/markdown.reducer.ts:27`, `:114`, `:182`). See defect 2 for exact inputs and outputs.

### 3. What input data produces a wrong answer?

The multiline heading `DO NOT\ndelete production\n---` becomes `delete production\n---` at budget 1 (`reducers/markdown.reducer.ts:143`). JSON probes containing a backslash followed by a pipe, a trailing backslash, the string `null`, and an empty string inside an array remained distinguishable (`reducers/json.reducer.ts:225`, `:250`, `:257`). Empty object fields becoming missing cells is explicitly approved, not a defect.

### 4. What happens when a dependency fails?

Invalid JSON returns unchanged at `reducers/json.reducer.ts:44`; duplicate keys and non-round-tripping numbers return unchanged through `:71`, `:319`, and `:380`; recursive stack exhaustion returns unchanged at `:53`. Markdown has no catch around token counting (`reducers/markdown.reducer.ts:233`), so tokenizer failures propagate. The future pipeline is explicitly responsible for catching reducer failures (batches.md:476); that integration is outside this batch. Neither reducer opens resources or performs I/O.

### 5. What is missing that the requirements never mentioned?

HTML block context and container-aware fence parsing are not explicitly designed in the batch, yet affect the promised heading and fence preservation (`reducers/markdown.reducer.ts:112`). The existing fence test helper repeats the production whitespace rule (`reducers/markdown.reducer.spec.ts:35`), so it cannot independently detect the premature-close case. The approved empty-field removal also removes distinctions such as “no items” versus “not reported” (`reducers/json.reducer.ts:146`); that is a documented decision risk, not a requested revision.

## Failure modes / numbered defects

### 1. Multiline setext headings lose their qualifying text

- Severity: **blocking**.
- File: `reducers/markdown.reducer.ts:136`, `:140`, `:143`.
- Trigger / failing input: `# Intro\nDO NOT\ndelete production\n---\nbody`, with `budgetTokens: 1`.
- Observed output: `# Intro\ndelete production\n---\n(section text omitted, 2 lines)`.
- Current handling: only the final paragraph unit is moved into the heading; `DO NOT` remains removable body text.
- Impact: the reduced text reverses an instruction while presenting the surviving words as a complete heading. This violates “every ATX/setext heading kept in order with its level” (batches.md:367), even though individual retained lines remain verbatim. The implementation comment does not authorize weakening that requirement.
- Expected behaviour / fix: preserve the entire open paragraph as the setext heading, in original order, including all qualifying lines. Headings exceeding the budget must survive by the existing headings-only rule. Add a regression that checks the complete heading, not only its final line and underline.

### 2. Fence recognition ignores indentation and list containers

- Severity: **blocking**.
- File: `reducers/markdown.reducer.ts:27`, `:114`, `:160`, `:182`.
- Trigger / failing input A: `# Top\n` followed by lines ` ``` ` (three backticks, no surrounding spaces), `code`, four spaces plus three backticks, `# still code`, three backticks, `# Next`, then 30 lines of `body line more prose text`. Use `budgetTokens: 30`.
- Observed output A: `# Top\n` + three backticks + `\ncode\n    ` + three backticks + `\n# still code\n(32 lines omitted)`. The real closing fence and `# Next` are lost. Four-space-indented backticks cannot close this top-level CommonMark fence, so the emitted block is split mid-fence.
- Trigger / failing input B: lines `# Top`, `- ` plus three backticks, `  code`, two spaces plus three backticks, `# Next`, then the same 30 body lines. Use `budgetTokens: 30`.
- Observed output B: `# Top\n- ` + three backticks + `\n  code\n(code block, 32 lines, omitted)`. The real opener is emitted as ordinary body; its closer is treated as a new opener that consumes `# Next`.
- Current handling: `^\s*` permits arbitrary indentation for closes, while openers after a list marker are not recognized at all. The scanner has no container context.
- Impact: the model receives partial code as if it were safely outlined, and real headings disappear. This violates the explicit never-split-fences and keep-every-heading contracts (batches.md:367, :373).
- Expected behaviour / fix: recognize fence openers/closers relative to the containing list or quote and enforce the allowed fence indentation. Preserve the whole original block or omit it whole with the code-block note. A conservative unchanged fallback is preferable where the parser cannot confidently preserve structure. Add independent tests for both cases; the current helper at `reducers/markdown.reducer.spec.ts:35` shares the faulty regex.

### 3. HTML-comment text is promoted into visible headings

- Severity: **blocking**.
- File: `reducers/markdown.reducer.ts:112`, `:132`, `:395`.
- Trigger / failing input: lines `# Top`, `<!--`, `# NOT a heading`, `-->`, 30 lines of `body line more prose text`, `# Next`, `next`; `budgetTokens: 30`.
- Observed output: `# Top\n# NOT a heading\n# Next\n(section text omitted, 33 lines)`.
- Current handling: the parser recognizes ATX syntax without tracking HTML blocks; the comment delimiters become removable section body, while the comment's contents become mandatory headings.
- Impact: hidden/commented content becomes an apparent document instruction or section. Verbatim-line selection alone does not preserve meaning when its surrounding block delimiters disappear.
- Expected behaviour / fix: track HTML block/comment boundaries before recognizing headings; keep these blocks atomically, omit them with a note, or conservatively return the input unchanged. Add comment and raw HTML block cases proving embedded heading-shaped text is never promoted.

## Blocking issues

Defects 1–3 above are the three blocking issues. Each includes file:line evidence, a reproduced failing input, observed impact, and a concrete correction. They are independent: full setext preservation does not fix fences or HTML context.

## Serious issues

None additional substantiated.

## Moderate and minor issues

No additional shipping defect established. The tests' mirrored fence parser is recorded with defect 2 rather than counted twice.

## Data flow

1. **OK:** the barrel exports both reducers (`libs/backend/tool-output-reducers/src/index.ts:10`). Selection remains the Batch 2a hint-first detector (`libs/backend/tool-output-reducers/src/lib/content-detector.ts:71`). Pipeline wiring belongs to a later batch.
2. **OK:** JSON parses, checks parse losses, recursively prunes only object fields, and keeps array positions (`reducers/json.reducer.ts:45`, `:71`, `:136`). Null-prototype objects preserve `__proto__` as data (`:128`).
3. **OK within examined cases:** table eligibility uses at least three objects and common-key/union-key ratio >= 0.5 (`reducers/json.reducer.ts:190`). Extraction descends only through objects (`:171`); paths identify lifted tables (`:218`, `:309`).
4. **OK within examined cases:** JSON quotes ambiguous strings, escapes every cell pipe, emits separate rows, and falls back when output is not shorter (`reducers/json.reducer.ts:91`, `:222`, `:266`).
5. **GAP:** Markdown splits into sections before budgeting, but loses multiline heading context and lacks sufficient block context (`reducers/markdown.reducer.ts:98`). Defects 1–3 originate here.
6. **OK within examined cases:** round-robin selection stops a section whose first line cannot fit while continuing other sections (`reducers/markdown.reducer.ts:305`, `:324`). Rendering preserves selected line text, uses omission notes, and falls back when no input lines survive (`:353`, `:379`). This does not repair incorrect block classification.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| JSON invalid/scalar/empty-result fallback | COMPLETE | Guards and corresponding specs read; scoped suite passed |
| JSON empty-field compaction and scalar preservation | COMPLETE within reviewed evidence | Precision/duplicate-key guards, positional arrays, and prototype-safe objects present |
| JSON tables, row separation, size fixture | COMPLETE within reviewed evidence | Existing size/preserved-content specs passed; custom escape probes remained distinct |
| Every Markdown heading kept with its level | PARTIAL | Multiline setext text and headings after nested fences lost |
| Fenced blocks never split | PARTIAL | Defect 2 |
| Verbatim retained lines, never empty | COMPLETE at line-selection level | Insufficient to preserve Markdown meaning in defects 1–3 |
| Markdown fixture within budget, section first lines | COMPLETE for supplied fixture | Scoped suite passed; block-context cases absent |
| Pure functions, no new dependencies, exports and scope | COMPLETE within named files | Imports are local; no I/O or logging; barrel and scope entry present |

Implicit requirements not addressed: preserving HTML/comment context when removing surrounding lines, and recognizing fences inside list containers.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Invalid JSON, repeated keys, lossy numbers, deep nesting | YES | Unchanged fallback (`json.reducer.ts:44`, `:71`, `:53`) | Unexpected non-RangeError failures propagate by contract |
| Backslash-pipe, trailing backslash, string `null` | YES in probes | Quoted cells; escaped pipe; final quote protects delimiter (`json.reducer.ts:257`) | No general Markdown-renderer interoperability claim made |
| Empty string versus missing table key | YES by approved pruning policy | Object empty string becomes absent; array-contained empty string remains `[""]` (`json.reducer.ts:136`, `:225`) | Original empty-field presence is intentionally not recoverable from reduction |
| Heading inside ordinary fenced block | YES | Whole unit (`markdown.reducer.ts:114`) | Indentation/container variants fail |
| Four-space-indented `#` line | YES | ATX pattern allows at most three spaces (`markdown.reducer.ts:29`) | Four-space fence handling fails separately |
| Blank-separated thematic break or list plus `---` | YES for existing tests | Paragraph reset and list exclusion (`markdown.reducer.ts:127`, `:142`) | Multiline setext preservation fails |
| HTML comment / block | NO | No block state before ATX recognition | Defect 3 |
| 5,000-character first body line, budget 100 | YES | Oversize first section stops; next section's summary survives | Fairness is by whole units, not equal token shares |
| All headings over budget / no line fits | YES | Retain headings / return original (`markdown.reducer.ts:395`, `:379`) | Deliberately may exceed budget before later cut |

## Non-blocking notes and verification

- Read the full two production reducers and their full specs, barrel, Batch 2a types/token measure/detector, context.md, and the Batch 2 amendment/2b requirements. The task is explicitly plan-free (batches.md:13); no task-description.md, implementation-plan.md, or current code-style-review.md was present. `ptah_search_files` returned no AGENTS.md; native hidden-file discovery also found none. No native file-read tool was listed, so source reads used the shell. No git operations were performed.
- Scoped `ptah_get_diagnostics` reported zero errors and warnings. The corrected command `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers` completed all three targets successfully, exit 0. Nx Cloud reported a disabled/free-plan organization (401); local targets succeeded. The earlier incorrectly parsed PowerShell command ran no targets and is not counted as verification.
- Short in-memory Node/TypeScript probes reproduced all four inputs listed in the three defects. No source or test files were edited. The probes are described completely above; no separate probe file was created.
- A 2,097,019-character JSON array reduced to 1,672,186 characters in **80 ms** locally. This is one representative measurement, not a worst-case proof. Three 64 KiB JSON string-cell probes (numeric characters, letters, backslashes) completed in **0–1 ms** each. Markdown 64 KiB runs of digits, spaces, backticks, hashes, hyphens, equals and tildes completed in **1–12 ms** each with a 2,000-token budget. The inspected reducer regexes have bounded/linear scans rather than the earlier overlapping fence backtracking pattern (`json.reducer.ts:31`, `markdown.reducer.ts:27`).
- The JSON 300-row <=40% token-size guard and per-row scalar preservation checks are present at `reducers/json.reducer.spec.ts:280` and `:288`; they passed in the scoped suite. I did not independently remeasure the executor's exact ~36% figure.
- Empty fields such as `{"error":""}` or `{"items":[]}` remain unchanged when nothing else survives (`json.reducer.ts:77`). When siblings survive, those fields disappear by approved User Decision 7. Losing “explicitly empty” versus “absent” can affect interpretation, but is not a violation of the approved compaction policy.
- Structure: production files are 415 and 406 lines, below the 700-line soft ceiling; separate named private functions implement pruning, table rendering, block parsing and budgeting. No new dependencies, I/O, logging, `as any`, or suppression directives occur in the reviewed reducers. Their only runtime dependency edge is Markdown's existing local token helper (`markdown.reducer.ts:19`); JSON imports only types (`json.reducer.ts:17`). `.commitlintrc.json:57` places the requested scope after `persistence-sqlite`. No separate structural shipping defect was found.
- Remaining uncertainty: these probes and specs do not establish complete CommonMark conformance, worst-case time across every 2 MB shape, or future pipeline/spooling behaviour. The later spool cannot justify emitting a misleading reduction first.

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for the reproduced defects; representative, not exhaustive, performance evidence.
- Top risk: the model can read an affirmative instruction where the original heading was explicitly negated.
- What a robust implementation would add: complete multiline setext headings; container- and indentation-aware atomic fences; HTML-block context; regressions independent of the production parser's assumptions.
