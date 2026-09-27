import { defineI18nScope } from '@ptah-extension/i18n';

export const APP_I18N_SCOPE = defineI18nScope('app', {
  en: () => import('./en.json'),
  ar: () => import('./ar.json'),
});
