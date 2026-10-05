/**
 * Chat UI - Turn-recap entry point (`@ptah-extension/chat-ui/turn-recap`)
 *
 * Exports only `TurnTestsRowComponent`. The chat transcript shows the row at
 * turn end inside `@defer`, which the Angular compiler turns into a dynamic
 * `import()` of this path. The main `@ptah-extension/chat-ui` barrel is
 * statically imported by eager code, so a deferred import of the row from
 * there would land it in the eager closure; from this file, which nothing
 * eager imports statically, esbuild emits the row as a lazy chunk
 * (TASK_2026_610, same pattern as `@ptah-extension/chat-ui/change-set-card`
 * from TASK_2026_576 Batch 31).
 *
 * Do not re-export the row from `index.ts`.
 */
export { TurnTestsRowComponent } from './lib/molecules/turn-recap/turn-tests-row.component';
