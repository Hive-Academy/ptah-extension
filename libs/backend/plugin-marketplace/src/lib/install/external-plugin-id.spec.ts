/**
 * The id parser is the last gate before an id becomes a filesystem path, so it
 * is tested as a gate: what it lets through, and what it must not.
 */

import * as path from 'path';
import {
  buildExternalPluginId,
  externalPluginDir,
  isExternalPluginId,
  parseExternalPluginId,
} from './external-plugin-id';

describe('external plugin ids', () => {
  const coordinate = {
    owner: 'dotnet',
    repo: 'skills',
    plugin: 'dotnet-test',
  };

  it('round-trips a coordinate', () => {
    const id = buildExternalPluginId(coordinate);

    expect(id).toBe('external:dotnet/skills/dotnet-test');
    expect(parseExternalPluginId(id)).toEqual(coordinate);
  });

  it('resolves to a nested directory under external/', () => {
    const dir = externalPluginDir('/home/u/.ptah/plugins', coordinate);

    expect(dir).toBe(
      path.join(
        '/home/u/.ptah/plugins',
        'external',
        'dotnet',
        'skills',
        'dotnet-test',
      ),
    );
  });

  it('does not treat bundled or harness ids as external', () => {
    expect(isExternalPluginId('ptah-core')).toBe(false);
    expect(isExternalPluginId('ptah-harness-release-notes')).toBe(false);
    expect(parseExternalPluginId('ptah-core')).toBeNull();
  });

  describe('rejects ids that would escape the external root', () => {
    it.each([
      ['parent traversal in owner', 'external:../../etc/passwd/x'],
      ['dot-dot owner', 'external:../skills/dotnet-test'],
      ['dot-dot repo', 'external:dotnet/../dotnet-test/x'],
      ['dot-dot plugin', 'external:dotnet/skills/..'],
      ['single dot plugin', 'external:dotnet/skills/.'],
      ['too few segments', 'external:dotnet/skills'],
      ['too many segments', 'external:dotnet/skills/a/b'],
      ['absolute smuggled in', 'external://etc/passwd'],
      ['backslash separator', 'external:dotnet\\skills\\x'],
      ['no prefix', 'dotnet/skills/dotnet-test'],
      ['empty segment', 'external:dotnet//dotnet-test'],
    ])('rejects %s', (_label, id) => {
      expect(parseExternalPluginId(id)).toBeNull();
    });

    it('never lets a rejected id reach a path', () => {
      const hostile = 'external:dotnet/skills/..';
      // The contract that matters: parse fails, so no caller has a coordinate
      // to hand to externalPluginDir in the first place.
      expect(parseExternalPluginId(hostile)).toBeNull();
    });
  });
});
