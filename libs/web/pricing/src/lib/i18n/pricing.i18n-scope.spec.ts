import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import ar from './ar.json';
import en from './en.json';
import { PRICING_I18N_SCOPE } from './pricing.i18n-scope';

describe('PRICING_I18N_SCOPE', () => {
  it('is the "pricing" scope, aliased to its own name', () => {
    expect(PRICING_I18N_SCOPE.scope).toBe('pricing');
    expect(PRICING_I18N_SCOPE.alias).toBe('pricing');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(PRICING_I18N_SCOPE)).toEqual({ en, ar });
  });
});
