import { PROVIDER_BRAND_SLUGS } from '../brand-mark/brand-slugs';
import {
  PROVIDER_MARKS,
  strokeMark,
  type ProviderMark,
} from './provider-marks.data';

const VIEWBOX_PATTERN = /^[0-9.]+ [0-9.]+ [0-9.]+ [0-9.]+$/;
/** Path data only — no markup characters can survive sanitization. */
const PATH_DATA_PATTERN = /^[A-Za-z0-9 ,.-]+$/;
const ALLOWED_STROKE_KEYS = ['kind', 'viewBox', 'paths'] as const;
const ALLOWED_PATH_KEYS = ['d', 'fill'] as const;
const ALLOWED_LUCIDE_KEYS = ['kind', 'icon'] as const;

function keysWithin(record: object, allowed: readonly string[]): boolean {
  return Object.keys(record).every((k) => allowed.includes(k));
}

describe('PROVIDER_MARKS', () => {
  it('tables the inlined provider ids from plan Decision 10', () => {
    for (const id of [
      'openrouter',
      'ollama',
      'ollama-cloud',
      'opencode',
      'pi',
      'ptah-cli',
    ]) {
      expect(PROVIDER_MARKS[id]?.kind).toBe('stroke');
    }
  });

  it('carries only sanitized fields on every record', () => {
    for (const [id, mark] of Object.entries(PROVIDER_MARKS)) {
      if (mark.kind === 'stroke') {
        expect(keysWithin(mark, ALLOWED_STROKE_KEYS)).toBe(true);
        expect(mark.viewBox).toMatch(VIEWBOX_PATTERN);
        expect(mark.paths.length).toBeGreaterThan(0);
        for (const path of mark.paths) {
          expect(keysWithin(path, ALLOWED_PATH_KEYS)).toBe(true);
          expect(path.fill).toBeNull();
          expect(path.d).toMatch(PATH_DATA_PATTERN);
          expect(path.d.startsWith('M')).toBe(true);
        }
      } else {
        expect(keysWithin(mark, ALLOWED_LUCIDE_KEYS)).toBe(true);
        expect(['Bot', 'Server', 'Terminal']).toContain(mark.icon);
      }
      expect(id.trim()).toBe(id);
    }
  });

  it('shares one mark across both Ollama entries and never duplicates markup', () => {
    expect(PROVIDER_MARKS['ollama']).toBe(PROVIDER_MARKS['ollama-cloud']);
  });

  it('pins lucide fallbacks by name, not by inlined markup', () => {
    const lucideEntries = Object.entries(PROVIDER_MARKS).filter(
      ([, mark]: [string, ProviderMark]) => mark.kind === 'lucide',
    );
    expect(lucideEntries).toEqual([
      ['lm-studio', { kind: 'lucide', icon: 'Server' }],
    ]);
  });

  it('holds no record for a provider drawn from vendored artwork (R1)', () => {
    for (const id of Object.keys(PROVIDER_BRAND_SLUGS)) {
      expect(Object.hasOwn(PROVIDER_MARKS, id)).toBe(false);
    }
  });
});

describe('strokeMark', () => {
  it('builds 24-grid stroke artwork with currentColor paths in order', () => {
    expect(strokeMark(['M1 1 L2 2', 'M3 3 L4 4'])).toEqual({
      viewBox: '0 0 24 24',
      kind: 'stroke',
      paths: [
        { d: 'M1 1 L2 2', fill: null },
        { d: 'M3 3 L4 4', fill: null },
      ],
    });
  });
});
