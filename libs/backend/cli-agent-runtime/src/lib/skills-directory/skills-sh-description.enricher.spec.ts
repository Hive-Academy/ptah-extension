import {
  SkillsShDescriptionEnricher,
  parseSkillMdDescription,
} from './skills-sh-description.enricher';
import type { SkillShEntry } from '@ptah-extension/shared';

function makeEntry(over: Partial<SkillShEntry> = {}): SkillShEntry {
  return {
    source: 'cloudai-x/threejs-skills',
    skillId: 'threejs-shaders',
    name: 'Threejs Shaders',
    description: '',
    installs: 9016,
    isInstalled: false,
    ...over,
  };
}

describe('parseSkillMdDescription', () => {
  it('reads a plain scalar description', () => {
    expect(
      parseSkillMdDescription(
        '---\nname: threejs-shaders\ndescription: GLSL and ShaderMaterial.\n---\n\n# Body',
      ),
    ).toBe('GLSL and ShaderMaterial.');
  });

  it('strips matching quotes', () => {
    expect(
      parseSkillMdDescription('---\ndescription: "Quoted text."\n---\n'),
    ).toBe('Quoted text.');
  });

  it('joins a >- block scalar, which is how a description containing a colon must be written', () => {
    expect(
      parseSkillMdDescription(
        '---\ndescription: >-\n  Use when: writing fragment\n  shaders.\nname: x\n---\n',
      ),
    ).toBe('Use when: writing fragment shaders.');
  });

  it('returns empty for a file with no frontmatter', () => {
    expect(parseSkillMdDescription('# Just a heading\n')).toBe('');
  });

  it('returns empty when the frontmatter has no description key', () => {
    expect(parseSkillMdDescription('---\nname: x\n---\n')).toBe('');
  });
});

describe('SkillsShDescriptionEnricher', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fills the description from the first candidate path that answers', async () => {
    const fetchMock = jest.fn(async (url: unknown) => {
      if (String(url).includes('/skills/threejs-shaders/SKILL.md')) {
        return {
          ok: true,
          status: 200,
          text: async () => '---\ndescription: Custom visual effects.\n---\n',
        };
      }
      return { ok: false, status: 404, text: async () => '' };
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const entries = [makeEntry()];
    await new SkillsShDescriptionEnricher().enrich(entries);

    expect(entries[0].description).toBe('Custom visual effects.');
  });

  it('falls through to the root layout when the skills/ path 404s', async () => {
    const fetchMock = jest.fn(async (url: unknown) => {
      if (String(url).endsWith('/HEAD/threejs-shaders/SKILL.md')) {
        return {
          ok: true,
          status: 200,
          text: async () => '---\ndescription: Root layout.\n---\n',
        };
      }
      return { ok: false, status: 404, text: async () => '' };
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const entries = [makeEntry()];
    await new SkillsShDescriptionEnricher().enrich(entries);

    expect(entries[0].description).toBe('Root layout.');
  });

  it('leaves the description blank and never throws when every probe fails', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(
        new Error('offline'),
      ) as unknown as typeof globalThis.fetch;

    const entries = [makeEntry()];
    await expect(
      new SkillsShDescriptionEnricher().enrich(entries),
    ).resolves.toBeUndefined();
    expect(entries[0].description).toBe('');
  });

  it('caches the miss so a repeat search does not re-probe', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => '',
    }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const enricher = new SkillsShDescriptionEnricher();
    await enricher.enrich([makeEntry()]);
    const afterFirst = fetchMock.mock.calls.length;
    await enricher.enrich([makeEntry()]);

    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });

  it('skips entries that already carry a description', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await new SkillsShDescriptionEnricher().enrich([
      makeEntry({ description: 'already known' }),
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to build a URL from a source that is not owner/repo', async () => {
    // `source` is interpolated into a raw.githubusercontent.com path, so a
    // traversal or absolute-looking value must never reach fetch.
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const entries = [makeEntry({ source: '../../evil' })];
    await new SkillsShDescriptionEnricher().enrich(entries);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(entries[0].description).toBe('');
  });

  it('probes only the top N entries', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => '',
    }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry({ skillId: `skill-${i}` }),
    );
    await new SkillsShDescriptionEnricher().enrich(entries, 3);

    // 3 entries x 2 candidate paths.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
