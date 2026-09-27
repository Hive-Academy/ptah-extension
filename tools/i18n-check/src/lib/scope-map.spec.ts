import {
  defaultAllowedScopes,
  isKnownScope,
  literalKeyPattern,
  owningScope,
  scopeI18nDir,
} from './scope-map';

describe('scope-map', () => {
  it('maps a scope to its i18n directory', () => {
    expect(scopeI18nDir('core')).toBe('libs/web/core/src/lib/i18n');
    expect(scopeI18nDir('app')).toBe('apps/ptah-landing-page/src/app/i18n');
    expect(scopeI18nDir('panelUi')).toBe('libs/web/panel-ui/src/lib/i18n');
  });

  it('applies the --allow-scope defaults (ui: none, core: ui, others: ui,core)', () => {
    expect(defaultAllowedScopes('ui')).toEqual([]);
    expect(defaultAllowedScopes('core')).toEqual(['ui']);
    expect(defaultAllowedScopes('pricing')).toEqual(['ui', 'core']);
  });

  it('knows only the fixed scopes', () => {
    expect(isKnownScope('legal')).toBe(true);
    expect(isKnownScope('ptah')).toBe(false);
    expect(isKnownScope('toString')).toBe(false);
  });

  it('takes the owning scope from the first segment', () => {
    expect(owningScope('core.checkout.error')).toBe('core');
    expect(owningScope('core')).toBe('core');
  });

  it('anchors the literal scan on the project scope', () => {
    const legal = literalKeyPattern('legal');
    expect(legal.test('legal.terms.title')).toBe(true);
    expect(legal.test('legal.terms')).toBe(false);
    expect(legal.test('ptah.live')).toBe(false);
    expect(literalKeyPattern('pricing').test('legal.terms.title')).toBe(false);
    expect(legal.test('legal.terms title')).toBe(false);
  });
});
