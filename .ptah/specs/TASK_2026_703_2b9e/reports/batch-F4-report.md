# Batch F4 report - canvas: CLI lane input

## Files changed

- MODIFIED `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` - the
  `@case ('cli')` column renders `<ptah-agent-continue-input class="flex-shrink-0" [agent]="agent" />`
  after `ptah-agent-card`; `AgentContinueInputComponent` imported from `@ptah-extension/chat` (public
  barrel; both libs are `scope:webview, type:feature`).
- MODIFIED `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts` - a CLI
  lane with `cliSessionId` renders the input directly below the card; a sub-agent lane does not.

## Acceptance

- Component 9 seam met. Visibility and queueing stay owned by `AgentContinueInputComponent` /
  `AgentFollowUpQueueService` (unchanged).

## Checks

- `npx nx test @ptah-extension/canvas --parallel=1`: PASS (23 suites, 421 tests).
- `npx nx typecheck @ptah-extension/canvas --parallel=1`: PASS.
- `npx nx lint @ptah-extension/canvas --parallel=1`: PASS (0 errors, 62 pre-existing warnings, e.g.
  the spec's existing `any` signals).
