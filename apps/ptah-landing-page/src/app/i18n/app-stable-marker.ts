import type { ApplicationRef } from '@angular/core';

/** Set on `<html>` once the application reports stable after bootstrap. */
export const APP_STABLE_ATTRIBUTE = 'data-app-stable';

/**
 * Marks `<html data-app-stable="true">` once `appRef` reports stable, so an
 * e2e run can wait for hydration to settle (the app registers no Protractor
 * testabilities). There is deliberately no timeout: an app that never becomes
 * stable never gets the attribute, and the e2e wait fails visibly.
 *
 * Called from `main.ts` on the `ApplicationRef` that `bootstrapApplication`
 * resolves, never from an initializer, where the app can look stable before
 * bootstrap has finished. Browser only; `main.server.ts` does not call it.
 */
export async function markAppStable(
  appRef: ApplicationRef,
  doc: Document,
): Promise<void> {
  await appRef.whenStable();
  doc.documentElement.setAttribute(APP_STABLE_ATTRIBUTE, 'true');
}
