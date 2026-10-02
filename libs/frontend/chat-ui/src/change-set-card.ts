/**
 * Chat UI - Change-set card entry point (`@ptah-extension/chat-ui/change-set-card`)
 *
 * Exports only `ChangeSetCardComponent`. The chat transcript is eager and shows
 * the card inside `@defer`, which the Angular compiler turns into a dynamic
 * `import()` of this path. The main `@ptah-extension/chat-ui` barrel is
 * statically imported by eager code, so a deferred import of the card from
 * there would land it in the eager closure; from this file, which nothing
 * eager imports statically, esbuild emits the card as a lazy chunk
 * (TASK_2026_576 Batch 31, same pattern as `@ptah-extension/ui/brand-mark`).
 *
 * Do not re-export the card from `index.ts`.
 */
export {
  ChangeSetCardComponent,
  type ChangeSetCardHost,
} from './lib/molecules/change-set/change-set-card.component';
