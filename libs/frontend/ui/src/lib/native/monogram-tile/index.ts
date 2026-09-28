/**
 * Native Monogram Tile - Barrel Export
 *
 * The artwork-free lettered tile (`ptah-monogram-tile`). It has its own barrel,
 * apart from `./brand-mark`, because eager hosts (the chat-ui discovery views
 * and the dashboard skill picker) render it: esbuild follows every import of a
 * barrel it keeps, so importing the monogram through the brand-mark barrel
 * pulled the vendored logo table into the initial chunk (R7, TASK_2026_533
 * Batch 24a). This barrel must never import the brand-mark component or its
 * artwork table.
 *
 * @module native/monogram-tile
 */
export { MonogramTileComponent } from '../brand-mark/monogram-tile.component';
export type { MarkTileSize } from '../brand-mark/monogram-tile.component';
