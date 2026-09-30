import * as path from 'path';
import { UsageError, resolveProjectRoot, toRel } from './cli';

describe('resolveProjectRoot', () => {
  it('returns the scope project root, normalising slashes', () => {
    expect(resolveProjectRoot('pricing', 'libs/web/pricing')).toBe(
      'libs/web/pricing',
    );
    expect(resolveProjectRoot('pricing', 'libs\\web\\pricing\\')).toBe(
      'libs/web/pricing',
    );
    expect(resolveProjectRoot('app', 'apps/ptah-landing-page//')).toBe(
      'apps/ptah-landing-page',
    );
  });

  it('rejects a root that belongs to another scope', () => {
    expect(() => resolveProjectRoot('pricing', 'libs/web/legal')).toThrow(
      new UsageError(
        '--project-root libs/web/legal does not match scope "pricing" (libs/web/pricing)',
      ),
    );
  });

  it('rejects an unknown scope as a usage error', () => {
    expect(() => resolveProjectRoot('nope', 'libs/web/nope')).toThrow(
      UsageError,
    );
    expect(() => resolveProjectRoot('nope', 'libs/web/nope')).toThrow(
      'unknown scope "nope"',
    );
  });
});

describe('toRel', () => {
  it('gives a forward-slash path relative to the workspace', () => {
    const root = path.resolve('ws');
    expect(toRel(root, path.join(root, 'libs', 'web', 'a.json'))).toBe(
      'libs/web/a.json',
    );
  });
});
