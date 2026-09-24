/**
 * Native Brand Mark - Barrel Export
 *
 * The brand logo tile (`ptah-brand-mark`), and nothing else. It is the only
 * export that reaches the vendored artwork table (`brand-marks.generated.ts`),
 * so it must stay reachable only from lazily loaded code: the Marketplace
 * routes import it from `@ptah-extension/ui`, and an eager host defers it
 * through the `@ptah-extension/ui/brand-mark` entry point inside `@defer`.
 *
 * The artwork-free pieces of the mark system live in sibling barrels that eager
 * code may import: `../mark-svg` (renderer), `../monogram-tile` and
 * `../brand-slugs` (slug tables and resolvers). Do NOT re-export them here:
 * esbuild follows every import of a barrel it keeps, so one eager import
 * through this file pulls the whole table into the initial chunk (R7,
 * TASK_2026_533 Batch 24a).
 *
 * @module native/brand-mark
 */
export { BrandMarkComponent } from './brand-mark.component';
