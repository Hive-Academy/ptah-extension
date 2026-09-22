import { PROVIDER_MARKS, type ProviderMark } from './provider-marks.data';

const VIEWBOX_PATTERN = /^[0-9.]+ [0-9.]+ [0-9.]+ [0-9.]+$/;
/** Path data only — no markup characters can survive sanitization. */
const PATH_DATA_PATTERN = /^[A-Za-z0-9 ,.-]+$/;
const ALLOWED_RECORD_KEYS = ['kind', 'viewBox', 'd', 'icon'] as const;

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
      expect(PROVIDER_MARKS[id]).toBeDefined();
    }
  });

  it('carries only sanitized fields on every record', () => {
    for (const [id, mark] of Object.entries(PROVIDER_MARKS)) {
      const keys = Object.keys(mark);
      expect(
        keys.every((k) =>
          (ALLOWED_RECORD_KEYS as readonly string[]).includes(k),
        ),
      ).toBe(true);
      if (mark.kind === 'path') {
        expect(mark.viewBox).toMatch(VIEWBOX_PATTERN);
        expect(mark.d.length).toBeGreaterThan(0);
        for (const segment of mark.d) {
          expect(segment).toMatch(PATH_DATA_PATTERN);
          expect(segment.startsWith('M')).toBe(true);
        }
      } else {
        expect(['Bot', 'Server', 'Terminal']).toContain(mark.icon);
      }
      expect(id.trim()).toBe(id);
    }
  });

  it('shares one mark across both Ollama entries and never duplicates markup', () => {
    expect((PROVIDER_MARKS['ollama'] as { d: readonly string[] }).d).toBe(
      (PROVIDER_MARKS['ollama-cloud'] as { d: readonly string[] }).d,
    );
  });

  it('pins lucide fallbacks by name, not by inlined markup', () => {
    const lucideEntries = Object.entries(PROVIDER_MARKS).filter(
      ([, mark]: [string, ProviderMark]) => mark.kind === 'lucide',
    );
    expect(lucideEntries.length).toBeGreaterThan(0);
    for (const [, mark] of lucideEntries) {
      if (mark.kind === 'lucide') expect(typeof mark.icon).toBe('string');
    }
  });
});
