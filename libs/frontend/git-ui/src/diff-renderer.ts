/**
 * Git UI - Diff renderer secondary entry point.
 *
 * Lightweight secondary entry exporting the `@pierre/diffs` renderer hosts:
 * - `PierreDiffHostComponent`: Full review host with hunk-level actions and toolbar projection.
 * - `TextDiffViewComponent`: Lightweight two-string unified diff view for in-memory comparisons.
 *
 * This entry point isolates `@pierre/diffs` into lazy chunks so the eager webview bundle
 * never includes Pierre or its syntax-highlighting grammars.
 */

export {
  PierreDiffHostComponent,
  type PierreHunkToolbarContext,
} from './lib/renderer/pierre-diff-host.component';
export { TextDiffViewComponent } from './lib/renderer/text-diff-view.component';
export {
  type PierreDiffStyle,
  type PierreThemeMode,
} from './lib/renderer/pierre-config';
