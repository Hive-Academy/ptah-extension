import { defineI18nScope } from '@ptah-extension/i18n';

export const LEGAL_I18N_SCOPE = defineI18nScope('legal', {
  en: () => import('./en.json'),
  ar: () => import('./ar.json'),
});
