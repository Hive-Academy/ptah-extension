/**
 * M2 performance harness — `git:status-update` handling cost (B0, TASK_2026_173).
 *
 * Builds 300 `GitFileStatus` entries + 100 `FileTreeNodeComponent` fixtures
 * wired to a REAL (non-mocked) `GitStatusService` instance, dispatches a
 * synthetic `git:status-update` window message, and times
 * `fixture.detectChanges()` across all 100 fixtures plus `TestBed.flushEffects()`.
 * 10 iterations; median + max reported.
 *
 * DEVIATION FROM B0 AC5 (Electron as reference runtime) — DELIBERATE, FLAGGED
 * PER B0 AC4: this cost is entirely renderer-side (Angular signal propagation
 * + OnPush change detection over the file tree) and identical across VS Code,
 * Electron and the CLI's webview host. A Jest harness gives a far more
 * reproducible number than a GPU-scheduled Electron window, and doubles as a
 * permanent regression guard via the upper-bound assertion below. The Jest
 * figure here is the one reported as M2 in measurements.md. An Electron
 * spot-check lives in
 * apps/ptah-electron-e2e/src/specs/editor/perf-m2-electron-spotcheck.spec.ts
 * for confirmation only — see measurements.md for both figures and this
 * deviation restated.
 *
 * `rpcCall` is mocked at the module boundary (same pattern as
 * git-status.service.spec.ts); VSCodeService is a minimal stub. Only
 * `GitStatusService` and `FileTreeNodeComponent` are real.
 */

import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import type { GitFileStatus, GitBranchInfo } from '@ptah-extension/shared';
import { GitStatusService } from '../services/git-status.service';
import { EditorService } from '../services/editor.service';
import { FileTreeNodeComponent } from './file-tree-node.component';
import type { FileTreeNode } from '../models/file-tree.model';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

const WORKSPACE_ROOT = 'C:/ptah-m2-ws';
const FILE_FIXTURE_COUNT = 90;
const DIR_FIXTURE_COUNT = 10;
const NODE_FIXTURE_COUNT = FILE_FIXTURE_COUNT + DIR_FIXTURE_COUNT; // 100, per workload spec
const STATUS_ENTRY_COUNT = 300;
const ITERATIONS = 10;

/**
 * Generous upper bound so this regression guard fires only on a genuine
 * multiplicative blowup, not machine noise. This measures the BEFORE cost —
 * Batch 4 (B3) replaces the O(files × tree nodes) linear scan this workload
 * is deliberately sized to expose with an O(1) `changedDirPrefixes` lookup
 * and records an after-figure here in the same measurements.md row.
 */
const MAX_ACCEPTABLE_MEDIAN_MS = 500;
const MAX_ACCEPTABLE_MAX_MS = 1000;

function branch(): GitBranchInfo {
  return { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 };
}

/**
 * 300 changed-file entries spread across 10 directories. One bit of state
 * (file[0]'s status) toggles per iteration so the service's custom
 * `equal: filesEqual` signal comparator sees a genuine change and actually
 * propagates — a byte-identical payload would (correctly) no-op and
 * understate the real handling cost.
 */
function buildFiles(iteration: number): GitFileStatus[] {
  const files: GitFileStatus[] = [];
  for (let i = 0; i < STATUS_ENTRY_COUNT; i++) {
    const toggled = i === 0 && iteration % 2 === 1;
    files.push({
      path: `src/dir${i % 10}/file${i}.ts`,
      status: toggled ? 'A' : 'M',
      staged: i % 3 === 0,
      isDirectory: false,
    });
  }
  return files;
}

function fileNode(relativePath: string): FileTreeNode {
  const name = relativePath.split('/').pop() ?? relativePath;
  return { name, path: `${WORKSPACE_ROOT}/${relativePath}`, type: 'file' };
}

function dirNode(relativePath: string): FileTreeNode {
  const name = relativePath.split('/').pop() ?? relativePath;
  return {
    name,
    path: `${WORKSPACE_ROOT}/${relativePath}`,
    type: 'directory',
    needsLoad: false,
    children: [],
  };
}

function makeVscodeStub() {
  const _config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: WORKSPACE_ROOT,
    workspaceName: 'm2-ws',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
  });
  return {
    config: _config.asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

describe('perf M2 — git:status-update handling cost (B0)', () => {
  let gitStatus: GitStatusService;
  let fixtures: ComponentFixture<FileTreeNodeComponent>[];

  const editorMock = {
    loadDirectoryChildren: jest.fn().mockResolvedValue(undefined),
    createFile: jest.fn().mockResolvedValue(true),
    createFolder: jest.fn().mockResolvedValue(true),
    renameItem: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { branch: branch(), files: [], isGitRepo: true },
    });

    await TestBed.configureTestingModule({
      imports: [FileTreeNodeComponent],
      providers: [
        GitStatusService,
        { provide: VSCodeService, useValue: makeVscodeStub() },
        { provide: EditorService, useValue: editorMock },
      ],
    }).compileComponents();

    gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace(WORKSPACE_ROOT);
    gitStatus.startListening();
    // Let the stubbed (empty-files) eager fetches from switchWorkspace() and
    // startListening() settle before the timed loop starts.
    await Promise.resolve();
    await Promise.resolve();

    fixtures = [];
    for (let i = 0; i < FILE_FIXTURE_COUNT; i++) {
      const fixture = TestBed.createComponent(FileTreeNodeComponent);
      fixture.componentRef.setInput(
        'node',
        fileNode(`dir${i % 10}/file${i}.ts`),
      );
      fixture.componentRef.setInput('depth', 1);
      fixture.detectChanges();
      fixtures.push(fixture);
    }
    for (let i = 0; i < DIR_FIXTURE_COUNT; i++) {
      const fixture = TestBed.createComponent(FileTreeNodeComponent);
      fixture.componentRef.setInput('node', dirNode(`dir${i}`));
      fixture.componentRef.setInput('depth', 0);
      fixture.detectChanges();
      fixtures.push(fixture);
    }
    expect(fixtures.length).toBe(NODE_FIXTURE_COUNT);
  });

  afterEach(() => {
    gitStatus.stopListening();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('handles a 300-entry git:status-update in bounded time (median + max over 10 iterations)', () => {
    const samples: number[] = [];

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const files = buildFiles(iter);
      const start = performance.now();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'git:status-update',
            payload: {
              branch: branch(),
              files,
              isGitRepo: true,
              workspaceRoot: WORKSPACE_ROOT,
            },
          },
        }),
      );

      for (const fixture of fixtures) {
        fixture.detectChanges();
      }
      TestBed.flushEffects();

      samples.push(performance.now() - start);
    }

    const med = median(samples);
    const max = Math.max(...samples);

    console.log(
      `[perf-m2] git:status-update handling — median=${med.toFixed(
        3,
      )}ms max=${max.toFixed(3)}ms samples=${JSON.stringify(
        samples.map((s) => Number(s.toFixed(3))),
      )}`,
    );

    // Regression guard, not a tight perf gate — see MAX_ACCEPTABLE_* comment.
    expect(med).toBeLessThan(MAX_ACCEPTABLE_MEDIAN_MS);
    expect(max).toBeLessThan(MAX_ACCEPTABLE_MAX_MS);
  });
});
