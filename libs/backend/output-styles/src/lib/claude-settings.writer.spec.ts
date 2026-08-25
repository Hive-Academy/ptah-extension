/**
 * R2 — Ptah writes a file it does not own. Every case below exists because
 * getting it wrong destroys a user's `.claude/settings.json`.
 *
 * The load-bearing assertion is `expect(fs.writeFile).not.toHaveBeenCalled()`
 * on malformed input: it is not enough for the operation to REPORT a failure,
 * the write must never be attempted.
 */
import * as path from 'path';
import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { ClaudeSettingsWriter } from './claude-settings.writer';

const WORKSPACE_ROOT = path.join('d:', 'tmp', 'ws-claude-settings');
const FAKE_HOME = path.join('d:', 'tmp', 'home-claude-settings');

const PROJECT_SETTINGS = path.join(WORKSPACE_ROOT, '.claude', 'settings.json');
const LOCAL_SETTINGS = path.join(
  WORKSPACE_ROOT,
  '.claude',
  'settings.local.json',
);
const USER_SETTINGS = path.join(FAKE_HOME, '.claude', 'settings.json');
const PROJECT_BACKUP = `${PROJECT_SETTINGS}.ptah-bak`;

/** Every absolute host path that must never appear in a surfaced message. */
const HOST_PATHS = [WORKSPACE_ROOT, FAKE_HOME, PROJECT_SETTINGS, USER_SETTINGS];

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(root: string | undefined): IWorkspaceProvider {
  return {
    getWorkspaceRoot: jest.fn(() => root),
    getWorkspaceFolders: jest.fn(() => (root === undefined ? [] : [root])),
  } as unknown as IWorkspaceProvider;
}

/**
 * Seed the backing store directly rather than through `writeFile`, so the
 * "writeFile was never called" assertions are not polluted by setup.
 */
function seed(fs: MockFileSystemProvider, target: string, raw: string): void {
  fs.__state.files.set(target, new TextEncoder().encode(raw));
}

function read(fs: MockFileSystemProvider, target: string): string {
  const bytes = fs.__state.files.get(target);
  if (bytes === undefined) throw new Error(`not seeded: ${target}`);
  return new TextDecoder().decode(bytes);
}

function expectNoHostPath(message: string | undefined): void {
  expect(message).toBeDefined();
  for (const hostPath of HOST_PATHS) {
    expect(message).not.toContain(hostPath);
  }
  // Also catch a drive-letter path this test did not think of.
  expect(message).not.toMatch(/[A-Za-z]:[\\/]/);
}

describe('ClaudeSettingsWriter', () => {
  const originalHome = process.env['HOME'];
  const originalUserProfile = process.env['USERPROFILE'];

  beforeEach(() => {
    process.env['HOME'] = FAKE_HOME;
    process.env['USERPROFILE'] = FAKE_HOME;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
    if (originalUserProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = originalUserProfile;
  });

  /**
   * `root` is `string | null` rather than `string | undefined` on purpose:
   * passing `undefined` to an optional parameter re-applies its default, so a
   * "no workspace" test would silently get one. `null` means "no folder open".
   */
  function makeWriter(
    fs: MockFileSystemProvider = createMockFileSystemProvider(),
    root: string | null = WORKSPACE_ROOT,
  ): { writer: ClaudeSettingsWriter; fs: MockFileSystemProvider } {
    return {
      writer: new ClaudeSettingsWriter(
        fs,
        makeWorkspace(root ?? undefined),
        makeLogger(),
      ),
      fs,
    };
  }

  describe('merge preservation (R2, Req 2.2)', () => {
    const EXISTING = `{
  "permissions": {
    "allow": ["Bash(npm run test)"],
    "deny": []
  },
  "env": {
    "FOO": "bar"
  },
  "hooks": {
    "PreToolUse": []
  }
}
`;

    it('keeps every unrelated key intact and adds only outputStyle', async () => {
      const { writer, fs } = makeWriter();
      seed(fs, PROJECT_SETTINGS, EXISTING);

      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Simplified Technical English',
      });

      expect(outcome.written).toBe(true);
      expect(outcome.writtenPath).toBe('.claude/settings.json');

      const before = JSON.parse(EXISTING) as Record<string, unknown>;
      const after = JSON.parse(read(fs, PROJECT_SETTINGS)) as Record<
        string,
        unknown
      >;

      expect(after['permissions']).toEqual(before['permissions']);
      expect(after['env']).toEqual(before['env']);
      expect(after['hooks']).toEqual(before['hooks']);
      expect(after['outputStyle']).toBe('Simplified Technical English');
      expect(Object.keys(after)).toHaveLength(4);
    });

    it('preserves the order of pre-existing keys and appends the new one', async () => {
      const { writer, fs } = makeWriter();
      seed(fs, PROJECT_SETTINGS, EXISTING);

      await writer.setOutputStyle({ tier: 'project', styleName: 'Terse' });

      const after = JSON.parse(read(fs, PROJECT_SETTINGS)) as Record<
        string,
        unknown
      >;
      expect(Object.keys(after)).toEqual([
        'permissions',
        'env',
        'hooks',
        'outputStyle',
      ]);
    });

    it('emits 2-space JSON with a trailing newline', async () => {
      const { writer, fs } = makeWriter();
      seed(fs, PROJECT_SETTINGS, EXISTING);

      await writer.setOutputStyle({ tier: 'project', styleName: 'Terse' });

      const raw = read(fs, PROJECT_SETTINGS);
      expect(raw.endsWith('\n')).toBe(true);
      expect(raw).toContain('\n  "permissions"');
    });

    it('replaces an existing outputStyle rather than duplicating it', async () => {
      const { writer, fs } = makeWriter();
      seed(fs, PROJECT_SETTINGS, '{\n  "outputStyle": "Learning"\n}\n');

      await writer.setOutputStyle({ tier: 'project', styleName: 'Terse' });

      const after = JSON.parse(read(fs, PROJECT_SETTINGS)) as Record<
        string,
        unknown
      >;
      expect(after).toEqual({ outputStyle: 'Terse' });
    });
  });

  describe('create if absent (Req 2.3)', () => {
    it('writes a new file containing only outputStyle', async () => {
      const { writer, fs } = makeWriter();

      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
      });

      expect(outcome.written).toBe(true);
      expect(read(fs, PROJECT_SETTINGS)).toBe(
        '{\n  "outputStyle": "Terse"\n}\n',
      );
      // The port's writeFile creates parent directories — no extra call needed.
      expect(fs.createDirectory).not.toHaveBeenCalled();
    });

    it('treats an empty file as an empty object', async () => {
      const { writer, fs } = makeWriter();
      seed(fs, PROJECT_SETTINGS, '   \n');

      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
      });

      expect(outcome.written).toBe(true);
      expect(JSON.parse(read(fs, PROJECT_SETTINGS))).toEqual({
        outputStyle: 'Terse',
      });
    });
  });

  describe('clearing the key (Req 2.4)', () => {
    it.each([null, 'default'])('%s removes outputStyle', async (styleName) => {
      const { writer, fs } = makeWriter();
      seed(
        fs,
        PROJECT_SETTINGS,
        '{\n  "outputStyle": "Terse",\n  "env": { "FOO": "bar" }\n}\n',
      );

      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName,
      });

      expect(outcome.written).toBe(true);
      const after = JSON.parse(read(fs, PROJECT_SETTINGS)) as Record<
        string,
        unknown
      >;
      expect('outputStyle' in after).toBe(false);
      expect(after['env']).toEqual({ FOO: 'bar' });
    });

    it('emits an empty object rather than deleting the file', async () => {
      const { writer, fs } = makeWriter();
      seed(fs, PROJECT_SETTINGS, '{\n  "outputStyle": "Terse"\n}\n');

      await writer.setOutputStyle({ tier: 'project', styleName: null });

      expect(read(fs, PROJECT_SETTINGS)).toBe('{}\n');
      expect(fs.delete).not.toHaveBeenCalledWith(PROJECT_SETTINGS);
    });
  });

  describe('malformed pre-existing JSON (Req 2.7)', () => {
    it('aborts with SETTINGS_MALFORMED and NEVER calls writeFile', async () => {
      const { writer, fs } = makeWriter();
      seed(fs, PROJECT_SETTINGS, '{ "permissions": { "allow": [ }');

      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
      });

      expect(outcome.written).toBe(false);
      expect(outcome.error?.code).toBe('SETTINGS_MALFORMED');
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.writeFileBytes).not.toHaveBeenCalled();
    });

    it('leaves the broken file byte-identical', async () => {
      const { writer, fs } = makeWriter();
      const broken = '{ "permissions": { "allow": [ }';
      seed(fs, PROJECT_SETTINGS, broken);

      await writer.setOutputStyle({ tier: 'project', styleName: 'Terse' });

      expect(read(fs, PROJECT_SETTINGS)).toBe(broken);
    });

    it('names the workspace-relative path and no absolute host path', async () => {
      const { writer, fs } = makeWriter();
      seed(fs, PROJECT_SETTINGS, '{ nope');

      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
      });

      expect(outcome.error?.message).toContain('.claude/settings.json');
      expect(outcome.error?.path).toBe('.claude/settings.json');
      expectNoHostPath(outcome.error?.message);
    });

    it.each([
      ['an array root', '["not", "an", "object"]'],
      ['a string root', '"just a string"'],
      ['a null root', 'null'],
      ['a number root', '42'],
    ])('rejects %s the same way', async (_label, raw) => {
      const { writer, fs } = makeWriter();
      seed(fs, PROJECT_SETTINGS, raw);

      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
      });

      expect(outcome.error?.code).toBe('SETTINGS_MALFORMED');
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(read(fs, PROJECT_SETTINGS)).toBe(raw);
    });
  });

  describe('pre-write conflict (Req 2.7)', () => {
    it('aborts with SETTINGS_CONFLICT and writes nothing to the target', async () => {
      const fs = createMockFileSystemProvider();
      seed(fs, PROJECT_SETTINGS, '{\n  "env": { "FOO": "bar" }\n}\n');

      // Someone else rewrites the file between the snapshot and the re-read.
      const realRead = fs.readFile.getMockImplementation();
      let reads = 0;
      fs.readFile.mockImplementation(async (target: string) => {
        if (target === PROJECT_SETTINGS) {
          reads += 1;
          if (reads > 1) return '{\n  "env": { "FOO": "CHANGED" }\n}\n';
        }
        return realRead ? realRead(target) : '';
      });

      const { writer } = makeWriter(fs);
      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
      });

      expect(outcome.written).toBe(false);
      expect(outcome.error?.code).toBe('SETTINGS_CONFLICT');
      expect(fs.writeFile).not.toHaveBeenCalledWith(
        PROJECT_SETTINGS,
        expect.anything(),
      );
      expectNoHostPath(outcome.error?.message);
    });

    it('removes the backup it took, since no write happened', async () => {
      const fs = createMockFileSystemProvider();
      seed(fs, PROJECT_SETTINGS, '{\n  "env": {}\n}\n');

      const realRead = fs.readFile.getMockImplementation();
      let reads = 0;
      fs.readFile.mockImplementation(async (target: string) => {
        if (target === PROJECT_SETTINGS) {
          reads += 1;
          if (reads > 1) return '{}';
        }
        return realRead ? realRead(target) : '';
      });

      const { writer } = makeWriter(fs);
      await writer.setOutputStyle({ tier: 'project', styleName: 'Terse' });

      expect(fs.__state.files.has(PROJECT_BACKUP)).toBe(false);
    });
  });

  describe('backup lifecycle', () => {
    it('writes .ptah-bak before the target and removes it after success', async () => {
      const { writer, fs } = makeWriter();
      const existing = '{\n  "env": { "FOO": "bar" }\n}\n';
      seed(fs, PROJECT_SETTINGS, existing);

      await writer.setOutputStyle({ tier: 'project', styleName: 'Terse' });

      const writtenPaths = fs.writeFile.mock.calls.map(([target]) => target);
      expect(writtenPaths).toEqual([PROJECT_BACKUP, PROJECT_SETTINGS]);
      expect(fs.writeFile.mock.calls[0][1]).toBe(existing);
      expect(fs.__state.files.has(PROJECT_BACKUP)).toBe(false);
    });

    it('takes no backup when the file did not exist', async () => {
      const { writer, fs } = makeWriter();

      await writer.setOutputStyle({ tier: 'project', styleName: 'Terse' });

      const writtenPaths = fs.writeFile.mock.calls.map(([target]) => target);
      expect(writtenPaths).toEqual([PROJECT_SETTINGS]);
    });

    it('RETAINS .ptah-bak when the write throws, and names it', async () => {
      const fs = createMockFileSystemProvider();
      const existing = '{\n  "env": { "FOO": "bar" }\n}\n';
      seed(fs, PROJECT_SETTINGS, existing);

      const realWrite = fs.writeFile.getMockImplementation();
      fs.writeFile.mockImplementation(async (target: string, body: string) => {
        if (target === PROJECT_SETTINGS) {
          throw new Error(`EACCES: permission denied, open '${target}'`);
        }
        if (realWrite) await realWrite(target, body);
      });

      const { writer } = makeWriter(fs);
      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
      });

      expect(outcome.written).toBe(false);
      expect(outcome.error?.code).toBe('WRITE_FAILED');
      expect(fs.__state.files.has(PROJECT_BACKUP)).toBe(true);
      expect(read(fs, PROJECT_BACKUP)).toBe(existing);
      expect(outcome.error?.message).toContain(
        '.claude/settings.json.ptah-bak',
      );
      expectNoHostPath(outcome.error?.message);
    });
  });

  describe('tier routing (E2)', () => {
    it('project → .claude/settings.json', async () => {
      const { writer, fs } = makeWriter();

      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
      });

      expect(outcome.writtenPath).toBe('.claude/settings.json');
      expect(outcome.tier).toBe('project');
      expect(fs.__state.files.has(PROJECT_SETTINGS)).toBe(true);
    });

    it('local → .claude/settings.local.json', async () => {
      const { writer, fs } = makeWriter();

      const outcome = await writer.setOutputStyle({
        tier: 'local',
        styleName: 'Terse',
      });

      expect(outcome.writtenPath).toBe('.claude/settings.local.json');
      expect(fs.__state.files.has(LOCAL_SETTINGS)).toBe(true);
    });

    it('user → ~/.claude/settings.json', async () => {
      const { writer, fs } = makeWriter();

      const outcome = await writer.setOutputStyle({
        tier: 'user',
        styleName: 'Terse',
      });

      expect(outcome.writtenPath).toBe('~/.claude/settings.json');
      expect(fs.__state.files.has(USER_SETTINGS)).toBe(true);
    });

    it('honours an explicit workspaceRoot over the provider', async () => {
      const otherRoot = path.join('d:', 'tmp', 'other-ws');
      const { writer, fs } = makeWriter();

      await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
        workspaceRoot: otherRoot,
      });

      expect(
        fs.__state.files.has(path.join(otherRoot, '.claude', 'settings.json')),
      ).toBe(true);
      expect(fs.__state.files.has(PROJECT_SETTINGS)).toBe(false);
    });

    it('reports NO_WORKSPACE for a project write with no folder open', async () => {
      const { writer, fs } = makeWriter(createMockFileSystemProvider(), null);

      const outcome = await writer.setOutputStyle({
        tier: 'project',
        styleName: 'Terse',
      });

      expect(outcome.written).toBe(false);
      expect(outcome.error?.code).toBe('NO_WORKSPACE');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('still writes the user tier with no folder open', async () => {
      const { writer } = makeWriter(createMockFileSystemProvider(), null);

      const outcome = await writer.setOutputStyle({
        tier: 'user',
        styleName: 'Terse',
      });

      expect(outcome.written).toBe(true);
    });
  });

  describe('Req 7.6 — nothing surfaced names the host', () => {
    it('holds for every failure mode', async () => {
      const cases: Array<() => Promise<string | undefined>> = [
        async () => {
          const { writer, fs } = makeWriter();
          seed(fs, PROJECT_SETTINGS, '{ broken');
          const outcome = await writer.setOutputStyle({
            tier: 'project',
            styleName: 'Terse',
          });
          return outcome.error?.message;
        },
        async () => {
          const { writer } = makeWriter(createMockFileSystemProvider(), null);
          const outcome = await writer.setOutputStyle({
            tier: 'project',
            styleName: 'Terse',
          });
          return outcome.error?.message;
        },
        async () => {
          const fs = createMockFileSystemProvider();
          seed(fs, USER_SETTINGS, '{}');
          fs.writeFile.mockImplementation(async (target: string) => {
            throw new Error(`EACCES: permission denied, open '${target}'`);
          });
          const { writer } = makeWriter(fs);
          const outcome = await writer.setOutputStyle({
            tier: 'user',
            styleName: 'Terse',
          });
          return outcome.error?.message;
        },
      ];

      for (const run of cases) {
        expectNoHostPath(await run());
      }
    });
  });
});
