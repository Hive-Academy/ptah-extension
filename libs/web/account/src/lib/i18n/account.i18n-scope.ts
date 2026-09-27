import { defineI18nScope } from '@ptah-extension/i18n';

export const ACCOUNT_I18N_SCOPE = defineI18nScope('account', {
  en: () => import('./en.json'),
  ar: () => import('./ar.json'),
});
