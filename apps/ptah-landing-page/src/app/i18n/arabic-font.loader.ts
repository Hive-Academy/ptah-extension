import { isPlatformBrowser } from '@angular/common';
import {
  DOCUMENT,
  effect,
  inject,
  makeEnvironmentProviders,
  PLATFORM_ID,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { I18nService } from '@ptah-extension/i18n';
import {
  ARABIC_FONT_HREF,
  ARABIC_FONT_LINK_ID,
} from './landing-i18n.constants';

/**
 * Requests the Arabic webfont the first time the language becomes `ar`
 * (a switch after load; the pre-paint script covers an Arabic first paint).
 * English visitors never request it.
 *
 * Browser only. The effect is a root effect that lives as long as the app,
 * and it appends at most one link per page: an existing `#ptah-font-ar`
 * (from the pre-paint script or an earlier switch) is left as it is.
 */
export function provideArabicFontLoader(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
      const i18n = inject(I18nService);
      const doc = inject(DOCUMENT);
      effect(() => {
        if (i18n.lang() === 'ar') ensureArabicFontLink(doc);
      });
    }),
  ]);
}

function ensureArabicFontLink(doc: Document): void {
  if (doc.getElementById(ARABIC_FONT_LINK_ID)) return;
  const link = doc.createElement('link');
  link.id = ARABIC_FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = ARABIC_FONT_HREF;
  doc.head.appendChild(link);
}
