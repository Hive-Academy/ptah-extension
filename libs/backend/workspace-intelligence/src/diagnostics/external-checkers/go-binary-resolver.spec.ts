/**
 * `go-binary-resolver.spec.ts` — TASK_2026_559 Batch 37a, O2 §4.1 and §7.1
 * cases 10-14.
 *
 * Every fixture is a `mkdtemp` directory removed after each case. The win32
 * rules run on every OS through the injected `platform` (the directories are
 * real host directories; only the platform's rules change). The POSIX
 * execute-bit case runs on POSIX hosts only.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readEnvVariable,
  resolveGoBinary,
  sanitisedPathDirectories,
  type GoBinaryFileSystem,
} from './go-binary-resolver';

const tempRoots: string[] = [];
let originalCwd: string;

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

/** A directory holding the named files (each a small regular file). */
function dirWith(parent: string, name: string, files: string[]): string {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const target = path.join(dir, file);
    fs.writeFileSync(target, 'binary');
    fs.chmodSync(target, 0o755);
  }
  return dir;
}

function canonical(target: string): string {
  return fs.realpathSync.native(target);
}

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveGoBinary (win32 rules, any host)', () => {
  it('FB: hostile PATH entry rejected — a go.exe inside the workspace is never chosen; the later toolchain is', () => {
    const root = tempDir('ptah-go-root-');
    const hostile = dirWith(root, 'tools', ['go.exe']);
    const toolchain = dirWith(tempDir('ptah-go-sdk-'), 'bin', ['go.exe']);

    const resolved = resolveGoBinary({
      workspaceRoot: root,
      env: { PATH: [hostile, toolchain].join(';') },
      platform: 'win32',
    });

    expect(resolved?.path).toBe(canonical(path.join(toolchain, 'go.exe')));
    expect(resolved?.pathDirs).toEqual([canonical(toolchain)]);
  });

  it('case 10: drops empty, ".", relative, drive-relative, UNC and in-workspace entries', () => {
    const root = tempDir('ptah-go-root-');
    const inWorkspace = dirWith(root, 'bin', ['go.exe']);
    const toolchain = dirWith(tempDir('ptah-go-sdk-'), 'bin', ['go.exe']);
    const entries = [
      '',
      '.',
      'relative\\bin',
      'C:foo',
      '\\\\server\\share\\bin',
      '\\\\?\\C:\\go\\bin',
      inWorkspace,
      toolchain,
    ];

    const dirs = sanitisedPathDirectories({
      workspaceRoot: root,
      env: { PATH: entries.join(';') },
      platform: 'win32',
    });

    expect(dirs).toEqual([canonical(toolchain)]);
  });

  it('case 11: host cwd holding go.exe (cwd is not the checked root) is never returned; the PATH toolchain is', () => {
    const root = tempDir('ptah-go-root-');
    const hostCwd = dirWith(tempDir('ptah-go-cwd-'), 'cwd', ['go.exe']);
    const toolchain = dirWith(tempDir('ptah-go-sdk-'), 'bin', ['go.exe']);
    process.chdir(hostCwd);

    const resolved = resolveGoBinary({
      workspaceRoot: root,
      env: { PATH: ['.', '', toolchain].join(';') },
      platform: 'win32',
    });

    expect(resolved?.path).toBe(canonical(path.join(toolchain, 'go.exe')));
    expect(resolved?.pathDirs).not.toContain(canonical(hostCwd));
  });

  it('case 12: PATHEXT is ignored — go.cmd / go.bat first on PATH are skipped, the later go.exe is found', () => {
    const root = tempDir('ptah-go-root-');
    const wrappers = dirWith(tempDir('ptah-go-wrap-'), 'bin', [
      'go.cmd',
      'go.bat',
    ]);
    const toolchain = dirWith(tempDir('ptah-go-sdk-'), 'bin', ['go.exe']);

    const resolved = resolveGoBinary({
      workspaceRoot: root,
      env: { PATH: [wrappers, toolchain].join(';'), PATHEXT: '.CMD;.BAT' },
      platform: 'win32',
    });

    expect(resolved?.path).toBe(canonical(path.join(toolchain, 'go.exe')));
  });

  it('case 13: a go.exe resolving into the workspace, and one resolving to a .cmd, are rejected; the search continues', () => {
    const root = tempDir('ptah-go-root-');
    const evil = dirWith(root, 'evil', ['go.exe']);
    const sdk = tempDir('ptah-go-sdk-');
    const intoWorkspace = dirWith(sdk, 'link-a', ['go.exe']);
    const toWrapper = dirWith(sdk, 'link-b', ['go.exe', 'go.cmd']);
    const toolchain = dirWith(sdk, 'bin', ['go.exe']);
    // Symlinks stood in by the injected realpath, so the case runs without
    // symlink privileges on every host.
    const links = new Map<string, string>([
      [
        canonical(path.join(intoWorkspace, 'go.exe')),
        path.join(evil, 'go.exe'),
      ],
      [
        canonical(path.join(toWrapper, 'go.exe')),
        path.join(toWrapper, 'go.cmd'),
      ],
    ]);
    const fileSystem: GoBinaryFileSystem = {
      realpath: (target) =>
        links.get(path.resolve(target)) ?? fs.realpathSync.native(target),
      stat: (target) => fs.statSync(target),
      isExecutable: () => true,
    };

    const resolved = resolveGoBinary({
      workspaceRoot: root,
      env: { PATH: [intoWorkspace, toWrapper, toolchain].join(';') },
      platform: 'win32',
      fileSystem,
    });

    expect(resolved?.path).toBe(canonical(path.join(toolchain, 'go.exe')));
  });

  it('case 13 (real link): a PATH directory that is a junction/symlink into the workspace is dropped', () => {
    const root = tempDir('ptah-go-root-');
    const target = dirWith(root, 'bin', ['go.exe']);
    const outside = tempDir('ptah-go-link-');
    const link = path.join(outside, 'linked-bin');
    fs.symlinkSync(target, link, 'junction');
    const toolchain = dirWith(tempDir('ptah-go-sdk-'), 'bin', ['go.exe']);

    const dirs = sanitisedPathDirectories({
      workspaceRoot: root,
      env: { PATH: [link, toolchain].join(';') },
      platform: 'win32',
    });

    expect(dirs).toEqual([canonical(toolchain)]);
  });

  it('case 14: a quoted PATH entry is unquoted and accepted', () => {
    const root = tempDir('ptah-go-root-');
    const toolchain = dirWith(tempDir('ptah go sdk '), 'bin', ['go.exe']);

    const resolved = resolveGoBinary({
      workspaceRoot: root,
      env: { Path: `"${toolchain}"` },
      platform: 'win32',
    });

    expect(resolved?.path).toBe(canonical(path.join(toolchain, 'go.exe')));
  });

  it('drops directories inside the host user-data directory and de-duplicates the rest', () => {
    const root = tempDir('ptah-go-root-');
    const userData = tempDir('ptah-go-userdata-');
    const planted = dirWith(userData, 'bin', ['go.exe']);
    const toolchain = dirWith(tempDir('ptah-go-sdk-'), 'bin', ['go.exe']);

    const dirs = sanitisedPathDirectories({
      workspaceRoot: root,
      env: { PATH: [planted, toolchain, toolchain].join(';') },
      userDataPath: userData,
      platform: 'win32',
    });

    expect(dirs).toEqual([canonical(toolchain)]);
  });

  it('skips a go.exe that is a directory and answers null when nothing is acceptable', () => {
    const root = tempDir('ptah-go-root-');
    const fake = tempDir('ptah-go-dir-');
    fs.mkdirSync(path.join(fake, 'go.exe'));

    expect(
      resolveGoBinary({
        workspaceRoot: root,
        env: { PATH: fake },
        platform: 'win32',
      }),
    ).toBeNull();
  });

  it('reports the accepted binary identity (size and mtime) the consent record binds', () => {
    const root = tempDir('ptah-go-root-');
    const toolchain = dirWith(tempDir('ptah-go-sdk-'), 'bin', ['go.exe']);
    const stats = fs.statSync(path.join(toolchain, 'go.exe'));

    const resolved = resolveGoBinary({
      workspaceRoot: root,
      env: { PATH: toolchain },
      platform: 'win32',
    });

    expect(resolved).toMatchObject({
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    });
  });
});

describe('resolveGoBinary (POSIX rules)', () => {
  const posixOnly = process.platform === 'win32' ? it.skip : it;

  posixOnly('looks for `go` only and skips one without the execute bit', () => {
    const root = tempDir('ptah-go-root-');
    const noExec = dirWith(tempDir('ptah-go-noexec-'), 'bin', ['go']);
    fs.chmodSync(path.join(noExec, 'go'), 0o644);
    const exeOnly = dirWith(tempDir('ptah-go-exe-'), 'bin', ['go.exe']);
    const toolchain = dirWith(tempDir('ptah-go-sdk-'), 'bin', ['go']);

    const resolved = resolveGoBinary({
      workspaceRoot: root,
      env: { PATH: [noExec, exeOnly, toolchain].join(':') },
      platform: 'linux',
    });

    expect(resolved?.path).toBe(canonical(path.join(toolchain, 'go')));
  });
});

describe('readEnvVariable', () => {
  it('matches the key without case on win32 only', () => {
    const env = { Path: 'a' };
    expect(readEnvVariable(env, 'PATH', 'win32')).toBe('a');
    expect(readEnvVariable(env, 'PATH', 'linux')).toBeUndefined();
  });
});
