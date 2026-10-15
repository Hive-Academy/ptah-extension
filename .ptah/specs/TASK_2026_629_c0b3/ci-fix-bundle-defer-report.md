# CI fix: defer the setup card on the empty Rail board (TASK_2026_629)

**Verdict: STOPPED BEFORE CODE.** I changed no files. Wrapping `<ptah-project-setup-card>` in
`@defer` inside `canvas-rail-board.component.ts` cannot remove `ProjectSetupCardComponent` from the
initial bundle. The card is already in the initial bundle through another eager path. The change
would recover close to 0 of the 2.75 kB, and one way of writing it could make the initial bundle
bigger. The orchestrator has to choose a different fix (see Clarifications Needed).

## Files

None changed. This report is the only file written.

## Evidence

### 1. The card is in the initial bundle whatever the board does

This chain is eager from start to finish. None of these links sits inside `@defer`. `rg "@defer" libs/frontend/canvas/src`
finds no `@defer` anywhere in the canvas lib.

1. `apps/ptah-extension-webview/src/app/app.config.ts:79` imports `OrchestraCanvasComponent` from
   `@ptah-extension/canvas`, and line 249 provides it as `ORCHESTRA_CANVAS_COMPONENT`. That
   import is a value, so it is eager.
2. `canvas-rail/canvas-focus-area.component.ts:16,25` puts `CanvasLaneViewComponent` in its imports.
3. `canvas-detail/canvas-lane-view.component.ts:33,46,68` puts `CanvasDetailTranscriptComponent` in
   its imports and uses it in the template outside any `@defer`.
4. `canvas-detail/canvas-detail-transcript.component.ts:62` sets `readonly chatView = ChatViewComponent;`,
   a value reference that `*ngComponentOutlet` renders.
5. `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:27,228` and
   `chat-view.component.html:97` use `ChatEmptyStateComponent` eagerly. So do
   `organisms/transcript/chat-transcript.component.ts:20,215` and `chat-transcript.component.html:162`.
   Neither use is inside `@defer`.
6. `chat-empty-state.component.ts:10,35,84` imports `ProjectSetupCardComponent` and renders it
   eagerly.

So `ProjectSetupCardComponent`, and the services it injects, ship in `main` even if the board never
mentions the card. The most a board-level `@defer` can save is the few hundred bytes of template
instructions for one element. It cannot save 2.75 kB.

### 2. A board-level `@defer` cannot become its own chunk here

- Angular defers an import only when every symbol in that import declaration is used inside
  `@defer` alone. The repo states this rule in
  `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:37-39`.
  Line 16 of the board imports `ProjectSetupCardComponent` in the same declaration as
  `RailTranscriptRetentionCoordinator` and `TabManagerService`, and both of those are used eagerly
  (line 56 providers, and the class body). So the compiler would keep the card import static, and a
  `@defer` block would only add a defer runtime around code that is already loaded.
- Moving the card into its own `import { ProjectSetupCardComponent } from '@ptah-extension/chat'`
  would make Angular emit `import('@ptah-extension/chat')`, a dynamic import of the whole chat barrel
  (`tsconfig.base.json:36`; the chat lib has no secondary entry points). This file already imports
  that barrel statically, and so do `app.ts`, `app.config.ts` and `app.routes.ts`. esbuild would
  therefore create no new chunk. The same comment says esbuild "splits it out only when no eager
  code imports that file". A dynamic import of a barrel also asks esbuild to keep the barrel's whole
  export namespace. That can turn chat symbols that are now lazy or tree-shaken into eager code.
  This is a real risk of making the budget miss larger, and I cannot measure it without a build,
  which the task forbids.
- The repo's working pattern for a lazy cross-lib component is a secondary entry point that no eager
  code imports, for example `@ptah-extension/chat-ui/change-set-card` and `/turn-recap`
  (`tsconfig.base.json:49-62`). A chat-lib entry point for the card would still not help, because of
  point 1: `ChatEmptyStateComponent` imports the card file eagerly.

### 3. The card is not what pushed the bundle over

- CI run 38664216088 (head `7dbb2d6bc`), job `checks`: `Initial total 3.50 MB`, `main 1.71 MB`,
  `Budget 3.50 MB was not met by 2.75 kB`.
- The previous CI run on this branch (38652221159, head `d82fc59a6`) failed in `degradation-audit`.
  Its failed-step log has no budget line, so there is no green baseline on the branch to diff
  against.
- Between those two heads the branch took a merge of `origin/main` (`59ede9e11`, including
  `9ff6fb2e5` webview chat resync) and `0dccad207`, which added about 100 lines of production code
  across `canvas-rail-keyboard.ts`, `canvas-rail.component.ts`, `canvas-rail-board.component.ts`,
  `canvas-lane-tabs/-view` and `tailwind.config.js`. After those came `d5c8ba3e4` (chat, chat-ui,
  chat-types) and `2f2b37d58` (canvas, chat, chat-ui). The 2.75 kB overshoot adds up across all of
  these. The re-added `<ptah-project-setup-card>` element is a tiny part of it because its class
  was already in `main`.

### 4. Spec impact (step 4 of the task)

Only `canvas-rail/canvas-rail-board.component.spec.ts` checks the setup card: a stub selector at
line 179, and synchronous checks at lines 728 and 793. No other canvas spec mentions
`ptah-project-setup-card` or `ProjectSetupCardComponent`. If a defer is ever adopted, only those two
checks need `DeferBlockBehavior.Playthrough` or `fixture.getDeferBlocks()` with
`render(DeferBlockState.Complete)`.

## Checks

Not run, because I changed no code. Running specs, typecheck or lint on an unchanged tree would
prove nothing.

## Decisions

- **Decision:** do not apply the requested `@defer`.
  **Options:** (a) apply it as written; (b) apply it with a separate import declaration; (c) stop and
  report.
  **Evidence:** sections 1 to 3. Option (a) is a no-op. Option (b) is at best a no-op and at worst a
  regression.
  **Reversible:** yes, nothing was written.

## Clarifications Needed

1. How should the 2.75 kB be recovered, given that deferring the board's setup card cannot do it?
   - **(Recommended)** Allow one measured webview production build. A user or orchestrator has to
     approve it, because CLAUDE.md forbids `build` unless the user asks. Compare the stats or
     `--stats-json` against `main` so the change that moved the bytes is found, then target that
     change. Today every fix is a guess.
   - Defer a canvas-only component that is eager now and used only in the board. The candidate is
     `CanvasSessionDetailsComponent` (`canvas-detail/canvas-session-details.component.ts`, 5.8 kB of
     source, imported only by `canvas-rail-board.component.ts:26`, relative file import, so it
     would split). Use `@defer (on immediate)` in the side aside and in the split Details overlay,
     with a placeholder that keeps the same width. The likely saving is about 1.5 to 3 kB minified,
     which might not be enough on its own.
   - Defer `ChatEmptyStateComponent` inside `chat-view.component.html:97` and
     `chat-transcript.component.html:162` (chat lib, outside this batch's ownership). That takes
     the empty state and the setup card out of `main` for every surface, which is the only change
     that actually moves the card's bytes.
   - Drop the setup card from the empty Rail board again. This removes a capability that the
     `0dccad207` CI fix restored on purpose, so the user has to decide.
2. Should the budget stay fixed? The task says never to change it. I assume yes, and this report
   does not propose changing it.
