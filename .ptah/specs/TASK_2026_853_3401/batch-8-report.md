# Batch 8 report: reply cards, read-only tool row, artifact auto-open in the dock

## Files

- CREATED `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-artifacts.ts`:
  `TranscriptTurnArtifacts`. Built in `ChatTranscriptComponent` like `TranscriptTurnSummaries`. It runs
  `groupTurns` over each slot's current record and `vm().streamingBoundary`. For each FINALIZED turn it
  walks every assistant root depth-first with `publishedArtifactFromNode`. Output:
  `byEndMessage: Signal<Map<endMessageId, PublishedArtifact[]>>` (equality by id/title/revision, so a
  streaming tick keeps the same map). The walk of a finalized message is cached in a `WeakMap` keyed by
  the message object, so settled trees are walked once. Each new `id@revision` goes once to
  `ArtifactStore.adoptPublishResult`. `open(id)` calls `dock.openArtifact(tabId)`. `fullscreen(id)`
  calls `openArtifact` and `requestFullscreenArtifact`. Both use the transcript's own `tabId` input,
  never `activeTabId()`. `openable` is false without a dock. The `ArtifactStore` is resolved lazily
  through `Injector`, only once an artifact exists.
- CREATED `.../transcript/transcript-turn-artifacts.spec.ts` (6 tests). It covers the depth-first order
  across nested agents and anchoring at the last assistant message. It also checks that streaming,
  error and other-tool nodes are skipped, adoption happens once per id, Full screen targets the
  transcript's own tab, and the component is read-only without a dock. **Regression (bug A):** Open
  with `tabId='tile-tab'` while `activeTabId()` is `'other-tab'` writes
  `selection {kind:'artifact'}` to `dock.tab('tile-tab')`, and `dock.tab('other-tab')` stays the
  same object.
- MODIFIED `.../transcript/chat-transcript.component.ts`: imports `ArtifactCardComponent` from the
  existing eager `@ptah-extension/chat-ui` import declaration and adds the field
  `turnArtifacts = new TranscriptTurnArtifacts({ tabId, view: vm })`.
- MODIFIED `.../transcript/chat-transcript.component.html`: after the turn-end slot and before the
  summary chip / change-set branch, outside `display.enabled`, so it renders on every host:
  `@defer (when published.length > 0)` + `@for` → `<ptah-artifact-card>` (testid wrapper
  `chat-turn-artifact`) when `openable` and the record is resolved. Otherwise a read-only title card
  (`chat-turn-artifact-readonly`) is shown: VS Code, lanes, or before adoption resolves.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts`:
  the Open / Full screen card is gone. The row now shows a compact read-only line
  `Artifact · <title>` (`data-testid="tool-artifact-line"`) from the shared parser. It no longer
  injects `ArtifactStore`, `DisplayDockState`, `DisplaySheetState` or `TabManagerService`, and its
  local `isRecord` and parser copy were deleted.
- MODIFIED `.../tool-execution/tool-call-item.component.spec.ts`: covers the line for both tool
  names and MCP text content, checks there is no card or buttons, and checks there is no line for an
  error.
- MODIFIED `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts`: added
  `requestArtifactAutoOpen(tabId, artifactId)`, which copies the `requestAutoOpen` rules. An open
  pinned dock is left unchanged (same state object). An open unpinned dock switches to Displays and
  selects the artifact. When the user closed the dock during the live turn
  (`userClosedTurnKey === liveTurnKey`, non-null), it adds 1 to `newCount`. Otherwise it opens on
  Displays with the artifact selected. It never changes focus or the active tab, and the latest
  request wins.
- MODIFIED `.../display-dock/display-dock.state.spec.ts`: 4 tests for the rules above.
- MODIFIED (outside the batch list, required) `.../transcript/lane-transcript.component.spec.ts`: the
  lane test pinned the old tool-row card (`artifact-card-title` / "Preview not available here"). It now
  pins the read-only `tool-artifact-line`, with no card and no Open.

## Decisions

- **Unresolved record or no dock → read-only title card in the transcript template.**
  `ArtifactCardComponent` (chat-ui, not this batch) has no read-only mode. Options were (a) add an
  input to chat-ui or (b) use inline markup in the transcript. I chose (b): no shared-primitive
  change. This is reversible.
- **Fullscreen no longer calls `DisplaySheetState.setMode('full')`.** The old tool row did this.
  Batch 11 deletes `display-sheet.state.ts`. The panel's own full screen reads
  `dock.fullscreenArtifact(tabId)`. Reversible.
- **Adoption key is `id@revision`**, so a republish under the same id is adopted again.
  `adoptPublishResult` keeps the newer revision.
- **Line title comes from the tool result**, not the store, so the tool row needs no store at all.

## What batch 11 must wire

- ChatView consumer of `ArtifactStore.autoOpenRequest()`: call
  `dock.requestArtifactAutoOpen(tabId, record.id)`. The main view uses any tab that
  `findTabByIdAcrossWorkspaces(record.sessionId)` finds; a tile uses only its own `resolvedTabId`.
  Track `seq` so each request is applied once. An unknown tab gets no open.
- The display sheet should honour `dock.fullscreenArtifact(tabId)` without the old sheet `full` mode.

## Verification

- First run, `npm run verify -- -p @ptah-extension/chat`: `3 tasks: 2 succeeded, 1 failed`. Lint and
  typecheck passed. Test: `Test Suites: 1 failed, 301 passed, 302 total`,
  `Tests: 1 failed, 2 skipped, 5333 passed`. The failure was
  `lane-transcript.component.spec.ts › shows a loaded artifact read-only, without dead Open actions`,
  which pinned the old tool-row card. It was fixed as listed above and re-run in the batch 9 verify
  (see `batch-9-report.md`).
