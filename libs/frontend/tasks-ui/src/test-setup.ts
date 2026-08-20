import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});

/**
 * jsdom implements no scrolling, so `Element.prototype.scrollIntoView` is
 * simply absent and calling it throws.
 *
 * Stubbed here rather than guarded in the component: whether a DOM method
 * exists is a property of the host, and a `typeof … === 'function'` branch in
 * production code would exist only to describe this test environment's gaps.
 * `TaskDetailComponent` scrolls the expanded workflow document into view — that
 * it lands on screen is asserted in the Electron pass with `toBeInViewport`,
 * which is the only place that can tell.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* no layout in jsdom — nothing to scroll */
  };
}
