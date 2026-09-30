import { defineI18nScope, type I18nScope } from '@ptah-extension/i18n';
import { PANEL_UI_I18N_SCOPE } from '@ptah-web/panel-ui';

export const MEMBERS_I18N_SCOPE = defineI18nScope('members', {
  en: () => import('./en.json'),
  ar: () => import('./ar.json'),
});

/**
 * Every scope the member panel renders: its own and the shared `@ptah-web/panel-ui`
 * primitives'. The app's `/members` route resolver loads this list.
 */
export const MEMBERS_I18N_SCOPES: readonly I18nScope[] = [
  MEMBERS_I18N_SCOPE,
  PANEL_UI_I18N_SCOPE,
];
