# Phase 4 — Incremental Markdown + shared scroll-dirty work

## Built

- Added `StreamingMarkdownRenderer`. During a live stream it tokenizes only newly closed markdown blocks and presents the unfinished tail as escaped text. Every interim result uses the full webview DOMPurify policy; on settlement `ExecutionNodeComponent` continues to use the existing `ngx-markdown` / marked / DOMPurify path unchanged.
- Added the single Phase 4 rollback token, `INCREMENTAL_STREAMING_PRESENTATION_ENABLED`. Setting it to `false` restores the previous throttled full-markdown path and leaves stream semantics intact.
- Deferred the ptah-ui/Mermaid branch until a text node settles, so Mermaid is never invoked for a live fence.
- Added root-scoped `ScrollDirtyService`; inline-agent mutation notifications now coalesce through one animation frame instead of maintaining a per-node debounce timeout.

## Files changed

- `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts`
- `libs/frontend/markdown/src/lib/streaming-markdown-renderer.ts`
- `libs/frontend/markdown/src/lib/streaming-markdown-renderer.spec.ts`
- `libs/frontend/markdown/src/index.ts`
- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.render-throttle.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts`
- `libs/frontend/chat/src/lib/services/scroll-dirty.service.ts`
- `libs/frontend/chat/src/lib/services/scroll-dirty.service.spec.ts`
- `libs/frontend/chat/src/lib/services/index.ts`

## Tests added

- Closed blocks are not re-parsed when only the open tail changes.
- A completed fixture matches the full marked-extension plus DOMPurify sanitizer output.
- Unsafe HTML in an open streamed tail remains escaped rather than live HTML.
- Scroll-dirty work is scheduled at most once per animation frame.

## Verification

- `npx jest -c libs/frontend/markdown/jest.config.ts src/lib/streaming-markdown-renderer.spec.ts --coverage=false --maxWorkers=2` — passed, 1 suite / 3 tests.
- `npx jest -c libs/frontend/chat/jest.config.ts src/lib/services/scroll-dirty.service.spec.ts src/lib/components/organisms/execution/execution-node.render-throttle.spec.ts --coverage=false --maxWorkers=2` — passed, 2 suites / 10 tests.
- `npx nx typecheck @ptah-extension/markdown --parallel=1` — passed.
- `npx nx typecheck @ptah-extension/chat --parallel=1` — passed; existing NG8107 optional-chain warning in `peer-session-send-dialog.component.ts`.
- `npx nx lint @ptah-extension/markdown` — passed.
- `npx nx lint @ptah-extension/chat` — passed with 34 pre-existing warnings and no errors.
- `git diff --check` — passed.

## Deviations

None. Phase 5 composer/CLS work and Phase 6 zoneless migration were not touched.

## Decisions

- The incremental renderer is intentionally limited to the live `text` markdown branch. The settled node preserves the existing full renderer exactly, retaining D5's final sanitizer contract.
- Open tails are escaped even when they look like HTML. This avoids both repeated parsing and partially formed unsafe DOM.
- The shared scroll coordinator owns scheduling only; each bubble retains its pinned-to-bottom eligibility checks and scroll operation.
