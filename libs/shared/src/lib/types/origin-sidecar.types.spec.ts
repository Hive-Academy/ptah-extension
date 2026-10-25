import { parseOriginSidecar } from './origin-sidecar.types';

/** A sidecar as written before `sourceRef`/`sourceLabel` existed. */
const legacySidecar = {
  kind: 'agent',
  slug: 'reviewer',
  pluginId: 'toolkit',
  version: '2.1.0',
  sourceHash: 'abc',
  clonedAt: 1,
  diverged: false,
  lastEnhancedAt: null,
  historyDir: '.history',
};

describe('parseOriginSidecar', () => {
  it('parses a sidecar written before the source identity fields', () => {
    const parsed = parseOriginSidecar(legacySidecar);
    expect(parsed).not.toBeNull();
    expect(parsed?.sourceRef).toBeUndefined();
    expect(parsed?.sourceLabel).toBeUndefined();
    expect(parsed?.pluginId).toBe('toolkit');
  });

  it('keeps sourceRef and sourceLabel when present', () => {
    const parsed = parseOriginSidecar({
      ...legacySidecar,
      sourceRef: 'external:acme/toolkit/toolkit',
      sourceLabel: 'Acme Toolkit',
    });
    expect(parsed?.sourceRef).toBe('external:acme/toolkit/toolkit');
    expect(parsed?.sourceLabel).toBe('Acme Toolkit');
  });

  it('rejects a non-string sourceRef as no sidecar', () => {
    expect(parseOriginSidecar({ ...legacySidecar, sourceRef: 42 })).toBeNull();
  });
});
