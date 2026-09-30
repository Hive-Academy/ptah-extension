import { defineI18nScope } from '@ptah-extension/i18n';

export const LANDING_I18N_SCOPE = defineI18nScope('landing', {
  en: () => import('./en.json'),
  ar: () => import('./ar.json'),
});
