/**
 * UI Library - Brand-mark entry point (`@ptah-extension/ui/brand-mark`)
 *
 * Exports only `BrandMarkComponent`, the one component that reaches the
 * vendored logo table. It exists so an EAGERLY loaded view can still show a
 * vendor mark without putting the table in the initial chunk: the view imports
 * the component from this path, in an import declaration of its own, and uses
 * it only inside `@defer`. The Angular compiler then turns that import into a
 * dynamic `import('@ptah-extension/ui/brand-mark')`, and because nothing eager
 * imports this file statically, esbuild emits it (and the table) as a lazy
 * chunk (R7, TASK_2026_533 Batch 24a).
 *
 *   import { BrandMarkComponent } from '@ptah-extension/ui/brand-mark';
 *   …
 *   @defer (on immediate) { <ptah-brand-mark … /> } @placeholder { <ptah-monogram-tile … /> }
 *
 * Lazily loaded code (the Marketplace routes) may keep importing the component
 * from `@ptah-extension/ui`.
 */
export { BrandMarkComponent } from './lib/native/brand-mark/brand-mark.component';
