/**
 * Chat UI - Turn-recap entry point (`@ptah-extension/chat-ui/turn-recap`)
 *
 * Exports the turn-end recap pieces: the host-built turn summary model
 * (`buildTurnSummaryModel`) and its chip (`TurnSummaryChipComponent`,
 * TASK_2026_623 component 6). The chat transcript mounts the chip at turn end
 * inside `@defer` and loads the model builder through a dynamic `import()` of
 * this path; the Angular compiler turns the `@defer` into the same dynamic
 * `import()`. The main
 * `@ptah-extension/chat-ui` barrel is statically imported by eager code, so a
 * deferred import from there would land them in the eager closure; from this
 * file, which nothing eager imports statically, esbuild emits them as a lazy
 * chunk (TASK_2026_610, same pattern as `@ptah-extension/chat-ui/change-set-card`
 * from TASK_2026_576 Batch 31).
 *
 * Nothing here imports the surface renderer (D14). Do not re-export these from
 * `index.ts`.
 */
export { TurnSummaryChipComponent } from './lib/molecules/turn-recap/turn-summary-chip.component';
export {
  buildTurnSummaryModel,
  turnTestsOutcomeLabel,
  type TurnSummaryCard,
  type TurnSummaryCostCard,
  type TurnSummaryDurationCard,
  type TurnSummaryFileRow,
  type TurnSummaryFileState,
  type TurnSummaryFilesCard,
  type TurnSummaryLinesCard,
  type TurnSummaryMarks,
  type TurnSummaryModel,
  type TurnSummaryTestRow,
  type TurnSummaryTestTone,
  type TurnSummaryTestsCard,
  type TurnSummaryTokensCard,
  type TurnSummaryUnavailable,
} from './lib/molecules/turn-recap/turn-summary.model';
