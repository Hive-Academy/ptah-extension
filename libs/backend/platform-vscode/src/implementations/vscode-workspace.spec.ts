/**
 * `VscodeWorkspaceProvider` — contract against `IWorkspaceProvider`.
 *
 * The provider constructs a `PtahFileSettingsManager` which reads/writes
 * `~/.ptah/settings.json`. We redirect `HOME` / `USERPROFILE` to an isolated
 * temp directory per test run so concurrent CI workers do not stomp each
 * other and the developer's real settings file stays untouched.
 *
 * File-based settings (anything in `FILE_BASED_SETTINGS_KEYS`) route through
 * that file manager; all other settings go through the mock's
 * `vscode.workspace.getConfiguration` stateful store. Both paths are exercised.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runWorkspaceContract } from '@ptah-extension/platform-core/testing';
import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

// ---------------------------------------------------------------------------
// Redirect HOME to an isolated temp dir BEFORE the impl is imported — the
// PtahFileSettingsManager picks up homedir() at construction time.
// ---------------------------------------------------------------------------

const TEST_HOME = fs.mkdtempSync(
  path.join(os.tmpdir(), 'ptah-vscode-workspace-spec-'),
);
const prevHome = process.env['HOME'];
const prevUserProfile = process.env['USERPROFILE'];
process.env['HOME'] = TEST_HOME;
process.env['USERPROFILE'] = TEST_HOME;

afterAll(() => {
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
  if (prevUserProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = prevUserProfile;
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

import { VscodeWorkspaceProvider } from './vscode-workspace-provider';

beforeEach(() => {
  __resetVscodeTestDouble();
  // Clean ~/.ptah between tests so file-based settings do not bleed across cases.
  const dir = path.join(TEST_HOME, '.ptah');
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

runWorkspaceContract('VscodeWorkspaceProvider', () => {
  const provider = new VscodeWorkspaceProvider();
  return {
    provider,
    seed({ folders, config }) {
      if (folders) __vscodeState.setWorkspaceFolders(folders);
      if (config) {
        for (const [fullKey, value] of Object.entries(config)) {
          __vscodeState.config.set(fullKey, value);
        }
      }
    },
  };
});

describe('VscodeWorkspaceProvider — VS Code-specific behaviour', () => {
  let provider: VscodeWorkspaceProvider;

  beforeEach(() => {
    provider = new VscodeWorkspaceProvider();
  });

  afterEach(() => {
    provider.dispose();
  });

  it('routes FILE_BASED_SETTINGS_KEYS to PtahFileSettingsManager (not vscode config)', async () => {
    // `authMethod` is in FILE_BASED_SETTINGS_KEYS — write must NOT touch
    // the vscode config map, only the file-based manager.
    await provider.setConfiguration('ptah', 'authMethod', 'oauth');
    expect(__vscodeState.config.has('ptah.authMethod')).toBe(false);
    expect(provider.getConfiguration('ptah', 'authMethod')).toBe('oauth');
  });

  it('routes non-file-based keys through vscode.workspace.getConfiguration', async () => {
    await provider.setConfiguration('ptah', 'regularSetting', 'value');
    expect(__vscodeState.config.get('ptah.regularSetting')).toBe('value');
    expect(provider.getConfiguration('ptah', 'regularSetting')).toBe('value');
  });

  it('fires onDidChangeConfiguration with the right section for file-based writes', async () => {
    const seen: string[] = [];
    const sub = provider.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ptah.authMethod'))
        seen.push('ptah.authMethod');
    });
    await provider.setConfiguration('ptah', 'authMethod', 'apiKey');
    sub.dispose();
    expect(seen).toContain('ptah.authMethod');
  });

  it('getWorkspaceRoot returns the first workspace folder', () => {
    __vscodeState.setWorkspaceFolders(['/root/one', '/root/two']);
    expect(provider.getWorkspaceRoot()).toBe('/root/one');
  });
});
