/**
 * `openMergeTool` against a real process on Windows, macOS and Linux.
 *
 * A fake `code` CLI — `code.cmd` on Windows, an executable `code` script
 * elsewhere, both shaped like the shims VS Code ships — forwards its argv to a
 * Node recorder that writes it to `argv.json`. Detection finds the shim on
 * PATH exactly as it finds the real one, so the argv the editor receives is
 * proven end to end: order, spaces, and no shell interpretation.
 *
 * The spawner is `cross-spawn`. The Electron host's `IProcessSpawner`
 * (`OffThreadProcessSpawner`, agent-sdk) resolves every command with
 * `cross-spawn`'s own parser — which turns a `.cmd` shim into
 * `cmd.exe /d /s /c` with escaped, verbatim arguments — and then calls
 * `child_process.spawn` with the result. `cross-spawn` does both steps inline,
 * so this is the same `.cmd` path without pulling agent-sdk into this library.
 *
 * Runs in the default `test` target. Alone:
 * `npx nx test @ptah-extension/platform-electron --testPathPatterns=editor-merge.real`
 */
import type { ChildProcess } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import crossSpawn from 'cross-spawn';
import type {
  EditorTarget,
  IProcessSpawner,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import { ElectronEditorLauncher } from './electron-editor-launcher';

const IS_WINDOWS = process.platform === 'win32';
const LAUNCH_TIMEOUT_MS = 30_000;

/** Spawns through `cross-spawn` and remembers each child's exit. */
function createRecordingSpawner(): {
  readonly spawner: IProcessSpawner;
  readonly exits: Promise<number | null>[];
} {
  const exits: Promise<number | null>[] = [];
  const spawner: IProcessSpawner = {
    spawnProcess(request): SpawnedProcessHandle {
      const child: ChildProcess = crossSpawn(
        request.command,
        [...request.args],
        {
          cwd: request.cwd,
          env: { ...request.env },
          detached: request.detached ?? false,
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      exits.push(
        new Promise<number | null>((resolve) => {
          child.once('exit', (code) => resolve(code));
          child.once('error', () => resolve(null));
        }),
      );
      const whenSpawned = new Promise<number | null>((resolve) => {
        child.once('spawn', () => resolve(child.pid ?? null));
        child.once('error', () => resolve(null));
      });
      // `pid` is set synchronously by `spawn`; restating it makes it required.
      return Object.assign(child, { whenSpawned, pid: child.pid });
    },
  };
  return { spawner, exits };
}

/** Write the recorder and the `code` shim that forwards its argv to it. */
async function writeFakeCodeCli(binDir: string): Promise<void> {
  const recorder = path.join(binDir, 'record-argv.cjs');
  await writeFile(
    recorder,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'fs.writeFileSync(',
      "  path.join(__dirname, 'argv.json'),",
      '  JSON.stringify(process.argv.slice(2)),',
      ');',
      '',
    ].join('\n'),
  );
  if (IS_WINDOWS) {
    // The shape of VS Code's own bin\code.cmd: run the CLI script with `%*`.
    await writeFile(
      path.join(binDir, 'code.cmd'),
      `@echo off\r\n"${process.execPath}" "${recorder}" %*\r\n`,
    );
    return;
  }
  const shim = path.join(binDir, 'code');
  await writeFile(
    shim,
    `#!/bin/sh\nexec "${process.execPath}" "${recorder}" "$@"\n`,
  );
  await chmod(shim, 0o755);
}

describe('openMergeTool with a real editor CLI shim', () => {
  let root: string;
  let binDir: string;
  let argvFile: string;

  beforeEach(async () => {
    // A space in every directory: the shim, the stages and the result all
    // live under it, the way `Microsoft VS Code\bin\code.cmd` does.
    root = await mkdtemp(path.join(os.tmpdir(), 'ptah editor merge '));
    binDir = path.join(root, 'editor bin');
    await mkdir(binDir);
    await writeFakeCodeCli(binDir);
    argvFile = path.join(binDir, 'argv.json');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  function launcherFor(spawner: IProcessSpawner): ElectronEditorLauncher {
    return new ElectronEditorLauncher(spawner, {
      env: { PATH: binDir, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      homeDir: root,
      cache: null,
    });
  }

  async function detectVsCode(
    launcher: ElectronEditorLauncher,
  ): Promise<EditorTarget> {
    const target = (await launcher.detect()).find(({ id }) => id === 'vscode');
    if (target === undefined) throw new Error('fake code shim not detected');
    return target;
  }

  it(
    'passes --merge local remote base result in order, with spaces, & and ; kept literal',
    async () => {
      const { spawner, exits } = createRecordingSpawner();
      const launcher = launcherFor(spawner);
      const target = await detectVsCode(launcher);
      expect(path.dirname(target.executablePath ?? '')).toBe(binDir);
      if (IS_WINDOWS)
        expect(path.extname(target.executablePath ?? '').toLowerCase()).toBe(
          '.cmd',
        );

      const stages = path.join(root, 'ptah-merge', 'stage dir');
      const request = {
        local: path.join(stages, 'local & echo injected.ts'),
        remote: path.join(stages, 'remote; echo injected.ts'),
        base: path.join(stages, 'base (1) $HOME.ts'),
        result: path.join(root, 'my repo', 'src', 'a & b; c.ts'),
      };
      // The editor runs in the result file's directory, as in a real repo.
      await mkdir(path.dirname(request.result), { recursive: true });

      await expect(launcher.openMergeTool(target, request)).resolves.toEqual({
        status: 'launched',
      });
      expect(exits).toHaveLength(1);
      await expect(Promise.all(exits)).resolves.toEqual([0]);

      const argv: unknown = JSON.parse(await readFile(argvFile, 'utf8'));
      expect(argv).toEqual([
        '--merge',
        request.local,
        request.remote,
        request.base,
        request.result,
      ]);
    },
    LAUNCH_TIMEOUT_MS,
  );

  it(
    'A11: refuses a target without mergeArgs and never runs its executable',
    async () => {
      const { spawner, exits } = createRecordingSpawner();
      const launcher = launcherFor(spawner);
      const vscode = await detectVsCode(launcher);
      const file = path.join(root, 'my repo', 'a.ts');

      await expect(
        launcher.openMergeTool(
          {
            id: 'cursor',
            displayName: 'Cursor',
            executablePath: vscode.executablePath,
          },
          { local: file, remote: file, base: file, result: file },
        ),
      ).resolves.toEqual({ status: 'unsupported' });
      expect(exits).toHaveLength(0);
      await expect(readFile(argvFile, 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
    LAUNCH_TIMEOUT_MS,
  );
});
