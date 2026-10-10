/**
 * Chat UI - ptah-ui entry point (`@ptah-extension/chat-ui/ptah-ui`)
 *
 * The `ptah-ui` fence host for assistant text (TASK_2026_610, component 9).
 * The execution node reaches it only inside `@defer`, which the Angular
 * compiler turns into a dynamic `import()` of this path, so the fence pipeline,
 * zod, the validator and `declarative-dashboard` stay in a lazy chunk. The
 * main `@ptah-extension/chat-ui` barrel is statically imported by eager code;
 * same pattern as `@ptah-extension/chat-ui/turn-recap` and
 * `@ptah-extension/chat-ui/change-set-card`.
 *
 * `PtahUiLiveWindow` is NOT here: the eager transcript provides it, so it is
 * exported from the main barrel.
 *
 * Do not re-export anything from this file in `index.ts`.
 *
 * `PTAH_UI_DISPLAY_DOCK` lives in its own eager-light file
 * (`lib/services/ptah-ui-display-dock.ts`, `@angular/core` only). An eager
 * provider must not import it through this entry, which would pull the whole
 * entry into the initial chunk; it needs a main-barrel export of that file,
 * the same way `PTAH_UI_HOST_SOURCES` is exported.
 */
export { PtahUiMessageTextComponent } from './lib/organisms/ptah-ui/ptah-ui-message-text.component';
export { PtahUiDisplayChipComponent } from './lib/organisms/ptah-ui/ptah-ui-display-chip.component';
export {
  PTAH_UI_DISPLAY_DOCK,
  displayFenceKey,
  type PtahUiDisplayDock,
  type PtahUiDisplayFenceState,
  type PtahUiDisplayFenceStatus,
} from './lib/services/ptah-ui-display-dock';
export {
  PtahUiBlockComponent,
  PTAH_UI_BLOCK_PIPELINE,
  type PtahUiBlockPipeline,
} from './lib/organisms/ptah-ui/ptah-ui-block.component';
