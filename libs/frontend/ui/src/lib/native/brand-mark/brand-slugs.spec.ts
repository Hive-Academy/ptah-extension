import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PTAH_CONNECTORS,
  normalizeServerKey,
  type McpInstallTarget,
} from '@ptah-extension/shared';

import { PROVIDER_MARKS } from '../provider-mark/provider-marks.data';
import { BRAND_MARKS, MONOGRAM_SLUGS } from './brand-marks.generated';
import { PROVIDER_BRAND_ART } from './provider-brand-art.generated';
import {
  CLI_TARGET_BRANDS,
  KNOWN_SERVER_BRANDS,
  LISTING_NAMESPACE_BRANDS,
  PROVIDER_BRAND_SLUGS,
  resolveInstalledBrandSlug,
  resolveListingBrandSlug,
  type InstalledBrandQuery,
  type ListingBrandQuery,
} from './brand-slugs';

/** A slug `ptah-brand-mark` can render: vendored artwork or a declared monogram. */
function isKnownSlug(slug: string): boolean {
  return Object.hasOwn(BRAND_MARKS, slug) || MONOGRAM_SLUGS.includes(slug);
}

describe('resolveInstalledBrandSlug', () => {
  describe('the prototype brief servers', () => {
    it.each<[string, InstalledBrandQuery, string | null]>([
      ['ptah', { serverKey: 'ptah' }, null],
      ['firecrawl', { serverKey: 'firecrawl' }, 'firecrawl'],
      ['davinci-resolve', { serverKey: 'davinci-resolve' }, 'davinci-resolve'],
      ['shopify-dev-mcp', { serverKey: 'shopify-dev-mcp' }, 'shopify'],
      ['node_repl', { serverKey: 'node_repl' }, 'nodedotjs'],
      ['sequential-thinking', { serverKey: 'sequential-thinking' }, null],
      ['angular-cli', { serverKey: 'angular-cli' }, 'angular'],
      ['chrome-devtools', { serverKey: 'chrome-devtools' }, 'google-chrome'],
      ['daisyui', { serverKey: 'daisyui' }, 'daisyui'],
      ['sentry (Claude CLI)', { serverKey: 'sentry' }, 'sentry'],
      ['sonarqube', { serverKey: 'sonarqube' }, 'sonarqube'],
      [
        'sentry (OAuth connector)',
        { serverKey: 'Sentry', serverUrl: 'https://mcp.sentry.dev/mcp' },
        'sentry',
      ],
    ])('%s → %s', (_row, query, expected) => {
      expect(resolveInstalledBrandSlug(query)).toBe(expected);
    });
  });

  describe('order', () => {
    it('1. a catalogue URL wins over the key', () => {
      expect(
        resolveInstalledBrandSlug({
          serverKey: 'firecrawl',
          serverUrl: 'https://mcp.notion.com/mcp',
        }),
      ).toBe('notion');
    });

    it('1. matches URLs the way the catalogue and manifests disagree (host case, trailing slash)', () => {
      expect(
        resolveInstalledBrandSlug({
          serverKey: 'my-custom-name',
          serverUrl: 'https://MCP.Linear.app/mcp/',
        }),
      ).toBe('linear');
    });

    it('1. returns the catalogue brand, not the connector id', () => {
      expect(
        resolveInstalledBrandSlug({
          serverKey: 'mail',
          serverUrl: 'https://server.smithery.ai/gmail/mcp',
        }),
      ).toBe('gmail');
    });

    it('2. falls through to the key when the URL is not in the catalogue', () => {
      expect(
        resolveInstalledBrandSlug({
          serverKey: 'linear',
          serverUrl: 'https://example.com/mcp',
        }),
      ).toBe('linear');
    });

    it('2. ignores a blank or unparsable URL', () => {
      expect(
        resolveInstalledBrandSlug({ serverKey: 'notion', serverUrl: '   ' }),
      ).toBe('notion');
      expect(
        resolveInstalledBrandSlug({ serverKey: 'notion', serverUrl: null }),
      ).toBe('notion');
      expect(
        resolveInstalledBrandSlug({
          serverKey: 'notion',
          serverUrl: 'not a url',
        }),
      ).toBe('notion');
    });

    it('2. normalises the key before matching a catalogue id', () => {
      expect(resolveInstalledBrandSlug({ serverKey: 'Google Calendar' })).toBe(
        'google-calendar',
      );
      expect(resolveInstalledBrandSlug({ serverKey: 'gmail-smithery' })).toBe(
        'gmail',
      );
    });

    it('3. matches a known server by its normalised key', () => {
      expect(resolveInstalledBrandSlug({ serverKey: 'Chrome DevTools' })).toBe(
        'google-chrome',
      );
    });

    it('4. tries the last "/" segment of a registry name', () => {
      expect(
        resolveInstalledBrandSlug({ serverKey: 'io.github.getsentry/sentry' }),
      ).toBe('sentry');
      expect(
        resolveInstalledBrandSlug({ serverKey: 'io.github.acme/notion' }),
      ).toBe('notion');
      expect(
        resolveInstalledBrandSlug({ serverKey: 'smithery-ai/node_repl' }),
      ).toBe('nodedotjs');
    });

    it('5. returns null for a registry name whose last segment names nothing', () => {
      expect(
        resolveInstalledBrandSlug({ serverKey: 'io.github.user/server' }),
      ).toBeNull();
    });

    it('returns null for an empty key, slashes alone, or an empty last segment', () => {
      expect(resolveInstalledBrandSlug({ serverKey: '' })).toBeNull();
      expect(resolveInstalledBrandSlug({ serverKey: '/' })).toBeNull();
      expect(resolveInstalledBrandSlug({ serverKey: '///' })).toBeNull();
      expect(
        resolveInstalledBrandSlug({ serverKey: 'io.github.user/' }),
      ).toBeNull();
    });

    it('never resolves an inherited Object key', () => {
      expect(
        resolveInstalledBrandSlug({ serverKey: 'constructor' }),
      ).toBeNull();
      expect(
        resolveInstalledBrandSlug({ serverKey: 'x/__proto__' }),
      ).toBeNull();
    });
  });

  it('trusts the user label on installed rows, unlike a listing name', () => {
    expect(resolveInstalledBrandSlug({ serverKey: 'smithery-ai/github' })).toBe(
      'github',
    );
    expect(resolveInstalledBrandSlug({ serverKey: 'my-github' })).toBeNull();
  });
});

describe('resolveListingBrandSlug', () => {
  describe('a name alone never earns a vendor mark', () => {
    it.each<[string, ListingBrandQuery]>([
      ['attacker/github', { registryName: 'attacker/github', remoteUrls: [] }],
      ['someone/notion', { registryName: 'someone/notion', remoteUrls: [] }],
      ['bare github', { registryName: 'github', remoteUrls: [] }],
      ['bare sentry', { registryName: 'sentry', remoteUrls: [] }],
      [
        'a known server name',
        { registryName: 'acme/shopify-dev-mcp', remoteUrls: [] },
      ],
      [
        'a catalogue id with an unrelated URL',
        {
          registryName: 'someone/linear',
          remoteUrls: ['https://evil.example.com/linear/mcp'],
        },
      ],
    ])('%s → null', (_case, query) => {
      expect(resolveListingBrandSlug(query)).toBeNull();
    });
  });

  describe('1. a remote URL equal to a catalogue URL', () => {
    it('brands the listing with the vendor it connects to', () => {
      expect(
        resolveListingBrandSlug({
          registryName: 'someone/any-name',
          remoteUrls: ['https://mcp.sentry.dev/mcp'],
        }),
      ).toBe('sentry');
    });

    it('checks every remote URL and ignores blank ones', () => {
      expect(
        resolveListingBrandSlug({
          registryName: 'someone/tools',
          remoteUrls: [
            '',
            '  ',
            'https://example.com/mcp',
            'https://mcp.notion.com/mcp/',
          ],
        }),
      ).toBe('notion');
    });

    it('works on a bare URL with no registry name (Custom URL suggestions)', () => {
      expect(
        resolveListingBrandSlug({
          remoteUrls: ['https://MCP.Linear.app/mcp'],
        }),
      ).toBe('linear');
      expect(
        resolveListingBrandSlug({
          registryName: null,
          remoteUrls: ['https://server.smithery.ai/gmail/mcp'],
        }),
      ).toBe('gmail');
    });

    it('wins over the namespace', () => {
      expect(
        resolveListingBrandSlug({
          registryName: 'io.github.getsentry/tools',
          remoteUrls: ['https://mcp.linear.app/mcp'],
        }),
      ).toBe('linear');
    });
  });

  describe('2. an allowlisted namespace', () => {
    it('brands a listing published in the vendor namespace', () => {
      expect(
        resolveListingBrandSlug({
          registryName: 'io.github.getsentry/sentry',
          remoteUrls: [],
        }),
      ).toBe('sentry');
    });

    it('case-folds the namespace and takes everything before the last "/"', () => {
      expect(
        resolveListingBrandSlug({
          registryName: 'IO.GitHub.GetSentry/sentry-mcp',
          remoteUrls: [],
        }),
      ).toBe('sentry');
      expect(
        resolveListingBrandSlug({
          registryName: 'io.github.getsentry.evil/sentry',
          remoteUrls: [],
        }),
      ).toBeNull();
      expect(
        resolveListingBrandSlug({
          registryName: 'evil/io.github.getsentry/sentry',
          remoteUrls: [],
        }),
      ).toBeNull();
    });
  });

  it('3. returns null for empty input and inherited Object keys', () => {
    expect(resolveListingBrandSlug({ remoteUrls: [] })).toBeNull();
    expect(
      resolveListingBrandSlug({ registryName: '/sentry', remoteUrls: [] }),
    ).toBeNull();
    expect(
      resolveListingBrandSlug({
        registryName: 'constructor/x',
        remoteUrls: [],
      }),
    ).toBeNull();
  });

  it('keeps each resolver behind its own input type', () => {
    // Compile-time pins (checked by `tsc -p libs/frontend/ui/tsconfig.spec.json`,
    // not by jest). Never called: only the types are under test.
    const misuse = (): void => {
      const installedRow = { serverKey: 'github', serverUrl: null };
      const listing = { registryName: 'attacker/github', remoteUrls: [] };
      // @ts-expect-error — an installed row cannot take the listing path.
      resolveListingBrandSlug(installedRow);
      // @ts-expect-error — a listing cannot take the permissive installed path.
      resolveInstalledBrandSlug(listing);
    };
    expect(misuse).toBeInstanceOf(Function);
  });
});

describe('LISTING_NAMESPACE_BRANDS', () => {
  it('names only vendored artwork, keyed by case-folded namespace', () => {
    for (const [namespace, slug] of Object.entries(LISTING_NAMESPACE_BRANDS)) {
      expect(namespace).toBe(namespace.toLowerCase());
      expect(namespace).not.toContain('/');
      expect(Object.hasOwn(BRAND_MARKS, slug)).toBe(true);
    }
  });

  it('gives every entry an evidence comment', () => {
    const source = readFileSync(join(__dirname, 'brand-slugs.ts'), 'utf8');
    const table = source.slice(
      source.indexOf('export const LISTING_NAMESPACE_BRANDS'),
    );
    const body = table.slice(0, table.indexOf('};'));
    const lines = body.split('\n');
    for (const namespace of Object.keys(LISTING_NAMESPACE_BRANDS)) {
      const index = lines.findIndex((line) =>
        line.trimStart().startsWith(`'${namespace}':`),
      );
      expect(index).toBeGreaterThan(0);
      expect(lines[index - 1].trim()).toMatch(/^\/\//);
    }
  });
});

describe('brand slug tables', () => {
  it('every catalogue brandSlug is vendored artwork or a declared monogram', () => {
    const unknown = PTAH_CONNECTORS.filter((c) => !isKnownSlug(c.brandSlug));
    expect(unknown.map((c) => `${c.id} → ${c.brandSlug}`)).toEqual([]);
  });

  it('every known-server slug is vendored artwork (not a monogram)', () => {
    const missing = Object.entries(KNOWN_SERVER_BRANDS).filter(
      ([, slug]) => !Object.hasOwn(BRAND_MARKS, slug),
    );
    expect(missing).toEqual([]);
  });

  it('keys the known servers in normalised form, so lookups can hit them', () => {
    for (const key of Object.keys(KNOWN_SERVER_BRANDS)) {
      expect(normalizeServerKey(key)).toBe(key);
    }
  });

  it('never gives a catalogue id a different brand in the known-server table', () => {
    const conflicts = PTAH_CONNECTORS.filter(
      (c) =>
        Object.hasOwn(KNOWN_SERVER_BRANDS, c.id) &&
        KNOWN_SERVER_BRANDS[c.id] !== c.brandSlug,
    );
    expect(conflicts.map((c) => c.id)).toEqual([]);
  });

  it('covers every CLI install target with a mark that exists', () => {
    const targets: readonly McpInstallTarget[] = [
      'vscode',
      'claude',
      'cursor',
      'copilot',
      'codex',
      'antigravity',
      'opencode',
    ];
    expect(Object.keys(CLI_TARGET_BRANDS).sort()).toEqual([...targets].sort());
    for (const target of targets) {
      const mark = CLI_TARGET_BRANDS[target];
      if (mark.kind === 'brand') {
        expect(isKnownSlug(mark.brandSlug)).toBe(true);
      } else {
        // Presence only: the record's internal shape changes in Batch 7c.
        expect(Object.hasOwn(PROVIDER_MARKS, mark.providerId)).toBe(true);
      }
    }
  });

  it('uses real vendor marks for the CLI targets (R1)', () => {
    expect(CLI_TARGET_BRANDS.claude).toEqual({
      kind: 'brand',
      brandSlug: 'claude',
    });
    expect(CLI_TARGET_BRANDS.codex).toEqual({
      kind: 'brand',
      brandSlug: 'openai',
    });
    expect(CLI_TARGET_BRANDS.copilot).toEqual({
      kind: 'brand',
      brandSlug: 'github-copilot',
    });
    expect(CLI_TARGET_BRANDS.antigravity).toEqual({
      kind: 'brand',
      brandSlug: 'google',
    });
    expect(CLI_TARGET_BRANDS.opencode).toEqual({
      kind: 'provider-mark',
      providerId: 'opencode',
    });
  });

  it('pins the VS Code shortfall: its slug is a declared monogram until artwork exists', () => {
    expect(CLI_TARGET_BRANDS.vscode).toEqual({
      kind: 'brand',
      brandSlug: 'visual-studio-code',
    });
    expect(MONOGRAM_SLUGS).toContain('visual-studio-code');
  });

  it('maps provider ids to slugs present in the small provider art subset', () => {
    expect(PROVIDER_BRAND_SLUGS).toEqual({
      anthropic: 'anthropic',
      'claude-cli': 'claude',
    });
    for (const slug of Object.values(PROVIDER_BRAND_SLUGS)) {
      expect(Object.hasOwn(PROVIDER_BRAND_ART, slug)).toBe(true);
    }
  });

  it('keeps vendored artwork and monograms disjoint', () => {
    expect(MONOGRAM_SLUGS.filter((s) => Object.hasOwn(BRAND_MARKS, s))).toEqual(
      [],
    );
  });
});
