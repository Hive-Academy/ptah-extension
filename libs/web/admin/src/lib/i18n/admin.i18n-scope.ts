import { defineI18nScope, type I18nScope } from '@ptah-extension/i18n';
import { PANEL_UI_I18N_SCOPE } from '@ptah-web/panel-ui';

export const ADMIN_I18N_SCOPE = defineI18nScope('admin', {
  en: () => import('./en.json'),
  ar: () => import('./ar.json'),
});

/**
 * Every scope the admin panel renders: its own and the shared `@ptah-web/panel-ui`
 * primitives'. The app's `/admin` route resolver loads this list.
 */
export const ADMIN_I18N_SCOPES: readonly I18nScope[] = [
  ADMIN_I18N_SCOPE,
  PANEL_UI_I18N_SCOPE,
];
