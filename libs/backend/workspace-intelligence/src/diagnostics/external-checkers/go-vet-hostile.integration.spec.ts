/**
 * `go-vet-hostile.integration.spec.ts` — TASK_2026_559 Batch 37a, O2 §7.2.
 *
 * Real-binary hostile fixtures: the actual `go` on this machine runs through
 * the real checker, runner, resolver and consent store. SKIPPED, with a
 * printed reason, when no `go` resolves from the sanitised PATH — the unit
 * specs never need a Go install.
 *
 * Every claim has its own module and its own observable evidence; a cgo
 * failure never stands in for another case:
 * - generate: a `//go:generate` directive that would write a marker → absent;
 * - suggested toolchain: `toolchain go1.99.0` → vet runs on the local version,
 *   no toolchain directory appears in the module cache;
 * - minimum go version: `go 1.99` → failed/toolchain-mismatch, no download;
 * - network: a `require` of a module not in the cache → failed/missing-modules,
 *   no new module-cache entry;
 * - cgo: the cgo file is reported not built; vet checks the rest; no cgo
 *   output appears;
 * - vcs: a `.git/config` `core.fsmonitor` marker script → marker absent;
 * - toolexec: `GOFLAGS=-toolexec=<marker script>` in the parent env → absent;
 * - line directive (review r1 finding 3): a finding placed outside the root
 *   by `//line` is counted, never erased, and its file is not claimed.
 *
 * Import lines inside Go fixtures are built by concatenation (validate-deps
 * bundle scanner rule).
 */

import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  IProcessSpawner,
  IStateStorage,
  IWorkspaceScopedStateStorage,
  ProcessSpawnRequest,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import { resolveGoBinary, type ResolvedGoBinary } from './go-binary-resolver';
import { GoVetConsentStore } from './go-vet-consent-store';
import {
  GoVetChecker,
  buildGoVetEnv,
  type GoVetCheckResult,
} from './go-vet-checker';

const IS_WIN = process.platform === 'win32';
const IMPORT = 'imp' + 'ort';

const GO: ResolvedGoBinary | null = resolveGoBinary({
  workspaceRoot: path.join(os.tmpdir(), 'ptah-go-vet-hostile-probe'),
  env: process.env,
});

if (GO === null) {
  console.warn(
    '[go-vet-hostile.integration] SKIPPED: no `go` binary resolves from the sanitised PATH on this machine.',
  );
}

const describeWithGo = GO === null ? describe.skip : describe;

/** ChildProcess → the platform handle shape (argument array, no shell). */
class ChildHandle extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = null;
  readonly whenSpawned: Promise<number | null>;

  constructor(private readonly child: ChildProcess) {
    super();
    this.whenSpawned = new Promise((resolve) => {
      child.once('spawn', () => resolve(child.pid ?? null));
      child.once('error', () => resolve(null));
    });
    child.on('exit', (code, signal) => this.emit('exit', code, signal));
    child.on('close', (code, signal) => this.emit('close', code, signal));
    child.on('error', (error) => this.emit('error', error));
  }

  get stdout(): NodeJS.ReadableStream | null {
    return this.child.stdout;
  }
  get stderr(): NodeJS.ReadableStream | null {
    return this.child.stderr;
  }
  get pid(): number | undefined {
    return this.child.pid;
  }
  get killed(): boolean {
    return this.child.killed;
  }
  get exitCode(): number | null {
    return this.child.exitCode;
  }
  kill(signal?: NodeJS.Signals): boolean {
    return this.child.kill(signal);
  }
}

class NodeSpawner implements IProcessSpawner {
  spawnProcess(request: ProcessSpawnRequest): SpawnedProcessHandle {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.env)) {
      if (value !== undefined) env[key] = value;
    }
    return new ChildHandle(
      spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env,
        detached: request.detached,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  }
}

class MemoryStorage implements IStateStorage {
  private readonly values = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

class OneRootStorage
  extends MemoryStorage
  implements IWorkspaceScopedStateStorage
{
  private readonly own = new MemoryStorage();
  constructor(private readonly root: string) {
    super();
  }
  getStorageForWorkspace(workspacePath: string): IStateStorage | undefined {
    return workspacePath === this.root ? this.own : undefined;
  }
  getAllWorkspacePaths(): string[] {
    return [this.root];
  }
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function write(root: string, relative: string, content: string): string {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

/** A script that writes `marker` when run (then runs its arguments). */
function markerScript(dir: string, marker: string): string {
  if (IS_WIN) {
    return write(dir, 'mark.cmd', `@echo off\r\necho x> "${marker}"\r\n%*\r\n`);
  }
  const script = write(
    dir,
    'mark.sh',
    `#!/bin/sh\necho x > '${marker}'\nexec "$@"\n`,
  );
  fs.chmodSync(script, 0o755);
  return script;
}

function localGoVersion(binary: ResolvedGoBinary): string {
  const versionFile = path.join(
    path.dirname(path.dirname(binary.path)),
    'VERSION',
  );
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, 'utf8').split(/\r?\n/, 1)[0].trim();
  }
  return execFileSync(binary.path, ['env', 'GOVERSION'], {
    env: buildGoVetEnv(process.env, binary.pathDirs, process.platform),
    encoding: 'utf8',
  }).trim();
}

function majorMinor(version: string): string {
  const match = /^go(\d+\.\d+)/.exec(version);
  return match ? match[1] : '1.21';
}

/** The module cache the child uses: GOPATH defaults to `<home>/go`. */
const MOD_CACHE = path.join(os.homedir(), 'go', 'pkg', 'mod');

function listing(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function toolchainEntries(): string[] {
  return [
    ...listing(path.join(MOD_CACHE, 'golang.org')).filter((entry) =>
      entry.startsWith('toolchain'),
    ),
    ...listing(path.join(MOD_CACHE, 'cache', 'download', 'golang.org')).filter(
      (entry) => entry.startsWith('toolchain'),
    ),
  ];
}

interface VetRun {
  readonly result: GoVetCheckResult;
  readonly audit: Record<string, unknown>;
}

async function vet(
  root: string,
  files: string[],
  parentEnv: NodeJS.ProcessEnv = process.env,
): Promise<VetRun> {
  const binary = GO as ResolvedGoBinary;
  const userData = tempDir('ptah-go-vet-userdata-');
  const store = new GoVetConsentStore(new OneRootStorage(path.resolve(root)), {
    userDataPath: userData,
  });
  await store.grant(root, binary);
  const lines: Array<Record<string, unknown>> = [];
  const checker = new GoVetChecker({
    consentStore: store,
    getSpawner: () => new NodeSpawner(),
    userDataPath: userData,
    logger: {
      info: (_message: string, fields?: unknown) => {
        lines.push(fields as Record<string, unknown>);
      },
    },
    env: () => parentEnv,
  });
  const result = await checker.check({ workspaceRoot: root, files });
  return { result, audit: lines[0] ?? {} };
}

jest.setTimeout(180_000);

describeWithGo('go vet hostile fixtures (real go binary)', () => {
  const local = GO === null ? '' : localGoVersion(GO);
  const goLine = `go ${majorMinor(local)}`;

  it('generate: a //go:generate directive never runs', async () => {
    const root = tempDir('ptah-go-vet-gen-');
    const marker = path.join(root, 'generated.marker');
    const command = IS_WIN
      ? `cmd /c echo x> "${marker}"`
      : `sh -c "echo x > '${marker}'"`;
    write(root, 'go.mod', `module example.com/gen\n\n${goLine}\n`);
    const file = write(
      root,
      'gen.go',
      `package gen\n\n//go:generate ${command}\n\nfunc G() int { return 1 }\n`,
    );

    const { result } = await vet(root, [file]);

    expect(result.status).toBe('checked');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('suggested toolchain: a newer `toolchain` line is ignored — vet runs on the local version, nothing is downloaded', async () => {
    const root = tempDir('ptah-go-vet-tc-');
    const before = toolchainEntries();
    write(
      root,
      'go.mod',
      `module example.com/tc\n\n${goLine}\n\ntoolchain go1.99.0\n`,
    );
    const file = write(
      root,
      'tc.go',
      'package tc\n\nfunc T() int { return 1 }\n',
    );

    const { result, audit } = await vet(root, [file]);

    expect(result.status).toBe('checked');
    expect(audit['goVersion']).toBe(local);
    expect(toolchainEntries()).toEqual(before);
  });

  it('minimum go version: `go 1.99` is failed/toolchain-mismatch, nothing is downloaded', async () => {
    const root = tempDir('ptah-go-vet-min-');
    const before = toolchainEntries();
    write(root, 'go.mod', 'module example.com/min\n\ngo 1.99\n');
    const file = write(root, 'min.go', 'package min\n');

    const { result } = await vet(root, [file]);

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'toolchain-mismatch',
    });
    expect(toolchainEntries()).toEqual(before);
  });

  it('network: a required module not in the cache is failed/missing-modules and never fetched', async () => {
    const root = tempDir('ptah-go-vet-net-');
    const cacheEntry = path.join(
      MOD_CACHE,
      'cache',
      'download',
      'example.invalid',
    );
    const existedBefore = fs.existsSync(cacheEntry);
    write(
      root,
      'go.mod',
      `module example.com/net\n\n${goLine}\n\nrequire example.invalid/nothere v1.0.0\n`,
    );
    const file = write(
      root,
      'net.go',
      `package net\n\n${IMPORT} _ "example.invalid/nothere"\n`,
    );

    const { result } = await vet(root, [file]);

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'missing-modules',
    });
    expect(fs.existsSync(cacheEntry)).toBe(existedBefore);
  });

  it('cgo: the cgo file is reported not built; the rest of its package is vetted; no cgo output appears', async () => {
    const root = tempDir('ptah-go-vet-cgo-');
    write(root, 'go.mod', `module example.com/cg\n\n${goLine}\n`);
    const plain = write(
      root,
      'plain.go',
      'package cg\n\nfunc P() int { return 1 }\n',
    );
    const cgo = write(
      root,
      'native.go',
      `package cg\n\n// #include <stdio.h>\n${IMPORT} "C"\n\nfunc N() { C.puts(nil) }\n`,
    );

    const { result } = await vet(root, [plain, cgo]);

    expect(result.status).toBe('checked');
    expect(result.checkedFiles).toEqual([path.resolve(plain)]);
    expect(result.skippedFiles).toEqual([
      { file: path.resolve(cgo), reason: 'cgo' },
    ]);
    expect(
      fs.readdirSync(root).filter((entry) => entry.startsWith('_cgo')),
    ).toEqual([]);
  });

  it('line directive: a finding placed outside the workspace is counted and its file is not claimed', async () => {
    const root = tempDir('ptah-go-vet-line-');
    write(
      root,
      'go.mod',
      `module example.com/ln

${goLine}
`,
    );
    const file = write(
      root,
      'ln.go',
      `package ln

${IMPORT} "fmt"

//line ../outside-generated.go:42
func L() { fmt.Printf("%d", "x") }
`,
    );

    const { result } = await vet(root, [file]);

    expect(result).toMatchObject({
      status: 'checked',
      outcome: 'findings',
      reason: 'unmapped-findings',
    });
    expect(result.unmappedFindings).toBeGreaterThan(0);
    expect(result.checkedFiles).toEqual([]);
  });

  it('vcs: a repository core.fsmonitor program never runs', async () => {
    const root = tempDir('ptah-go-vet-vcs-');
    const marker = path.join(root, 'fsmonitor.marker');
    const script = markerScript(tempDir('ptah-go-vet-script-'), marker);
    write(root, '.git/HEAD', 'ref: refs/heads/main\n');
    fs.mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
    fs.mkdirSync(path.join(root, '.git', 'refs'), { recursive: true });
    write(
      root,
      '.git/config',
      `[core]\n\trepositoryformatversion = 0\n\tfsmonitor = ${script.replace(/\\/g, '/')}\n`,
    );
    write(root, 'go.mod', `module example.com/vcs\n\n${goLine}\n`);
    const file = write(root, 'main.go', 'package main\n\nfunc main() {}\n');

    const { result } = await vet(root, [file]);

    expect(result.status).toBe('checked');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('toolexec: GOFLAGS=-toolexec in the parent env never applies', async () => {
    const root = tempDir('ptah-go-vet-toolexec-');
    const marker = path.join(root, 'toolexec.marker');
    const script = markerScript(tempDir('ptah-go-vet-script-'), marker);
    write(root, 'go.mod', `module example.com/te\n\n${goLine}\n`);
    const file = write(
      root,
      'te.go',
      'package te\n\nfunc T() int { return 1 }\n',
    );

    const { result } = await vet(root, [file], {
      ...process.env,
      GOFLAGS: `-toolexec=${script}`,
    });

    expect(result.status).toBe('checked');
    expect(fs.existsSync(marker)).toBe(false);
  });
});
