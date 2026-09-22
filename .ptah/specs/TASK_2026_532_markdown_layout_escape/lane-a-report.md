# Lane A report — TASK_2026_532_markdown_layout_escape

Implemented both requested fixes. All six scoped Nx verification targets passed.

## Changes

- `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:329`: orphan tool-result, tool-result-error, command, and file-change segments now create tool nodes. Preserves `seg-orphan-${i}`, uses complete/error status, preserves the tool name with `Tool` as the fallback, stores raw output in `toolOutput`, and sets `content: null`.
- `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.spec.ts:272`: updated the orphan expectation; parameterized regression coverage at line 293 checks all four segment types, raw HTML preservation, named tools, status, stable IDs, absent input, and surrounding text nodes.
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts:113`: scans consecutive backtick runs and wraps output with a fence of `max(3, longestRun + 1)` backticks. The markdown-language branch is unchanged.
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.spec.ts:76`: covers zero/short/long backtick runs, multiple runs, unchanged markdown-file output, and real component rendering of the reported fenced HTML payload. The DOM assertion at line 89 requires one code block containing the literal payload and no `div.fixed` element.

## Contract and renderer checks

- `libs/shared/src/lib/types/execution/node.ts:150` makes `toolInput` optional; `factories.ts:11` accepts this node shape and defaults children/collapse state.
- `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts:84` passes the node to the output renderer independently of input.
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts:216` hides absent input. `tool-output-display.component.ts:62` routes ordinary output to CodeOutputComponent. Its specialized input guards safely reject absent input. CodeOutputComponent's regression renders without input.
- Stack: Angular 22.1.7 from root `package.json`; existing standalone, OnPush, signal-input/computed components retained. Existing Tailwind/daisyUI markup and ngx-markdown rendering path retained. No imports, shared primitives, or styling tokens added.

## Verification

Project names and all three targets were confirmed from `libs/frontend/chat/project.json` and `libs/frontend/chat-ui/project.json`.

Command run:

```text
npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat @ptah-extension/chat-ui --skip-nx-cache
```

Output was tailed, not pasted in full. Exit code: 0. Nx reported a 1m 15s run with cache skipped.

| Project | test | lint | typecheck |
| --- | --- | --- | --- |
| @ptah-extension/chat | PASS | PASS | PASS |
| @ptah-extension/chat-ui | PASS | PASS | PASS |

Scoped `ptah_get_diagnostics` was also run before and after editing. Both reported 250 errors and zero warnings in the broader compiler diagnostic surface. The only reported errors in these four files are the same two pre-existing missing-content fixture casts in the tree-builder spec (original lines 297/312, now 332/347). No new diagnostics were reported for the changed files. The declared Nx typecheck targets passed despite those broader existing spec diagnostics.

## Scope and anything not done

Only the four requested source/spec files and this report were written. No git commands were run. No changes were made to `libs/frontend/markdown`; sanitizer hardening remains owned by the concurrent lane. Intentional markdown rendering, including the existing MCP markdown-language behavior, remains unchanged as requested. No blocked or unfinished lane-A work.

## Revise round 1

Read `review-lane-a.md` and applied the caller's five requested revisions within the expanded chat/chat-ui scope.

### Changes with file:line evidence

- CREATED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-fence.ts:1`: one named `fenceCodeBlock(content, language)` function, sizing the fence to `max(3, longestRun + 1)`.
- CREATED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-fence.spec.ts:4`: unit coverage for no backticks, runs of 3 and 10, and multiple runs with language preservation.
- MODIFIED `libs/frontend/chat-ui/src/index.ts:85`: public barrel export for the helper; chat imports through `@ptah-extension/chat-ui`.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts:114`: replaced the local fence implementation with the shared helper.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts:283`: language-specific and generic input fences use the helper. The existing markdown-language branch is unchanged.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.spec.ts:62`: rendered expanded Write input tests with and without a file path require one code block, literal HTML content, and no `div.fixed` element.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts:131`: diff output uses the helper.
- CREATED `libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.spec.ts:7`: diff coverage includes runs in both old and new strings, including a run of 10 backticks.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:153`: tool-result data now uses Angular-escaped `<pre>` interpolation and the neighboring cases' typography. Removed obsolete prose classes from that container. MarkdownModule remains needed by model text.
- CREATED `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.spec.ts:18`: rendered tool-result markup stays literal, produces no `div.fixed`, and instantiates no markdown component; a separate test confirms model text still renders markdown.
- MODIFIED `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:334`: unnamed orphan labels now fall back to Command, File change, or Tool result by segment type. Lines 357 and 372 fence error/info content as text while retaining node IDs, statuses, and the raw error field.
- MODIFIED `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.spec.ts:321`: tests all fallback labels, fenced errors and info with embedded HTML/backticks, unchanged node identity/status, preserved error data, and unchanged neighboring model prose.
- UPDATED this `lane-a-report.md` with revision details and verification outcomes.

### Verification results

Ran the requested command twice, tailing output only:

```text
npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat @ptah-extension/chat-ui --skip-nx-cache
```

1. Initial run: five targets passed; chat-ui:test failed on the new diff fixture's missing file-link provider (1 failed, 240 passed). Added the existing `FILE_LINK_OPENER` test provider and `provideMarkdown()` to that fixture.
2. Final run: exit 0, all six targets passed, cache skipped, duration 46.0s.

| Project | test | lint | typecheck |
| --- | --- | --- | --- |
| @ptah-extension/chat | PASS | PASS | PASS |
| @ptah-extension/chat-ui | PASS | PASS | PASS |

The additional scoped `ptah_get_diagnostics` attempt was unavailable: its TypeScript worker had been terminated because another run timed out. The declared Nx typecheck targets both passed independently.

### Scope and limitations

No git commands were run. No files under `libs/frontend/markdown` were edited. Model prose and the explicitly preserved markdown-language branches remain markdown, relying on the sanitizer lane's hardening as directed by the caller. All five revision requests are implemented; no remaining blocked work in this revision.
