import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runV4Migration } from './v4-migration';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-v4-migration-'));
}

function writeSettingsFile(dir: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), content, 'utf-8');
}

function readSettings(dir: string): string {
  return fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8');
}

function settingsExists(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'settings.json'));
}

function tmpExists(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'settings.v4.tmp'));
}

// ============================================================================
// V4-1 — Idempotency: second run is a true no-op
// ============================================================================

describe('V4-1 — Idempotency: second runV4Migration is a true no-op', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('second run produces no write (file content unchanged after first run)', async () => {
    writeSettingsFile(
      tmpDir,
      JSON.stringify({
        version: 1,
        authMethod: 'apiKey',
      }),
    );

    await runV4Migration(tmpDir);

    const afterFirst = readSettings(tmpDir);
    const parsed = JSON.parse(afterFirst) as Record<string, unknown>;
    expect(
      (parsed['__migrations'] as Record<string, unknown>)['v4'],
    ).toBeDefined();

    await runV4Migration(tmpDir);

    const afterSecond = readSettings(tmpDir);
    expect(afterSecond).toBe(afterFirst);
  });

  it('provenance marker is present after the first run', async () => {
    writeSettingsFile(
      tmpDir,
      JSON.stringify({
        version: 1,
        authMethod: 'apiKey',
      }),
    );

    await runV4Migration(tmpDir);

    const raw = readSettings(tmpDir);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const migrations = parsed['__migrations'] as Record<string, unknown>;
    expect(migrations).toBeDefined();
    const v4 = migrations['v4'] as Record<string, unknown>;
    expect(v4['normalizedWorkspaceTier']).toBe(true);
  });

  it('no settings.v4.tmp file lingers after successful run', async () => {
    writeSettingsFile(
      tmpDir,
      JSON.stringify({
        version: 1,
        authMethod: 'apiKey',
      }),
    );

    await runV4Migration(tmpDir);

    expect(tmpExists(tmpDir)).toBe(false);
  });

  it('no settings.v4.tmp file lingers after the second (no-op) run', async () => {
    writeSettingsFile(
      tmpDir,
      JSON.stringify({
        version: 1,
        authMethod: 'apiKey',
      }),
    );

    await runV4Migration(tmpDir, 'app.vscode');
    await runV4Migration(tmpDir, 'app.vscode');

    expect(tmpExists(tmpDir)).toBe(false);
  });
});

// ============================================================================
// V4-2 — Zero-loss: workspace.* keys are left in place
// ============================================================================

describe('V4-2 — Zero-loss: workspace.<hash>.* keys survive unchanged', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('workspace.<hash>.* keys are NOT moved, deleted, or duplicated', async () => {
    const original = {
      version: 1,
      authMethod: 'apiKey',
      workspace: {
        ab12cd34ef56ab12: {
          authMethod: 'claudeCli',
          provider: {
            apiKey: {
              selectedModel: 'claude-opus-4-5',
            },
          },
        },
      },
    };

    writeSettingsFile(tmpDir, JSON.stringify(original));

    await runV4Migration(tmpDir);

    const raw = readSettings(tmpDir);
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const ws = parsed['workspace'] as Record<string, unknown>;
    expect(ws).toBeDefined();
    const hash = ws['ab12cd34ef56ab12'] as Record<string, unknown>;
    expect(hash).toBeDefined();
    expect(hash['authMethod']).toBe('claudeCli');
    const provider = hash['provider'] as Record<string, unknown>;
    expect(provider).toBeDefined();
    const apiKey = provider['apiKey'] as Record<string, unknown>;
    expect(apiKey['selectedModel']).toBe('claude-opus-4-5');
  });

  it('only the __migrations.v4.normalizedWorkspaceTier marker is added', async () => {
    const original = {
      version: 1,
      authMethod: 'apiKey',
      workspace: {
        deadbeefcafe0001: {
          anthropicProviderId: 'claude',
        },
      },
    };

    writeSettingsFile(tmpDir, JSON.stringify(original));

    await runV4Migration(tmpDir);

    const raw = readSettings(tmpDir);
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const allKeys = Object.keys(parsed);
    expect(allKeys).toContain('__migrations');
    expect(allKeys).toContain('version');
    expect(allKeys).toContain('authMethod');
    expect(allKeys).toContain('workspace');
    expect(allKeys.filter((k) => k.startsWith('app.'))).toHaveLength(0);
  });

  it('global keys are preserved unchanged by the migration', async () => {
    const original = {
      version: 1,
      authMethod: 'thirdParty',
      anthropicProviderId: 'openrouter',
    };

    writeSettingsFile(tmpDir, JSON.stringify(original));

    await runV4Migration(tmpDir);

    const raw = readSettings(tmpDir);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['authMethod']).toBe('thirdParty');
    expect(parsed['anthropicProviderId']).toBe('openrouter');
  });
});

// ============================================================================
// V4-3 — hasPathConflict guard: non-object at __migrations is preserved
// ============================================================================

describe('V4-3 — hasPathConflict guard: non-object __migrations value is preserved', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('string __migrations value → migration returns without writing; user value survives', async () => {
    const original = {
      version: 1,
      authMethod: 'apiKey',
      __migrations: 'legacy-string-value',
    };

    writeSettingsFile(tmpDir, JSON.stringify(original));
    const before = readSettings(tmpDir);

    await runV4Migration(tmpDir);

    const after = readSettings(tmpDir);
    expect(after).toBe(before);
    const parsed = JSON.parse(after) as Record<string, unknown>;
    expect(parsed['__migrations']).toBe('legacy-string-value');
  });

  it('numeric __migrations value → not overwritten', async () => {
    const original = {
      version: 1,
      __migrations: 42,
    };

    writeSettingsFile(tmpDir, JSON.stringify(original));
    const before = readSettings(tmpDir);

    await runV4Migration(tmpDir);

    const after = readSettings(tmpDir);
    expect(after).toBe(before);
  });

  it('boolean __migrations value → not overwritten', async () => {
    const original = {
      version: 1,
      __migrations: false,
    };

    writeSettingsFile(tmpDir, JSON.stringify(original));
    const before = readSettings(tmpDir);

    await runV4Migration(tmpDir);

    const after = readSettings(tmpDir);
    expect(after).toBe(before);
  });

  it('no .tmp file is left behind when conflict guard triggers', async () => {
    writeSettingsFile(
      tmpDir,
      JSON.stringify({ __migrations: 'x', authMethod: 'apiKey' }),
    );

    await runV4Migration(tmpDir);

    expect(tmpExists(tmpDir)).toBe(false);
  });
});

// ============================================================================
// V4-4 — fs-safety: ENOENT, corrupt JSON, error propagation
// ============================================================================

describe('V4-4 — fs-safety: ENOENT is a no-op', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ENOENT (missing settings.json) resolves without throwing', async () => {
    await expect(runV4Migration(tmpDir)).resolves.toBeUndefined();
  });

  it('ENOENT does not create settings.json', async () => {
    await runV4Migration(tmpDir);
    expect(settingsExists(tmpDir)).toBe(false);
  });
});

describe('V4-4 — fs-safety: corrupt JSON is skipped, file preserved', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const corruptPayloads = [
    '{ trailing comma, }',
    '{ "key": }',
    '<<<not json at all>>>',
    '',
  ];

  for (const payload of corruptPayloads) {
    it(`does not crash on corrupt payload: ${JSON.stringify(payload).slice(0, 40)}`, async () => {
      writeSettingsFile(tmpDir, payload);
      const original = readSettings(tmpDir);

      await expect(runV4Migration(tmpDir)).resolves.toBeUndefined();

      expect(settingsExists(tmpDir)).toBe(true);
      expect(readSettings(tmpDir)).toBe(original);
    });
  }

  it('no .tmp file lingers after corrupt-JSON skip', async () => {
    writeSettingsFile(tmpDir, '{ bad json');
    await runV4Migration(tmpDir);
    expect(tmpExists(tmpDir)).toBe(false);
  });
});

describe('V4-4 — fs-safety: ENOENT EACCES ENOSPC via MigrationRunner (mirrors edge-cases contract)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ENOENT is silently swallowed (no settings file = no-op)', async () => {
    await expect(runV4Migration(tmpDir)).resolves.toBeUndefined();
  });

  it('MigrationRunner propagates non-ENOENT errors from runV4Migration', async () => {
    const { MigrationRunner } = await import('./runner');

    const eacces = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });

    const failingV4 = jest.fn().mockRejectedValue(eacces);
    const successMigration = jest.fn().mockResolvedValue(undefined);

    const runner = new MigrationRunner(tmpDir, [failingV4, successMigration]);

    await expect(runner.runMigrations()).rejects.toMatchObject({
      code: 'EACCES',
    });

    expect(failingV4).toHaveBeenCalledTimes(1);
    expect(successMigration).not.toHaveBeenCalled();
  });

  it('no settings.v4.tmp file lingers after successful migration (atomic rename contract)', async () => {
    writeSettingsFile(
      tmpDir,
      JSON.stringify({
        version: 1,
        authMethod: 'apiKey',
        workspace: {
          abc1def2ghi3jkl4: {
            authMethod: 'claudeCli',
          },
        },
      }),
    );

    await runV4Migration(tmpDir);

    expect(tmpExists(tmpDir)).toBe(false);
    const raw = readSettings(tmpDir);
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
