import { defineI18nScope } from '@ptah-extension/i18n';

export const AUTH_I18N_SCOPE = defineI18nScope('auth', {
  en: () => import('./en.json'),
  ar: () => import('./ar.json'),
});
