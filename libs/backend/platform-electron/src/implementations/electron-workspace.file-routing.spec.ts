/**
 * ElectronWorkspaceProvider FILE_BASED_SETTINGS_KEYS routing — behavioral test.
 *
 * Verifies that keys in FILE_BASED_SETTINGS_KEYS (e.g. provider.apiKey.selectedModel)
 * are written to ~/.ptah/settings.json via PtahFileSettingsManager, while
 * non-file-based keys land in config.json.
 *
 * Sanity check: short-circuit isFileBasedSettingKey to always return false →
 * the file-based key must appear in config.json instead of settings.json.
 *
 * We redirect os.homedir() to an isolated tmp dir BEFORE any module that
 * calls homedir() at construction time (PtahFileSettingsManager) is imported.
 * jest.mock() is hoisted above all imports by Jest's transform pipeline.
 */

import 'reflect-metadata';
import * as nodePath from 'path';
import * as nodeOs from 'os';
import * as nodeFs from 'fs';

// ---------------------------------------------------------------------------
// Redirect os.homedir() to an isolated tmp dir BEFORE the impl modules load.
// PtahFileSettingsManager captures homedir() in its constructor, so the mock
// must be in place when the class is first instantiated.
// ---------------------------------------------------------------------------

const mockHome = nodeFs.mkdtempSync(
  nodePath.join(nodeOs.tmpdir(), 'ptah-electron-file-routing-'),
);

jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => mockHome,
  };
});

afterAll(() => {
  try {
    nodeFs.rmSync(mockHome, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

// ---------------------------------------------------------------------------
// Imports (loaded AFTER the jest.mock hoisting takes effect).
// ---------------------------------------------------------------------------

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { isFileBasedSettingKey } from '@ptah-extension/platform-core';
import { ElectronWorkspaceProvider } from './electron-workspace-provider';

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-electron-fr-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* swallow */
    });
  }
  // Clean up the .ptah dir in the mock home between tests.
  const ptahDir = path.join(mockHome, '.ptah');
  if (nodeFs.existsSync(ptahDir)) {
    nodeFs.rmSync(ptahDir, { recursive: true, force: true });
  }
});

describe('ElectronWorkspaceProvider FILE_BASED_SETTINGS_KEYS disk routing', () => {
  it('a file-based key (provider.apiKey.selectedModel) is written to ~/.ptah/settings.json and NOT to config.json', async () => {
    const storage = await makeTempDir();
    const provider = new ElectronWorkspaceProvider(storage);

    // provider.apiKey.selectedModel is a known FILE_BASED_SETTINGS_KEY.
    const fileBasedKey = 'provider.apiKey.selectedModel';
    expect(isFileBasedSettingKey(fileBasedKey)).toBe(true);

    await provider.setConfiguration('ptah', fileBasedKey, 'sonnet-4');

    // 1. settings.json must contain the value.
    const settingsPath = path.join(mockHome, '.ptah', 'settings.json');
    expect(nodeFs.existsSync(settingsPath)).toBe(true);
    const settingsRaw = nodeFs.readFileSync(settingsPath, 'utf-8');
    const settingsParsed = JSON.parse(settingsRaw) as Record<string, unknown>;
    // The file uses nested format: provider.apiKey.selectedModel → provider.apiKey.selectedModel
    // PtahFileSettingsManager stores flat keys in nested JSON.
    // Flatten the parsed object to check the flat key.
    expect(JSON.stringify(settingsParsed)).toContain('sonnet-4');

    // 2. config.json must NOT contain the file-based key.
    const configPath = path.join(storage, 'config.json');
    if (nodeFs.existsSync(configPath)) {
      const configRaw = nodeFs.readFileSync(configPath, 'utf-8');
      expect(configRaw).not.toContain('sonnet-4');
      expect(configRaw).not.toContain(fileBasedKey);
    }
    // If config.json doesn't exist, the file-based key definitely isn't there.
  });

  it('a non-file-based key (telemetry) is written to config.json and NOT to settings.json', async () => {
    const storage = await makeTempDir();
    const provider = new ElectronWorkspaceProvider(storage);

    const nonFileBasedKey = 'telemetry';
    expect(isFileBasedSettingKey(nonFileBasedKey)).toBe(false);

    await provider.setConfiguration('ptah', nonFileBasedKey, true);

    // 1. config.json must contain the value.
    const configPath = path.join(storage, 'config.json');
    expect(nodeFs.existsSync(configPath)).toBe(true);
    const configRaw = nodeFs.readFileSync(configPath, 'utf-8');
    const configParsed = JSON.parse(configRaw) as Record<
      string,
      Record<string, unknown>
    >;
    expect(configParsed['ptah']?.['telemetry']).toBe(true);

    // 2. settings.json must NOT contain the non-file-based key.
    const settingsPath = path.join(mockHome, '.ptah', 'settings.json');
    if (nodeFs.existsSync(settingsPath)) {
      const settingsRaw = nodeFs.readFileSync(settingsPath, 'utf-8');
      expect(settingsRaw).not.toContain('telemetry');
    }
  });

  it('getConfiguration reads a file-based key back from the settings manager', async () => {
    const storage = await makeTempDir();
    const provider = new ElectronWorkspaceProvider(storage);

    await provider.setConfiguration(
      'ptah',
      'provider.apiKey.selectedModel',
      'claude-opus',
    );

    const value = provider.getConfiguration<string>(
      'ptah',
      'provider.apiKey.selectedModel',
    );
    expect(value).toBe('claude-opus');
  });

  it('file-based key goes to settings.json while a second non-file-based key goes to config.json — both coexist', async () => {
    const storage = await makeTempDir();
    const provider = new ElectronWorkspaceProvider(storage);

    // Write one of each kind.
    await provider.setConfiguration(
      'ptah',
      'provider.apiKey.selectedModel',
      'haiku-3',
    );
    await provider.setConfiguration('ptah', 'debugMode', true);

    // File-based key in settings.json.
    const settingsPath = path.join(mockHome, '.ptah', 'settings.json');
    expect(nodeFs.existsSync(settingsPath)).toBe(true);
    expect(nodeFs.readFileSync(settingsPath, 'utf-8')).toContain('haiku-3');

    // Non-file-based key in config.json.
    const configPath = path.join(storage, 'config.json');
    expect(nodeFs.existsSync(configPath)).toBe(true);
    const configParsed = JSON.parse(
      nodeFs.readFileSync(configPath, 'utf-8'),
    ) as Record<string, Record<string, unknown>>;
    expect(configParsed['ptah']?.['debugMode']).toBe(true);

    // Inverse: non-file-based key NOT in settings.json.
    expect(nodeFs.readFileSync(settingsPath, 'utf-8')).not.toContain(
      'debugMode',
    );
    // Inverse: file-based key NOT in config.json.
    expect(nodeFs.readFileSync(configPath, 'utf-8')).not.toContain('haiku-3');
  });
});
