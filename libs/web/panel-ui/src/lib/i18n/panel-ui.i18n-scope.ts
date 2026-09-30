import { defineI18nScope } from '@ptah-extension/i18n';

export const PANEL_UI_I18N_SCOPE = defineI18nScope('panelUi', {
  en: () => import('./en.json'),
  ar: () => import('./ar.json'),
});
