# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 17, Lane A, r1. **NEEDS_REVISION**: the new quality guard breaks PNG calls that previously ignored quality, and the callback summary has no enforcement of its one-line / under-300-character contract.

| Metric              | Value               |
| ------------------- | ------------------- |
| Overall score       | 6/10                |
| Assessment          | NEEDS_REVISION      |
| Blocking issues     | 0                   |
| Serious issues      | 1                   |
| Moderate issues     | 1                   |
| Failure modes found | 2 new batch defects |

The score is below 7–8 because a documented, previously successful PNG input now fails. It is above 3–4 because the default, supported-format forwarding, inline image, and ordinary summary path work and scoped checks pass. Counts and score concern this batch; inherited limitations are identified separately below, not charged again as new regressions.

Scope: the five named source/spec files' screenshot behavior, surrounding dispatch/budget/error paths, capability wiring and implementations, and result consumers across `libs` and `apps`. Requirements came from Batch 17, context Decisions 3/4/17, and the executor report. No `task-description.md`, `implementation-plan.md`, or `code-style-review.md` exists in the task folder; the separate language-plan review is unrelated and was left alone. No repository AGENTS/CLAUDE instruction file was found by `ptah_search_files` or hidden-file native search. No source edits or git operations were performed. This is not approval of unrelated branches in the large dispatcher/description/spec files.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`:

- **B** = `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.ts`
- **BS** = `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.spec.ts`
- **D** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- **DS** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- **T** = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- **C** = `libs/backend/vscode-lm-tools/src/lib/code-execution/services/chrome-launcher-browser-capabilities.ts`
- **E** = `apps/ptah-electron/src/services/electron-browser-capabilities.ts`

## Five logic questions

### 1. How does this fail silently?

No new silent-loss defect was established for supported screenshot formats: D:1461 preserves the capability's image data; D:1449 removes only the duplicate transcript encoding. An inherited save failure is still logged and omitted from the response (D:1428), so capture can succeed without the requested file. This is not newly introduced, and the task explicitly preserves the error path. The response must not be taken as proof that an omitted save succeeded.

### 2. What user action produces unexpected behaviour?

Selecting PNG while retaining a fractional quality from a reusable screenshot configuration now fails before the browser is called (B:286; defect 1). Saving under a sufficiently deep workspace path produces a callback longer than 299 characters (D:1446; defect 2).

### 3. What input data produces a wrong answer?

A long saved path violates the callback length contract; embedded line breaks can violate its one-line contract (D:1443). The new extension inference correctly handles known extensions, but an unknown extension remains unchanged even though JPEG bytes are selected, and an explicit format wins even when the extension conflicts (D:1408, D:3346). These file-label limitations predate this batch's inference and are not evidence that the inline MIME is wrong for valid formats.

### 4. What happens when a dependency fails?

Host exceptions become an error-bearing screenshot result (C:142, E:131, B:307). The dispatcher retains its existing error formatter and success-envelope callback flag (D:1475; DS:3549 explicitly expects `false`). Callback exceptions are isolated by `runObserver` at D:1448. File-write failure is caught at D:1428. There is no new timeout/cancellation mechanism around capture; browser hangs and malformed host payloads are not independently hardened by this batch. A nonempty bogus base64 string or mismatched host `format` is trusted at D:1435 rather than byte-validated.

### 5. What is missing that the requirements never mentioned?

The strict callback length limit and an arbitrarily long complete saved path cannot both be guaranteed without a display policy: use a bounded, escaped display path in the callback while retaining the complete path in the response caption (D:1443). The executor report also assumes incorrect runtime wiring: Electron registers the Chrome host, and CLI registers an incompatible placeholder; details below.

## Failure modes — numbered defects

### 1. Serious — PNG quality is validated even though PNG ignores it

- File/evidence: **B:286–294**, **T:1067**, **C:137**, **E:126**.
- Trigger: `{ format: 'png', quality: 50.5 }` (also `101` or `-1`), or the same quality with `saveTo: 'home.png'` and no explicit format.
- Symptom: screenshot capture returns `Invalid quality. Must be an integer between 0 and 100.` and no image is produced.
- Current handling: the new unconditional validation returns before the PNG-specific branch at B:303. Both host implementations omit PNG quality, so these values previously never reached CDP. The description still promises that quality is ignored for PNG.
- Impact: callers reusing quality settings across formats lose a working PNG capture path. This is a functional compatibility change beyond Decision 3, not merely a clearer error for an already-invalid JPEG request.
- Recommendation: apply the numeric guard only to lossy formats, and pass no quality for PNG. Preserve PNG's ignored-quality behavior. Add regressions for explicit PNG and extension-selected PNG with fractional/out-of-range quality; existing BS:225 only rejects invalid quality with the new default format.
- Verification: an in-memory transpilation of the actual builder returned the stated error for PNG/50.5 and PNG/101 with zero capability calls; PNG/60 still delegated. No source was modified.

### 2. Moderate — saved paths escape the callback's one-line and length limits

- File/evidence: **D:1443–1449**; existing long-caption test **DS:3406**; new short-summary assertion **DS:3469**.
- Trigger: successful save under a deep workspace root whose resolved path pushes the summary to at least 300 characters. On platforms accepting line breaks in path components, an embedded newline also breaks the one-line promise.
- Symptom: `onToolResult` receives the complete unbounded path. Caption budgeting happens afterward and does not affect the callback.
- Current handling: direct interpolation; no truncation, escaping, or callback-specific cap. The new test checks only the no-save case; the save test at DS:3482 does not assert the cap.
- Impact: the explicit transcript acceptance criterion is not met for valid long paths, and a transcript can receive substantially more text than the budgeted response caption.
- Recommendation: construct a bounded single-line callback summary below 300 characters, escaping control characters and abbreviating only its displayed path with an explicit ellipsis. Keep the complete saved path in the response caption. Add long-path and newline-path callback regressions without changing inline image handling.
- Verification: the actual screenshot switch body and path helpers were extracted with the TypeScript AST and evaluated with the real namespace plus mocked filesystem/dependencies. A `D:/` workspace followed by 45 `nested/` components and `shot.jpg` yielded a **389-character** callback. This is an isolated logic probe, not a real filesystem/browser integration test.

## Blocking issues

None introduced by the reviewed batch were established.

## Serious issues

Defect 1: unconditional quality validation breaks PNG's documented ignored-quality behavior (B:286).

## Moderate and minor issues

Defect 2: callback length and line constraints are unenforced for saved paths (D:1443).

Coverage limitation, not a third defect: the specs mock image strings rather than decode actual JPEG/PNG/WebP bytes (DS:3455, DS:3485). Explicit WebP quality was additionally probed at the namespace boundary, but no live-browser compression comparison was run.

## Requested decisions and cross-runtime trace

### saveTo-extension deviation

**Accept as a narrow compatibility adjustment within the intent**, not a reason to revise. The unchanged public contract already says the extension chooses the format (T:1078), and blindly applying JPEG would mislabel the description's own `homepage.png` example. An omitted format with a recognized extension is reasonably treated as an implicit format request. It does not suppress the inline image or introduce automatic image offload (D:1412, D:1459). The default is JPEG/60 when neither an explicit format nor a recognized extension selects another format.

| Input                          | Observed resolution                            | Judgment                                                                  |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------- |
| No format / no saveTo          | JPEG, quality 60                               | Correct, B:284 and B:305                                                  |
| `.jpg`, `.jpeg`, `.JPEG`       | JPEG, quality 60                               | Correct case-insensitive mapping, D:3320                                  |
| `.png`                         | PNG; quality should be ignored                 | Correct selection; defect 1 applies to quality                            |
| `.webp`                        | WebP, quality 60 unless supplied               | Correct selection, D:3326                                                 |
| No extension                   | JPEG; `.jpeg` appended                         | Correct, D:3346                                                           |
| Unknown extension, e.g. `.bmp` | JPEG; filename remains `.bmp`                  | Residual file-label mismatch; inference does not fix unknown extensions   |
| Explicit PNG + `shot.jpg`      | PNG bytes and image/png; filename stays `.jpg` | Explicit format correctly wins; caller-supplied conflicting label remains |

The isolated dispatcher probe exercised `.jpg`, `.jpeg`, `.JPEG`, no extension and `.bmp`; the repository spec additionally exercises explicit-format precedence (DS:3535).

### Quality, floats and WebP

Valid explicit integers, including 0 and 100, survive nullish fallback (B:302; BS:215). WebP receives both the default 60 and explicit qualities; the probe verified explicit 0 and 85. Float rejection for JPEG/WebP matches the CDP integer parameter (`node_modules/devtools-protocol/types/protocol.d.ts:13241`), so no evidence shows a previously working fractional JPEG/WebP request being broken. PNG is different because hosts omit that field entirely: defect 1.

Out-of-range JPEG/WebP values now fail locally instead of relying on host behavior; that is additional boundary validation beyond Decision 3. It is defensible for the documented 0–100 contract, but should not be generalized to PNG. Chromium's current encoder actually uses the quality for WebP despite the installed protocol comment saying “jpeg only”: `GetEncoder` binds the supplied quality into `EncodeBitmapAsWebp`. This supports the forwarding trace, not a live test of the installed browser version. [Chromium PageHandler source](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/page_handler.cc)

### Hosts and MIME

- VS Code registers `ChromeLauncherBrowserCapabilities` at `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:133`.
- Electron also registers that Chrome implementation at `apps/ptah-electron/src/di/phase-3-storage.ts:147`; the separate E class exists but no production registration/reference to it was found.
- Both implementation methods forward supported formats, preserve explicit quality with `??`, and ignore quality for PNG (C:135, E:124). The namespace always supplies JPEG/60 on a default successful route (B:298), so their internal direct-call PNG/80 defaults do not override it.
- The API builder injects the capability into this namespace at `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:768`.
- CLI **does register a token**, contrary to the executor report, but its value has `launch`, `close`, and `getStatus`, with no `screenshot` (`libs/backend/cli-engine/src/lib/container.ts:775`). In full bootstrap, the namespace therefore catches a missing-method TypeError at B:298/B:307; it does not take the absent-capability graceful stub. CLI cannot honor format/quality today. This is an inherited runtime limitation, not caused by the batch's defaults.
- For declared `png`/`jpeg`/`webp`, host codec selection and returned format agree (C:136/C:141; E:125/E:130); D:1436 maps that format to the matching inline MIME. The data string is forwarded unchanged at D:1462. This is a source trace, not byte-sniffing proof from a live capture.
- Inherited malformed-format limitation: `format: 'gif'` bypasses runtime enum validation at D:1399; hosts encode JPEG but echo `gif`, and D:1441 labels it PNG. The executor report already discloses this. Do not claim universal MIME correctness for invalid inputs; supported formats are correct. No widening of this batch to repair it is required by this review.

### Callback, transcript and frontend consumers

Searches across `libs` and `apps` covered `onToolResult`, `setToolResultCallback`, `ToolResultCallback`, screenshot names/formatter labels, and frontend base64 handling. The HTTP server forwards the optional callback (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:376`) and exposes a setter at :594. **No production call to that setter was found**; the named calls elsewhere are specs. Therefore the codebase search found no live callback consumer that parses the former base64 block.

The broader transcript path treats results generically: `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:659` copies `resultEvent.output`; `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts:108` reads generic output, :209 extracts text blocks, and :134 renders MCP text as markdown. Agent-card output renders `segment.content` as plain text at `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:159`. None has a screenshot/base64-block parser. Frontend base64 image handling found by the search concerns input attachments rather than screenshot result decoding.

Conclusion: no in-repository dependency on the removed textual base64 block was identified. The model's image content block remains available. External consumers and dynamically registered callbacks cannot be ruled out by a repository search; removing the duplicate representation is nevertheless explicitly authorized.

## Data flow

1. **OK** — tool schema publishes the default and format enum (T:1053, T:1061); runtime enum validation is an inherited gap.
2. **OK** — dispatcher selects explicit format, otherwise recognized saveTo extension (D:1408).
3. **GAP 1** — namespace resolves JPEG/60 but validates PNG quality unnecessarily (B:284–305).
4. **OK for capable hosts** — Chrome/Electron methods forward selected codec and quality, catch capture failures (C:124, E:114); CLI placeholder cannot capture.
5. **Inherited risk** — optional disk save writes decoded bytes and records path; failures only log (D:1412–1433). No saveTo means no image file write.
6. **GAP 2** — callback receives an unbounded interpolated summary (D:1443–1449).
7. **OK** — only caption text is budgeted; original image data and matching supported-format MIME remain inline (D:1453–1473).
8. **OK, unchanged contract** — capture errors retain their formatter and existing callback error flag (D:1475; DS:3549).

## Requirements fulfilment

| Requirement                                                  | Status   | Gap / evidence                                                                   |
| ------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------- |
| No selection means JPEG q60                                  | COMPLETE | B:284–305; recognized extension is an accepted implicit selection                |
| Explicit PNG honored                                         | PARTIAL  | Format works; invalid ignored quality prevents capture, defect 1                 |
| Explicit WebP / valid quality honored                        | COMPLETE | B:298, C:135, E:124; probe 0/85                                                  |
| Image block remains inline                                   | COMPLETE | D:1459–1468                                                                      |
| Callback contains format and approximate KB, no image base64 | COMPLETE | D:1446–1449                                                                      |
| One-line callback under 300 chars, saved path represented    | PARTIAL  | Unbounded/unescaped path, defect 2                                               |
| Existing error path preserved                                | COMPLETE | D:1475; DS:3549                                                                  |
| Description states default                                   | COMPLETE | T:1053, T:1062, T:1067                                                           |
| No saveTo suppression / no automatic image offload           | COMPLETE | D:1412 saves when requested; image retained at D:1461                            |
| Runtime coverage accurately reported                         | PARTIAL  | Executor report's CLI/no-registration claim is wrong; actual registrations above |

Implicit requirements not addressed: bounded display policy for long paths; inherited malformed-format validation, save-failure disclosure, and CLI capability conformance. Only the first is a batch revision request.

## Edge cases

| Case                                         | Handled                            | How                                                   | Concern                                                            |
| -------------------------------------------- | ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Empty options / quality only                 | YES                                | JPEG/60 or explicit quality, B:284                    | None for valid quality                                             |
| PNG with absent / integer quality            | YES                                | Host drops quality, C:137                             | Noninteger/out-of-range values wrongly rejected earlier            |
| JPEG/WebP 0 and 100                          | YES                                | Nullish fallback preserves zero, B:305                | No live encoding measurement                                       |
| Fractional JPEG/WebP quality                 | YES                                | Explicit local validation error, B:286                | CDP expects integer                                                |
| Long/newline saved path                      | NO                                 | Raw interpolation, D:1443                             | Defect 2                                                           |
| Recognized mixed-case extension              | YES                                | Trim + lowercase ext, D:3320                          | None                                                               |
| Unknown/conflicting extension                | NO for file labeling               | Existing extension kept, D:3346                       | Inline MIME still follows actual supported codec                   |
| Repeated / concurrent captures               | YES for this change's state        | Defaults and summaries are call-local, B:283 / D:1398 | Shared browser/save-path concurrency unchanged, not runtime-tested |
| Host throws / unavailable                    | YES for error text                 | B:307 / B:452                                         | CLI uses incompatible registered stub instead                      |
| Filesystem save fails                        | NO for explicit failure disclosure | Log-only catch, D:1428                                | Inherited; image can still succeed                                 |
| Bogus host data / unsupported runtime format | NO                                 | Trusted data/format, D:1435                           | Inherited; no byte sniffing                                        |

## Verification

Independent runs, all with `--skip-nx-cache`:

| Check                                                                     | Result                                                                                                                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools` | PASS, all three targets, 54.5 s                                                                                                                |
| `nx run degradation-audit:lint`                                           | PASS, TOTAL 300 unsuppressed sites                                                                                                             |
| `nx run ptah-electron:validate-deps`                                      | PASS, target and its dependency                                                                                                                |
| Actual builder in-memory probes                                           | Default JPEG/60, PNG rejection, explicit WebP 0/85 verified                                                                                    |
| Actual dispatcher screenshot body/helpers in-memory probe                 | Extension mappings and 389-character callback verified; filesystem mocked                                                                      |
| `ptah_get_diagnostics`                                                    | Unavailable: provider reported TypeScript still running after 45 s; not treated as clean diagnostics. Scoped Nx typecheck independently passed |

The executor's reported fails-before results were read but not rerun, since doing so would require reverting source. No browser was launched, no screenshot bytes were decoded from a real host, and no frontend UI session was exercised. Passing mocks are not evidence of image-size savings or installed-browser encoder behavior. The two logic probes expose cases absent from the passing acceptance specs.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the two code-level defects; MEDIUM for runtime/browser behavior, which was traced rather than exercised live.
- Top risk: PNG callers lose capture merely because they provide a quality value that the public contract says is ignored.
- What a robust implementation would add: skip PNG quality validation, cap/escape the callback display summary while retaining the full response path, and add failing-before regression specs for both. Retain the extension inference, inline image, explicit valid quality, and unchanged error route.
