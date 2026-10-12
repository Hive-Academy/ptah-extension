/**
 * Chat UI - display-panel entry point (`@ptah-extension/chat-ui/display-panel`)
 *
 * The display panel pieces (TASK_2026_623, component 5): the panel the dock
 * hosts (`DisplayPanelComponent`), the pure surface computation
 * (`buildDisplaySurfaces`) and the headless surface sync the transcript
 * mounts. Eager code reaches this path only inside `@defer`, which
 * the Angular compiler turns into a dynamic `import()`, so the fence pipeline,
 * the validator and `declarative-dashboard` stay in a lazy chunk (D14). The
 * main `@ptah-extension/chat-ui` barrel is statically imported by eager code;
 * same pattern as `@ptah-extension/chat-ui/ptah-ui` and
 * `@ptah-extension/chat-ui/turn-recap`.
 *
 * The dock ports (`PTAH_UI_DISPLAY_DOCK`, `PTAH_UI_DISPLAY_DOCK_SYNC`) are NOT
 * here: the eager ChatView provides them, so they need a main-barrel export of
 * their eager-light file (`lib/services/ptah-ui-display-dock.ts`).
 *
 * Do not re-export anything from this file in `index.ts`.
 */
export {
  DisplayPanelComponent,
  DISPLAY_PANEL_SUMMARY_KEY,
  type DisplayPanelViewStateChange,
} from './lib/organisms/display-panel/display-panel.component';
export { DisplaySurfaceSyncComponent } from './lib/organisms/display-panel/display-surface-sync.component';
export type { DisplayTurnSnapshots } from './lib/organisms/display-panel/display-surface-sync.component';
export {
  anonymousDisplaySurfaceId,
  applyDisplayFences,
  buildDisplaySurfaces,
  compileDisplayFences,
  displayFenceSources,
  displaySurfaceKey,
  type CompiledDisplayFence,
  type DisplayCandidate,
  type DisplayCompile,
  type DisplayFenceOutcome,
  type DisplayResolve,
  type DisplaySurface,
  type DisplaySurfacesResult,
} from './lib/organisms/display-panel/display-surfaces';
