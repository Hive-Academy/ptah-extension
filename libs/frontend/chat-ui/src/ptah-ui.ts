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
 */
export { PtahUiMessageTextComponent } from './lib/organisms/ptah-ui/ptah-ui-message-text.component';
export {
  PtahUiBlockComponent,
  PTAH_UI_BLOCK_PIPELINE,
  type PtahUiBlockPipeline,
} from './lib/organisms/ptah-ui/ptah-ui-block.component';
