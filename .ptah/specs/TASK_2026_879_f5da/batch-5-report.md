# Batch 5 report — transcript-only turn summaries

## Result

Turn summaries now render only in the transcript. The display panel, display dock, Command Center rail, Canvas rail stub, and detached Display window carry only surfaces and artifacts. The transcript chip keeps its expanded details. No file under `libs/backend` was edited.

## Files changed

### Transcript chip and panel

- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts`
- `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/organisms/display-panel/turn-summary-mini-card.styles.ts` (comment only; still used by the transcript chip)
- `libs/frontend/chat-ui/src/display-panel.ts`

Deleted summary-only panel files:

- `libs/frontend/chat-ui/src/lib/organisms/display-panel/turn-summary.component.ts`
- `libs/frontend/chat-ui/src/lib/organisms/display-panel/turn-summary.component.spec.ts`
- `libs/frontend/chat-ui/src/lib/organisms/display-panel/turn-summary-files.component.ts`
- `libs/frontend/chat-ui/src/lib/organisms/display-panel/turn-summary-tests.component.ts`

### Chat, dock, and detached window

- `libs/frontend/chat/src/index.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-summaries.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-feed.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts`
- `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts`
- `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.spec.ts`
- `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.spec.ts`
- `libs/frontend/chat/src/lib/services/display-window/display-window-wire.ts`
- `libs/frontend/chat/src/lib/services/display-window/display-window-wire.spec.ts`
- `libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts`
- `libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/display-window/display-window.component.ts`
- `libs/frontend/chat/src/lib/components/templates/display-window/display-window.component.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts`
- `libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts`

### Command Center, Canvas, and shared contract

- `libs/frontend/command-center/src/lib/components/command-rail-display.component.ts`
- `libs/frontend/command-center/src/lib/components/command-rail-display.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-rail-display-cue.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts`
- `libs/shared/src/lib/types/rpc/rpc-display-window.types.ts`

## Removed symbols and behavior

- Chip: `openable`, `open`, `openInPanel`, `PanelRightIcon`, `unavailableId`, and the Open in panel control.
- Panel: `DISPLAY_PANEL_SUMMARY_KEY`, the summary item variant and tabpanel, `summary`, `summaryTurnKey`, panel `actionError`, `openFile`, and `review`.
- Dock: `DisplayDockSummary`, summary selection, `summaryTurnKey`, `summaries`, `summaryFor`, `summaryKeyFor`, `openSummary`, and `setSummaries`.
- Transcript feed: summary publication to the dock, chip `openable` and `open` wiring, and the summary-only `tabId` input. The feed retains `tabId` for host sources and live-turn surface publication.
- Detached window: summary snapshot fields and selection, summary change-set actions, `TurnSummaryModelSchema`, and summary action failure state. `DISPLAY_WINDOW_WIRE_VERSION` is now `2`; version `1` snapshots fail strict parsing.
- Shared RPC: detached-window `open-file` and `review` action types.
- Public exports: `DISPLAY_PANEL_SUMMARY_KEY` and `DisplayDockSummary`.

## Centering and pin accessibility

Only the transcript summary wrapper uses `mx-auto w-full max-w-3xl px-2 pb-3`. This centers the card in the existing chat content column and bounds its width to the `max-w-3xl` token. Message bubbles, artifacts, change-set cards, and other transcript content keep their existing layout.

The pin control now has visible text and accessible name `Keep current view`. Its `title` and `aria-description` are exactly:

`New or updated displays will not switch items or scroll this panel.`

The existing `aria-pressed` state and `togglePin()` behavior are unchanged.

## Tests and reference checks

Updated chip, keyboard, roving-tabindex, panel, dock, transcript, detached-window, Command Center, Canvas, ChatView, and message-sender specs. The wire spec rejects the previous wire version and the removed `open-file` and `review` actions. The display-sheet spec checks the new pin text, tooltip, screen-reader explanation, and pressed state.

Reference scans found no remaining frontend references to the removed summary keys, dock summary API, summary-only components, chip panel control, or summary panel bindings. Command Center and Canvas panel stubs no longer declare summary or summary-action members.

## Verification

Command:

```text
npm run verify -- -p @ptah-extension/chat,@ptah-extension/chat-ui,@ptah-extension/command-center,@ptah-extension/canvas
```

The same command was attempted twice. Neither attempt reached Nx project-task execution, so no four-project task header, lint result, test result, or typecheck result is available.

1. The first attempt acquired the machine-wide verification slot after 347 seconds. Nx plugin workers then exited during startup. Nx reported `Failed to load 3 default Nx plugin(s)` and exited with code 1. The failed plugins were the Nx JavaScript, package-json, and project-json workers. The ESLint and Jest plugin workers also failed to load. No project task ran.
2. The retry acquired a slot after 582 seconds and passed plugin startup. It then stopped making progress at `Creating project graph nodes with nx/core/package-json`. After a further wait of more than ten minutes, the Nx process had used about 9 seconds of CPU. I stopped the stalled verification and its process tree. No project task ran.

No test failure occurred. A comparison with `main` is not applicable because neither attempt executed a test. The exact blocker is Nx project-graph startup in this worktree under the current machine load.

Ptah diagnostics were requested for the changed files. The TypeScript service did not return a result within 45 seconds on two requests. Therefore, TypeScript diagnostics also provided no pass or fail result.

## Not done

- No commit, push, or pull request, per instruction.
- No Electron visual run. This batch did not start build, serve, dev, or e2e targets.
