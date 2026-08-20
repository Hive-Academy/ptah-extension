/**
 * The manifest boundary is the first place hostile remote data is stopped.
 *
 * These tests are written as ATTACKS, not as happy paths with a couple of
 * negatives bolted on: every rejection case below is a string that, if it got
 * through, would end up in `path.join` or in a URL.
 */

import { MarketplaceManifestSchema } from './marketplace-manifest.schema';

/** A minimal manifest with one plugin, overridable per test. */
function manifest(pluginOverrides: Record<string, unknown> = {}): unknown {
  return {
    name: 'dotnet-agent-skills',
    owner: 'dotnet',
    plugins: [
      {
        name: 'dotnet-test',
        source: './plugins/dotnet-test',
        description: 'Run and debug .NET tests',
        ...pluginOverrides,
      },
    ],
  };
}

describe('MarketplaceManifestSchema', () => {
  describe('accepts real-world shapes', () => {
    it('parses a dotnet/skills-shaped manifest', () => {
      const result = MarketplaceManifestSchema.safeParse(manifest());

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.name).toBe('dotnet-agent-skills');
      expect(result.data.plugins).toHaveLength(1);
    });

    it('normalizes the leading "./" off a plugin source', () => {
      const result = MarketplaceManifestSchema.safeParse(manifest());

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.plugins[0].source).toBe('plugins/dotnet-test');
    });

    it('accepts an object-shaped owner and normalizes it to a string', () => {
      const result = MarketplaceManifestSchema.safeParse({
        name: 'pack',
        owner: { name: '.NET Foundation', email: 'x@y.z' },
        plugins: [{ name: 'a', source: 'plugins/a' }],
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.owner).toBe('.NET Foundation');
    });

    it('keeps mcpServers verbatim so consent can render the real command', () => {
      const result = MarketplaceManifestSchema.safeParse(
        manifest({
          mcpServers: {
            binlog: {
              command: 'dotnet',
              args: [
                'dnx',
                'Microsoft.AITools.BinlogMcp',
                '--yes',
                '--prerelease',
              ],
            },
          },
        }),
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.plugins[0].mcpServers?.['binlog']).toEqual({
        command: 'dotnet',
        args: ['dnx', 'Microsoft.AITools.BinlogMcp', '--yes', '--prerelease'],
      });
    });

    it('tolerates unknown top-level and per-plugin keys', () => {
      const result = MarketplaceManifestSchema.safeParse({
        ...(manifest() as Record<string, unknown>),
        $schema: 'https://example.com/schema.json',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('rejects malformed documents', () => {
    it.each([
      ['not an object', 42],
      ['missing name', { plugins: [{ name: 'a', source: 'plugins/a' }] }],
      ['missing plugins', { name: 'pack' }],
      ['empty plugins array', { name: 'pack', plugins: [] }],
      ['plugins is not an array', { name: 'pack', plugins: {} }],
      [
        'plugin entry missing source',
        { name: 'pack', plugins: [{ name: 'a' }] },
      ],
      [
        'plugin source is not a string',
        { name: 'pack', plugins: [{ name: 'a', source: { repo: 'a/b' } }] },
      ],
      [
        'mcp server without a command',
        {
          name: 'pack',
          plugins: [
            { name: 'a', source: 'plugins/a', mcpServers: { x: { args: [] } } },
          ],
        },
      ],
    ])('rejects %s', (_label, document) => {
      expect(MarketplaceManifestSchema.safeParse(document).success).toBe(false);
    });
  });

  describe('rejects path traversal in plugin.source', () => {
    it.each([
      ['parent traversal', '../../../etc/passwd'],
      ['embedded traversal', 'plugins/../../secrets'],
      ['dot-dot segment only', '..'],
      ['posix absolute', '/etc/passwd'],
      ['windows drive-qualified', 'C:/Windows/System32'],
      ['unc-ish backslash traversal', '..\\..\\Windows'],
      ['http url', 'https://evil.example.com/payload'],
      ['file url', 'file:///etc/passwd'],
      ['segment with a separator smuggled in', 'plugins/a:b'],
    ])('rejects %s', (_label, source) => {
      const result = MarketplaceManifestSchema.safeParse(manifest({ source }));
      expect(result.success).toBe(false);
    });
  });

  describe('rejects path traversal in plugin.name', () => {
    it.each([
      ['parent traversal', '../evil'],
      ['bare dot-dot', '..'],
      ['bare dot', '.'],
      ['nested path', 'a/b'],
      ['windows separator', 'a\\b'],
      ['null byte', 'a\u0000b'],
      ['empty', ''],
    ])('rejects %s', (_label, name) => {
      const result = MarketplaceManifestSchema.safeParse(manifest({ name }));
      expect(result.success).toBe(false);
    });
  });
});
