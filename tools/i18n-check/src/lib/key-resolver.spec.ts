import { KeyResolver, TargetMap } from './key-resolver';
import type { TranslationFile } from './translation-files';

const file = (
  path: string,
  entries: string[],
  namespaces: [string, number][],
): TranslationFile =>
  ({
    file: path,
    loaded: true,
    entries: new Map(entries.map((k) => [k, 'value'])),
    namespaces: new Map(namespaces),
  }) as unknown as TranslationFile;

describe('KeyResolver', () => {
  const resolver = new KeyResolver(
    new Map([
      [
        'pricing',
        file(
          'p/en.json',
          ['pricing.card.heading'],
          [
            ['pricing', 1],
            ['pricing.card', 1],
          ],
        ),
      ],
    ]),
    'pricing',
  );
  const kind = (key: string, target: 'leaf' | 'object' | 'any') =>
    resolver.check(key, target, 'x.ts', 1)?.kind ?? 'ok';

  it('checks a key against its target', () => {
    expect(kind('pricing.card.heading', 'leaf')).toBe('ok');
    expect(kind('pricing.card', 'object')).toBe('ok');
    expect(kind('pricing.card', 'any')).toBe('ok');
    expect(kind('pricing.card', 'leaf')).toBe('unknown-key');
    expect(kind('pricing.card.heading', 'object')).toBe('not-a-group');
    expect(kind('landing.hero', 'leaf')).toBe('foreign-scope');
  });

  it('checks a prefix as a non-empty group', () => {
    expect(resolver.checkPrefix('pricing.card', 'x.ts', 1)).toBeNull();
    expect(resolver.checkPrefix('pricing.none', 'x.ts', 1)).toEqual(
      expect.objectContaining({ kind: 'unknown-key', key: 'pricing.none.*' }),
    );
  });
});

describe('TargetMap', () => {
  it('returns the sorted targets, or any when nothing was recorded', () => {
    const map = new TargetMap<string>();
    map.add('a', 'object');
    map.add('a', 'leaf');
    map.add('a', 'leaf');
    expect(map.of('a')).toEqual(['leaf', 'object']);
    expect(map.of('b')).toEqual(['any']);
  });
});
