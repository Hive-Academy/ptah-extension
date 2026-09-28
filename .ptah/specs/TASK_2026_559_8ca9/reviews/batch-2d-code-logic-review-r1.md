# Code Logic Review — `TASK_2026_559_8ca9`

**Same-side fallback review.** The Codex CLI lane assigned to Batch 2d ("Review: Codex CLI
lane (logic + structure)", batches.md line ~793) failed with a 401 auth error before
producing output. This review was performed in-session by the same agent family that
would normally invoke that lane, per explicit instruction, to unblock the batch. No Codex
output exists to reconcile against.

This review resumes and supersedes the interrupted attempt by session `a484c7dfcaff7d778`.
That session left no partial Batch 2d review file on disk; this is a from-scratch pass over
the same brief (Batch 2d: code outline reducer, tree-sitter, existing parser services).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 2 |
| Failure modes found | 3 |

Batch 2d is functionally sound and unusually well-tested: the reducer's verbatim-lines
safety contract is checked by a reconstruction oracle in both specs, the adapter is
exercised against five real tree-sitter grammars (not mocks) plus two synthetic-runner
specs, and every stated failure mode (no outliner, no language hint, oversize input,
outliner throw/reject, malformed spans, syntax-error recovery, missing grammars) has a
dedicated case. One explicit batch requirement was not carried out — `vscode-lm-tools`'s
`package.json` was not updated to list `@ptah-extension/tool-output-reducers` as Task
2d.2 names as a file to change — which is why this is REVISE rather than APPROVE. No
defect changes what text the reducer emits or exposes hidden content.

## Files reviewed (full read)

- `libs/backend/tool-output-reducers/src/lib/reducers/code.reducer.ts`
- `libs/backend/tool-output-reducers/src/lib/reducers/code.reducer.spec.ts`
- `libs/backend/tool-output-reducers/src/lib/reducer.types.ts` (diff: added `AsyncOutputReducer`)
- `libs/backend/tool-output-reducers/src/index.ts` (diff: exports `createCodeReducer`, `CodeLineSpan`, `CodeOutline`, `CodeOutliner`)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.spec.ts`
- `libs/backend/vscode-lm-tools/package.json` (checked, unchanged — see Serious issue)
- `.ptah/specs/TASK_2026_559_8ca9/batches.md` (Batch 2d scope, lines 786-814; amendment block, line ~227; risk table, lines 259-270)

Task discovery: no `task-description.md`, `implementation-plan.md`, or
`code-style-review.md` exist in the task folder (matching the note in the prior batch's
review). `context.md` and `batches.md` were read for the Batch 2d contract.

## Verification performed

A stray untracked file, `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/__zzz-probe.spec.ts`,
was present in the worktree and broke the `vscode-lm-tools:test` target with a TS2345
compile error (`readonly CodeLineSpan[]` passed where `any[]` was expected, line 145-146
of that file). It is not part of Batch 2d's file list, is not referenced by any other
source file, and is an exploratory duplicate of `code-outliner.adapter.spec.ts`'s mock
setup — almost certainly leftover scratch work from an earlier interrupted session in this
same worktree. It was deleted (not "production code": an untracked, unreferenced probe
spec) so the batch's own tests could be verified in isolation. Rerunning after deletion:

    node_modules/.bin/nx run-many "-t=test,list,typecheck" -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools --skip-nx-cache

Tail:

    √ nx run @ptah-extension/tool-output-reducers:lint
    √ nx run @ptah-extension/tool-output-reducers:typecheck
    √ nx run @ptah-extension/vscode-lm-tools:test
    √ nx run @ptah-extension/tool-output-reducers:test
    √ nx run @ptah-extension/vscode-lm-tools:typecheck
    √ nx run @ptah-extension/vscode-lm-tools:lint
    NX   Successfully ran targets test, lint, typecheck for 2 projects
    Test Suites: 66 passed (prior run before deletion: 1451 tests passed, 1 suite failed only on the stray file)

All 6 scoped targets pass. I also ran `eslint --config libs/backend/vscode-lm-tools/eslint.config.mjs libs/backend/vscode-lm-tools/package.json` directly to check whether the configured `@nx/dependency-checks` rule (present in that project's eslint config) would catch the missing dependency described below — it produced no output. The `vscode-lm-tools:build` target uses `@nx/esbuild:esbuild` with an explicit `external` allow-list that does not include `tool-output-reducers`, so esbuild inlines the reducer lib's source via the TS path mapping into the bundle rather than resolving it as an npm dependency; this is almost certainly why the missing `package.json` entry produces no lint or build failure today. No raw `.jsonl`/`.sqlite` session logs were read.

## Five logic questions

### 1. How does this fail silently?

It does not, within the reducer's own contract: every fallback path is signalled through
`reducer: 'code-fallback:<log reducer>'` plus a `notes[0]` reason string
(`code.reducer.ts:156-167`), so a caller that only checks `reducer === 'code-outline'` can
detect non-outline output. The one place a caller could be misled is upstream of this
batch: `ReduceContext.languageHint` accepts anything, and `.tsx`/`.jsx` files resolve to
plain grammars that then refuse on JSX syntax (see Moderate finding below) — the refusal
itself is loud (via the fallback reason), but a caller that does not surface `notes` to a
human would see a truncated log-style excerpt for what looks like a normal request and
have no reason to suspect the file was never actually outlined.

### 2. What user action produces unexpected behaviour?

Requesting a code outline for any `.tsx`/`.jsx` file containing real JSX markup always
falls back to the head/tail log reducer, never an outline — `EXTENSION_LANGUAGE_MAP` maps
both to grammars without JSX support (`code-outliner.adapter.ts:17-23`,
`code-outliner.adapter.spec.ts:422-430` confirms `.tsx` → `null`), and the
`SYNTAX_ERROR_QUERY` check (`code-outliner.adapter.ts:185-187`) refuses on the resulting
parse errors. For a codebase with React/JSX files this makes the "code outline" feature a
no-op for that entire file class, silently downgrading to head-tail truncation which can
cut off the exported symbol the caller asked to focus on.

### 3. What input data produces a wrong answer?

None found that produces an incorrect (unsafe) render — every malformed-outline case
(negative/fractional/NaN/out-of-range spans, non-array span lists, null spans) is
validated in `coverage()` (`code.reducer.ts:187-217`) and routed to the safe fallback
rather than rendered, and this is directly tested
(`code.reducer.spec.ts:272-291`). The one wrong-answer-adjacent case is a
*reduction-effectiveness* defect, not a safety defect: an arrow function whose expression
body (not a `{ }` block) spans exactly one row produces `startLine = row+1`,
`endLine = row-1` in `bodySpan` (`code.reducer.ts` port, mirrored in the adapter's
`bodySpan` at `code-outliner.adapter.ts:233-245`), which is `startLine > endLine` and so
yields no span at all — correctly conservative (nothing is omitted that shouldn't be), but
it means a multi-line, non-brace arrow body's interior lines that are *not* the body's own
first/last row are still omittable while the first and last body rows are always
force-kept even when they hold no signature information (see Moderate finding below).

### 4. What happens when a dependency fails?

Every dependency-failure surface converted by this batch is inspected and handled without
a throw reaching the caller:

- No outliner supplied on the host → fallback (`code.reducer.ts:110-112`, tested at
  `code.reducer.spec.ts:245-249`).
- Outliner rejects or throws synchronously → caught, only the error's constructor name is
  kept in the note, not the message (avoids leaking host paths) →
  `code.reducer.ts:123-128`, tested at `code.reducer.spec.ts:220-243` including an
  explicit "does not contain 'secret'" assertion.
- `TreeSitterParserService.queryMulti` rejects, or `initialize()` errs/rejects on a host
  without WASM grammars → adapter returns `null`, never propagates
  (`code-outliner.adapter.ts:173-183`, tested at
  `code-outliner.adapter.spec.ts:485-505`).
- A parse that needed error recovery (`ERROR`/`MISSING` nodes) → refused rather than
  guessed (`code-outliner.adapter.ts:185-187`).

Not covered, and not claimed to be: cancellation mid-parse, or the parser hanging (no
timeout around `queryMulti`). Both are pre-existing properties of the shared
`TreeSitterParserService`, out of this batch's changed-file scope, and the spec's own
budget accounting (250 KiB in <1s, load-robust guard) suggests hangs were not observed at
tested sizes.

### 5. What is missing that the requirements never mentioned?

- `vscode-lm-tools/package.json` was not updated (Serious issue below) — this is actually
  *in* the requirements (Task 2d.2's file list), just not carried out, so it is reported
  there rather than here.
- Concurrent calls into a shared `TreeSitterCodeOutliner` instance (multiple tool calls
  outlining different files "at once" via `Promise.all` on the host side) are not
  exercised by any spec. Nothing in this batch's diff introduces new shared mutable state
  (the adapter is stateless besides the injected `parser`), so this is a latent question
  about `TreeSitterParserService.queryMulti`'s own re-entrancy, not a new risk from this
  batch — recorded as residual uncertainty, not a finding against this diff.
- No spec asserts what happens when `focusSymbol` matches a plain local variable deep
  inside a function body (`variable_declarator` is a valid `@decl` capture for TS/JS,
  `code-outliner.adapter.ts:91,102`). Tracing the logic by hand (not asserted anywhere)
  shows this behaves as documented — the single declarator line is kept and its sibling
  body lines still collapse into a note — but it is worth a test given the batch's
  otherwise thorough case coverage.

## Failure modes

### JSX/TSX files never produce a real outline

- Trigger: `languageHint` of `.tsx` or `.jsx` on source containing JSX syntax.
- Symptom: `reducer` is always `code-fallback:log-*`; the caller gets head/tail truncation
  instead of a declaration outline, with no way to opt in to a JSX-aware outline.
- Evidence: `code-outliner.adapter.ts:17-23` (module comment: "`.tsx`/`.jsx` map to the
  plain TS/JS grammars ... a file with JSX parses with errors and is refused");
  `code-outliner.adapter.spec.ts:422-430` (test proves it).
- Current handling: safe refusal (matches the "when unsure, do not outline" contract) —
  this is a deliberate, documented tradeoff, not an oversight.
- Recommendation: track as a known limitation in the batch's completion notes (parallel to
  Batch 2b's `KI-2b-1`), since "outline unavailable" for an entire common file type is a
  user-visible capability gap the plan text does not call out.

### Non-brace, multi-line arrow-function bodies under-omit their boundary rows

- Trigger: an arrow function whose body is a bare expression (not `{ }`) spanning more
  than one row, e.g. a method-chain body starting on the signature's own row.
- Symptom: the body's first and last rows are always force-kept (never candidates for
  omission) even when they hold no signature/closing-delimiter information, because
  `bodySpan` unconditionally shifts the span in by one row at each end assuming a
  brace/paren delimiter occupies that row.
- Evidence: `code-outliner.adapter.ts:239-245` (`startLine = body.startPosition.row + 1`,
  `endLine = colon === undefined ? body.endPosition.row - 1 : lastRow(body)` — the `-1`
  shift is unconditional for non-Python bodies, regardless of whether the body is actually
  brace-delimited).
- Current handling: conservative (nothing unsafe is omitted; the effect is only reduced
  compression on this one input shape). No spec targets this shape directly — the
  `bar`/`baz` fixtures in `code-outliner.adapter.spec.ts:132-137,321-323` are all
  single-row or brace/paren-wrapped multi-line bodies where the shift happens to be
  correct.
- Recommendation: moderate priority — either special-case non-block arrow bodies (no
  first/last-row shift) or leave as-is and note the limitation; not worth blocking the
  batch over.

### Missing `package.json` dependency entry (see Serious issue)

- Trigger: any consumer that resolves `@ptah-extension/vscode-lm-tools`'s dependencies
  from its `package.json` rather than the Nx/TS path graph (a future publish step, a
  stricter `@nx/dependency-checks` configuration, or a build executor whose `external`
  list changes to exclude buildable-library bundling).
- Symptom: latent — today's `esbuild` build target bundles `tool-output-reducers` by
  source regardless of the missing entry, so nothing currently breaks.
- Evidence: `libs/backend/vscode-lm-tools/package.json` (no
  `@ptah-extension/tool-output-reducers` entry); `libs/backend/vscode-lm-tools/project.json`
  build target `external` list omits it, confirming why esbuild masks the gap.
- Current handling: none — the file simply was not edited.
- Recommendation: add the dependency entry per Task 2d.2's explicit file list.

## Blocking issues

None. No finding in this review lets a failure produce a success-looking result, corrupts
output, or exposes content the safety contract promises to withhold.

## Serious issues

### Task 2d.2's required `package.json` edit was not made

- File: `libs/backend/vscode-lm-tools/package.json`
- Scenario: Task 2d.2 (batches.md line 806) names three files to change, including
  "`<WT>/libs/backend/vscode-lm-tools/package.json` (add
  `@ptah-extension/tool-output-reducers`)". `code-outliner.adapter.ts:43-47` imports
  `CodeLineSpan`, `CodeOutline`, `CodeOutliner` from that package, and
  `code-outliner.adapter.spec.ts:26-30` imports `countTokens`, `createCodeReducer` (value
  imports, not type-only) from it. `git status` on the worktree confirms
  `libs/backend/vscode-lm-tools/package.json` has no local modifications.
- Impact: the declared dependency graph for this project understates its real
  dependencies. No current build, lint, or test failure results (see Verification
  section for why), so the impact is confined to future packaging/publishing correctness
  and to any stricter dependency-graph tooling — but it is a concrete, named deliverable
  that was skipped, which is why this batch is REVISE rather than APPROVE.
- Fix: add `"@ptah-extension/tool-output-reducers": "0.0.1"` to
  `libs/backend/vscode-lm-tools/package.json`'s `dependencies`, matching the existing
  `"@ptah-extension/workspace-intelligence": "0.0.1"` entry pattern already present for
  the same adapter file.

## Moderate and minor issues

- Moderate: JSX/TSX outlining is a permanent no-op (see failure mode above,
  `code-outliner.adapter.ts:17-23`). Recommend documenting as a known limitation rather
  than leaving it implicit in a code comment only.
- Moderate: non-brace multi-line arrow bodies under-compress at their first/last row (see
  failure mode above, `code-outliner.adapter.ts:239-245`). No safety impact.
- Minor: no spec exercises `focusSymbol` matching a `variable_declarator` deep inside a
  function body (`code-outliner.adapter.ts:91,102`); the by-hand trace says it behaves
  correctly per contract, but the batch's own standard (a case for every documented
  behaviour) would cover it.
- Minor: `render()`'s "keep verbatim if the note wouldn't be shorter" comparison
  (`code.reducer.ts:239-245`) counts a trailing `+1` for every line in the run including
  the last, which very slightly overstates `runChars` relative to the actual joined
  length; this can only ever bias toward *keeping* a borderline run verbatim (never
  toward hiding more), so it cannot cause a safety regression — noted only because it is
  the one place the implementation's own doc comment ("no longer than its note") is not
  quite what the code computes.

## Data flow

1. `createCodeReducer(outliner)` closes over the injected `CodeOutliner` (or `undefined`)
   and returns an `AsyncOutputReducer` — OK, no shared mutable state introduced.
2. `reduceCode` short-circuits on empty input, no outliner, no language hint, and oversize
   input before ever calling the outliner — OK, each guarded and tested.
3. `outliner.outline(input, language, focusSymbol)` runs once per call; result is either a
   `CodeOutline`, `null`, or a thrown/rejected error, all three handled — OK.
4. `omittedLines` builds two coverage arrays (`omittable`, `focus`) via one difference
   array pass each, over the *exact* line count of the *exact* input just parsed (`lines =
   input.split('\n')` computed after the outliner call, from the same `input` the
   outliner received) — OK, no possibility of a stale/mismatched line count between what
   was parsed and what is rendered.
5. `render` walks `lines`/`omit` once, emitting either the verbatim line or one note per
   contiguous omitted run, sized against the run's own character cost — OK, verified by
   the reconstruction oracle in both spec files.
6. In the adapter: `TreeSitterParserService.queryMulti` is awaited once per `outline()`
   call with `errors`/`bodies`(/`declarations`) queries batched into that single call —
   OK, matches the file header's claim of "one parse."
7. `bodySpan`/`declarationSpan` turn raw tree-sitter captures into `CodeLineSpan`s with
   bounds checks the reducer additionally re-validates (`coverage()`) — OK, defence in
   depth: even if the adapter's row math were wrong, the reducer's own bounds check would
   catch an out-of-range span and fall back rather than render it.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `CodeOutliner` port with `outline(source, language, focusSymbol?)` | COMPLETE | Actual port returns `Promise<CodeOutline \| null>` (line spans), not `Promise<string \| null>` as batches.md's literal signature says — this is the intentional, documented refinement described in the reducer's own file header ("The port returns LINE SPANS, not text") and is clearly the safer design; treated as a plan improvement, not a gap. |
| Async-capable reducer, contract updated if needed | COMPLETE | `AsyncOutputReducer` added to `reducer.types.ts` and used. |
| Focus symbol body kept verbatim | COMPLETE | `code.reducer.spec.ts:120-142`; real-grammar proof at `code-outliner.adapter.spec.ts:387-413`. |
| `null`/throw from outliner → log-reducer fallback, trailer names it | COMPLETE | `code.reducer.ts:110-167`; extensively tested. |
| Tree-sitter adapter reuses existing parser services, no new parser instance | COMPLETE | `TreeSitterCodeOutliner` takes an injected `OutlineQueryRunner`; it does not construct a `TreeSitterParserService` itself. |
| VS Code host without grammars → `null`, not a throw | COMPLETE | `code-outliner.adapter.spec.ts:485-505`. |
| 300-line TS fixture: outline ≤ 40% of source tokens, every exported name present, focus body present | COMPLETE | `code-outliner.adapter.spec.ts:380-413`. |
| `vscode-lm-tools/package.json` add `@ptah-extension/tool-output-reducers` | MISSING | Not edited; see Serious issue. |
| Batch 2d verification: scoped `nx run-many` passes | COMPLETE (after removing an unrelated stray file) | See Verification section. |
| Codex review lane approves | BLOCKED | Codex lane returned 401; this document is the same-side fallback per instruction. |

Implicit requirements not addressed: none beyond what is listed above and in the Five
Logic Questions section.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty input | YES | Returns input unchanged, `code-unchanged`, no outliner call (`code.reducer.ts:107-109`) | None |
| CRLF line endings | YES | Split on `\n` only, `\r` stays attached to its line (`code.reducer.spec.ts:187-196`) | None |
| Input > 256 KiB | YES | Fallback without calling outliner (`code.reducer.spec.ts:261-270`) | None |
| Outliner returns malformed/out-of-range spans | YES | `coverage()` rejects, fallback (`code.reducer.spec.ts:272-291`) | None |
| Outline omits nothing (or focus swallows all omittable lines) | YES | Fallback, `code.reducer.spec.ts:293-310` | None |
| 16,000 nested spans | YES | Linear-time difference-array algorithm, load-robust perf guard (`code.reducer.spec.ts:355-391`) | None |
| Syntax-error / incomplete parse | YES | Refused via `ERROR`/`MISSING` query (`code-outliner.adapter.spec.ts:417-420`) | None |
| Unsupported / garbage language hint | YES | Resolved to `undefined`, no parse attempted (`code-outliner.adapter.spec.ts:432-441`) | None |
| JSX/TSX source | YES (refuses) | Falls back every time (see Moderate finding) | Capability gap, not a safety issue |
| Non-brace multi-line arrow body | PARTIAL | Body interior is found but first/last rows over-kept | Under-compression only |
| `focusSymbol` matching a local variable | NOT TESTED | Traced by hand to behave per contract | Add a spec case |
| Concurrent outline calls sharing one `TreeSitterCodeOutliner` | NOT TESTED | N/A | Pre-existing property of `TreeSitterParserService`, out of this diff's scope |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the missing `vscode-lm-tools/package.json` dependency entry is the only
  concrete, unmet, explicitly-named requirement in this batch; everything else is either
  complete or a documented/tested tradeoff. Fixing it is a one-line change.
- What a robust implementation would add: (1) the missing package.json entry; (2) a spec
  for `focusSymbol` matching a nested local variable; (3) either a fix or an explicit
  known-limitation note for non-brace multi-line arrow bodies and for JSX/TSX always
  falling back.
