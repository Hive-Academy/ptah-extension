/**
 * `workspacePluginsDir` — the ONE definition of `{ws}/.ptah/plugins`.
 *
 * It is spelled here rather than at each call site because the plugin loader
 * SCANS that directory and `ptah.harness.createSkill` WRITES into it. Two
 * hand-rolled joins is how those drift and a created skill lands somewhere
 * nothing discovers.
 */

import {
  WORKSPACE_PLUGINS_DIR_SEGMENTS,
  workspacePluginsDir,
} from './origin-sidecar.types';

describe('workspacePluginsDir', () => {
  it('appends .ptah/plugins to the workspace root', () => {
    expect(workspacePluginsDir('/home/me/project')).toBe(
      '/home/me/project/.ptah/plugins',
    );
  });

  it('accepts a Windows root', () => {
    expect(workspacePluginsDir('D:\\projects\\ptah')).toBe(
      'D:\\projects\\ptah/.ptah/plugins',
    );
  });

  it('does not double a trailing separator', () => {
    expect(workspacePluginsDir('/home/me/project/')).toBe(
      '/home/me/project/.ptah/plugins',
    );
    expect(workspacePluginsDir('D:\\projects\\ptah\\')).toBe(
      'D:\\projects\\ptah/.ptah/plugins',
    );
  });

  it('returns null for an absent or blank root rather than inventing a path', () => {
    // The honest answer for a host with no folder open — the caller must then
    // refuse a workspace-scoped write.
    expect(workspacePluginsDir(undefined)).toBeNull();
    expect(workspacePluginsDir(null)).toBeNull();
    expect(workspacePluginsDir('')).toBeNull();
    expect(workspacePluginsDir('   ')).toBeNull();
  });

  it('is built from the exported segments', () => {
    expect([...WORKSPACE_PLUGINS_DIR_SEGMENTS]).toEqual(['.ptah', 'plugins']);
  });
});
