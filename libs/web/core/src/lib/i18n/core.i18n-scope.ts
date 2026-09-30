import { defineI18nScope } from '@ptah-extension/i18n';

export const CORE_I18N_SCOPE = defineI18nScope('core', {
  en: () => import('./en.json'),
  ar: () => import('./ar.json'),
});
