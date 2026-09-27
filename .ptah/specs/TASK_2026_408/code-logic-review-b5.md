# Code Logic Review — `TASK_2026_408`

Verdict: APPROVED
Score: 8/10

Approval covers Batch 5's implemented logic, not the unverified edit-boundary gate or Batch 6 provider wiring.

File boundary: NOT VERIFIED. Hunk list: unavailable. The reviewer role prohibits git operations, so the requested `git diff -U0` was not run. The permitted current locations are `responses-request-translator.ts:66` (interface and comment) and `responses-request-translator.ts:391` (function and comment); this is not evidence that other locations were unchanged. The orchestrator must still verify the hunk list against HEAD 118380beb before accepting the batch (`batches.md:281`).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues introduced by this batch | 0 |
| Serious issues introduced by this batch | 0 |
| Moderate issues introduced by this batch | 0 |
| Minor issues | 1 |
| Failure modes introduced by this batch found | 0 |

All source locations below are relative to this worktree. Abbreviations: `translation/` means `libs/backend/auth-providers/src/lib/translation/`; `translator` means `translation/responses-request-translator.ts`; `downgrade` means `translation/responses-tool-output-images.ts`.

Read all four requested files in full. Read task context, Batch 5/6 contracts, component 7, the shared media resolver, and nearby tool-name and Chat Completions translation patterns. No applicable AGENTS.md was found in the worktree ancestor chain or directories covering these files. No task-description.md or code-style-review.md exists in this task folder.

Evidence supports the 7–8 band: the requested mapping and pure post-pass are implemented and tested, with no demonstrated new behavioural defect. It does not support 9–10: compatibility and edge-case evidence remains incomplete, and the required diff gate could not be verified.

## Five logic questions

### 1. How does this fail silently?

The no-image branch filters everything except text (`translator:450`) and only marks errors when the resulting string is truthy (`translator:458`). Consequently missing content, `[]`, or `""` with `is_error: true` yields `output: ""`. A document-only or tool-reference-only result likewise yields an empty string. These are residual behaviours of the text-only algorithm that this batch is explicitly required to preserve (`implementation-plan.md:294`), not demonstrated regressions. The nearby Chat Completions translator uses the same filtering and truthiness guard (`translation/request-translator.ts:289`, `:296`). Historical byte identity still needs the diff gate.

The image branch also skips non-text/non-image blocks (`translator:409`). Thus an image plus a document/tool_reference retains the image and drops the other block. It adds image preservation without providing general nested-content support. Both the image and no-image paths ignore those other types; there is no evidence here that previously retained document/reference content is newly lost.

### 2. What user action produces unexpected behaviour?

Returning a failed tool result without explanatory content hides the failure marker (`translator:458`), as above. For supported image results, a screenshot-only error correctly inserts `Error:` before the image (`translator:435`); a leading text error prefixes that text (`translator:433`). The preceding `some(image)` guard and one emitted part per image guarantee that `parts[0]` exists for valid input (`translator:406`, `:417`). No empty-array crash occurs on this path.

### 3. What input data produces a wrong answer?

Documents and tool references can lose semantic content through the skips just described (`translator:409`, `:451`). Neither is represented in the local Anthropic union (`translation/openai-translation.types.ts:156`). They were exercised as runtime inputs in an in-memory probe, not treated as supported typed inputs.

Mislabeled PNG bytes are correctly resolved from their signature (`translator:413`; `libs/shared/src/lib/utils/image-media-type.ts:197`). Unsupported media gives an explicit placeholder (`translator:421`). The helper is a MIME resolver, not full image validation: an allowed claimed MIME can survive invalid/empty bytes (`libs/shared/src/lib/utils/image-media-type.ts:201`). Reusing that policy is explicitly required by component 7; it does not establish validity of the entire encoded image.

### 4. What happens when a dependency fails?

These two modules perform no I/O, scheduling, or persistent writes (`translator:401`; `downgrade:21`). They have no timeout, cancellation, disposal, or cross-request race to handle. Resolver failure represented as `null` becomes a visible placeholder (`translator:418`). Malformed objects such as an image without `source` can throw at `translator:414`; they are outside the declared image envelope (`translation/openai-translation.types.ts:172`). This code does not turn such an exception into success. Broader malformed-envelope handling is not proven by these unit specs.

Provider rejection and capability selection are deliberately deferred to Batch 6 (`batches.md:284`). The current base translation call is not a proof of downgrade wiring (`translation/translation-proxy-base.ts:553`). Batch 5 approval must not be interpreted as approval to ship arrays to every Responses provider.

### 5. What is missing that the requirements never mentioned?

A policy for document/reference blocks and empty error results remains unspecified beyond preserving text-only behaviour (`translator:451`, `:458`). Changing it here would conflict with the byte-preservation contract. Payload validity/size remains the responsibility of surrounding boundaries and provider handling, not the MIME resolver (`libs/shared/src/lib/utils/image-media-type.ts:193`). The specs also do not pin several empty-result cases (finding 1).

## Failure modes

No new failure mode was demonstrated within the supported Batch 5 contract. Residual silent omission and empty-error semantics are described above with their exact locations; they are excluded from the batch-introduced counts. Exact prior-byte parity and edit ownership remain unverified without a baseline diff. Provider acceptance remains untested against a live service.

## Blocking issues

None attributable to Batch 5 found. The separate required boundary-verification gate remains open (`batches.md:281`).

## Serious issues

None attributable to Batch 5 found.

## Moderate and minor issues

1. **Minor — missing explicit edge-case regression fixtures.** File: `translation/responses-request-translator.spec.ts:353` and `translation/responses-tool-output-images.spec.ts:43`. The suites cover image order, MIME recovery, unsupported/URL sources, both error-prefix positions, pairing, string preservation and mutation, but do not pin missing/empty tool-result content, empty `is_error` output, unknown nested blocks with/without images, or empty/text-only array downgrade. Impact: later cleanup could accidentally change the deliberately preserved empty/error semantics or mishandle arrays containing only unsupported-image placeholders. Add compact table-driven regression fixtures. This is coverage advice, not evidence of a new implementation defect.

## Data flow

1. **OK:** user tool results are dispatched individually with their call IDs (`translator:305`).
2. **OK:** image presence selects the array path; no-image input retains the string algorithm (`translator:404`, `:447`).
3. **OK:** supported text/image block order is preserved; unresolvable images become text placeholders (`translator:409`, `:417`). Other nested block types remain a residual omission.
4. **OK:** an image-bearing error is marked before content is returned; original blocks are not edited (`translator:430`).
5. **OK:** the downgrade maps request input, replaces only array function outputs, retains text, inserts one placeholder per image, and joins with newlines (`downgrade:24`, `:32`).
6. **OK:** new request/input/changed item objects are returned (`downgrade:37`, `:39`). Unchanged nested objects may be shared; purity does not promise deep cloning. Repeated downgrade is idempotent.
7. **DEFERRED:** provider routing and HTTP proof belong to Batch 6 (`batches.md:296`).

## Wire-shape evidence

- The emitted image is `{ type: 'input_image', image_url: 'data:...' }`, with `image_url` a string (`translator:424`). It matches the existing user-image shape (`translator:495`). It is not the Chat Completions `{ image_url: { url: ... } }` shape.
- The installed declaration is nested at `node_modules/exa-js/node_modules/openai/resources/responses/responses.d.ts:1891`; it declares `image_url?: string | null`. The root `node_modules/openai/...` path does not exist.
- The same declaration makes `detail` required at `:1878`, but its comment at `:1876` says the default is `auto`. Neither translator path emits `detail` (`translator:424`, `:495`). This is a local typing mismatch if assigned to that SDK interface, but these are local wire types, and the declaration does not establish that omission is rejected over HTTP. Do not manufacture a runtime rejection from this evidence.
- That SDK declares function output as a string at `responses.d.ts:1988`; it cannot validate the newer array shape. Independently inspected the pinned local Codex binary in `%TEMP%/t408/codexwin/package/vendor/x86_64-pc-windows-msvc/bin/codex.exe`: byte offset 236278484 contains `internally tagged enum FunctionCallOutputContentItem`; offset 237100895 contains `FunctionCallOutputContentItem::InputImage with 2 elements`. This corroborates the evidence recorded in `implementation-plan.md:303`, but the strings alone do not establish whether the second image field is optional. Exact server acceptance is residual uncertainty, not a demonstrated defect.
- The forced URL-source test (`translation/responses-request-translator.spec.ts:457`) is outside the base64-only local type (`translation/openai-translation.types.ts:173`). With no MIME/data it correctly resolves to the unsupported placeholder; URL fetching is not implemented or required.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Change only two permitted translator locations | PARTIAL | Current locations inspected; historical hunk list unavailable |
| Text-only remains a plain string | COMPLETE | Snapshot and string/array tests pass; historical byte identity not independently diffed |
| Image parts preserve block order and resolve MIME | COMPLETE | `translator:409`, `:413` |
| Unsupported image placeholder | COMPLETE | `translator:421` |
| Image-bearing is_error handling | COMPLETE | `translator:430` |
| Pure downgrade, newline joining, strings untouched | COMPLETE | `downgrade:24`, `:32`, `:39` |
| Provider-specific wiring | DEFERRED | Batch 6, not this review scope |

Implicit requirements not addressed: full image validation and semantic preservation of other nested content types; both exceed this batch's stated mapping contract.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Missing, empty string, empty array content | YES | Empty string (`translator:447`) | Error flag also disappears at `:458`; preserved residual |
| Image-only error | YES | Inserted Error: part (`translator:435`) | None found |
| Unsupported image error | YES | Prefixes placeholder (`translator:433`) | Array can contain text only |
| URL source without MIME/data | YES | Explicit unsupported placeholder (`translator:418`) | Forced runtime case, outside envelope type |
| Document/tool_reference | NO | Skipped (`translator:409`, `:451`) | General nested content remains unsupported |
| Multiple images | YES | Loop and downgrade map preserve order (`translator:409`; `downgrade:32`) | No extra image-size policy |
| Empty/text-only output array passed to downgrade | YES | map/join produces empty/text string (`downgrade:32`) | Not directly covered in committed specs |
| Repeated/frozen request | YES | No mutation; idempotent downgrade (`downgrade:24`) | Verified in memory |
| Very large content | YES for traversal | Linear iteration (`translator:409`; `downgrade:24`) | Allocates translated arrays/strings; no bound added |

## Verification

- Ran once, scoped to this project: `nx run-many -t test -p @ptah-extension/auth-providers --outputStyle=static`, with daemon and cache disabled. **52 suites, 1,250 tests, 2 snapshots passed**, exit 0. No failed-suite rerun.
- Ran an in-memory probe using TypeScript transpilation of the actual source: missing/empty content, empty error, document-only, image+document, image+tool_reference; observed the results described above. Deep-frozen downgrade and repeated-pass equality passed. No source or test files were written for the probe.
- `ptah_get_diagnostics` was called with absolute worktree paths. It returned **Unavailable: None of the requested files are inside the workspace root**. This is not a clean diagnostics result. No separate lint/typecheck run was performed.
- No network, live-provider requests, source edits, or git operations. Only this deliverable was intentionally written.

## Verdict

- Recommendation: APPROVE Batch 5 logic; retain the separate diff-boundary gate before batch acceptance.
- Confidence: MEDIUM.
- Top risk: actual Codex acceptance of the array image shape, including omitted detail, is not proven by these unit tests (`translator:424`; `implementation-plan.md:303`).
- What a robust implementation would add: the edge fixtures in finding 1; Batch 6 provider HTTP gating tests; independently recorded baseline hunks. General document/reference and empty-error changes require an explicit compatibility decision.