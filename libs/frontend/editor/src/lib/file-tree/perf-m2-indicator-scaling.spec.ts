/**
 * M2 scaling probe — directory-indicator lookup cost vs changed-file count
 * (B0 AC1/AC4, B3 AC2, TASK_2026_173 Task 4.5).
 *
 * WHY THIS EXISTS, SEPARATE FROM `perf-m2-status-update.spec.ts`:
 * that harness reports the M2 figure — end-to-end `git:status-update` handling
 * over 300 entries and 100 real `FileTreeNodeComponent` fixtures — and its
 * total is dominated by Angular change detection across those fixtures. At that
 * workload the directory-indicator scan is a small share of the total, so its
 * median is NOT evidence for the actual B3 claim, which is asymptotic: the cost
 * must not grow multiplicatively with (directory nodes × changed files).
 *
 * This probe measures exactly that term and nothing else. Over the SAME real
 * `GitStatusService` state it compares:
 *
 *   - SHIPPED   — one `changedDirPrefixes().has(dir)` per directory node.
 *   - REFERENCE — the pre-B3 strategy, re-implemented here because it no
 *     longer exists in source: per directory node, walk the keys of
 *     `fileStatusMap()` testing `key.startsWith(dir + '/')`, stopping at the
 *     first hit exactly as the original did.
 *
 * THE DIRECTORY MIX IS LOAD-BEARING. The reference scan short-circuits on its
 * first hit, so a directory that DOES contain changes is cheap to answer. Its
 * worst case — and the common case in a real tree, where most expanded
 * directories are untouched — is a directory with NO changes: that answer costs
 * a full walk of every changed-file key. The workload below is therefore half
 * changed directories and half untouched ones, which is what makes the
 * multiplicative term visible at all.
 *
 * Both strategies are timed at 300 and 3000 changed files with the directory
 * count held constant. The shipped strategy must stay flat as files grow 10x.
 * Only the shipped strategy is asserted on — the reference figure is logged as
 * context and never gates the build.
 *
 * `rpcCall` is mocked at the module boundary (same pattern as
 * git-status.service.spec.ts); only `GitStatusService` is real.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { GitFileStatus, GitBranchInfo } from '@ptah-extension/shared';
import { GitStatusService } from '../services/git-status.service';

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

const WORKSPACE_ROOT = 'C:/ptah-m2-scale';
/** Directories that contain changes (the reference scan short-circuits on these). */
const CHANGED_DIR_COUNT = 50;
/** Untouched directories — the reference scan's worst case, and the common case. */
const UNCHANGED_DIR_COUNT = 50;
const DIR_NODE_COUNT = CHANGED_DIR_COUNT + UNCHANGED_DIR_COUNT;
/** Passes per measurement, so one pass's noise does not dominate. */
const REPETITIONS = 50;
/**
 * Untimed passes run before every timed loop. Without these the FIRST
 * measurement runs interpreted and the second runs JIT-optimized, which alone
 * moved the reference figure by ~6x in early runs — it would have understated
 * the very growth this probe exists to show.
 */
const WARMUP_PASSES = 10;
const SMALL_FILE_COUNT = 300;
const LARGE_FILE_COUNT = 3000;

/**
 * Growth allowance for the shipped strategy when the changed-file count grows
 * 10x. A genuinely constant-time lookup lands near 1x; anything multiplicative
 * lands near 10x. 3x leaves generous room for allocator and cache noise on a
 * loaded machine while still failing a reintroduced scan.
 */
const MAX_SHIPPED_GROWTH_FACTOR = 3;

function branch(): GitBranchInfo {
  return { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 };
}

/** `count` changed files spread evenly across the CHANGED directories. */
function buildFiles(count: number): GitFileStatus[] {
  const files: GitFileStatus[] = [];
  for (let i = 0; i < count; i++) {
    files.push({
      path: `src/dir${i % CHANGED_DIR_COUNT}/nested/file${i}.ts`,
      status: 'M',
      staged: i % 3 === 0,
      isDirectory: false,
    });
  }
  return files;
}

/** Workspace-relative paths of the directory nodes the tree asks about. */
const DIR_PATHS = [
  ...Array.from({ length: CHANGED_DIR_COUNT }, (_, i) => `src/dir${i}`),
  ...Array.from({ length: UNCHANGED_DIR_COUNT }, (_, i) => `vendor/pkg${i}`),
];

function makeVscodeStub() {
  const _config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: WORKSPACE_ROOT,
    workspaceName: 'm2-scale',
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

/**
 * Run both strategies untimed so the timed loops below measure optimized code
 * in both the small and the large workload. Returns a value derived from both
 * so no engine can eliminate the work as dead.
 */
function warmUp(
  prefixes: ReadonlySet<string>,
  statusMap: ReadonlyMap<string, unknown>,
): number {
  let sink = 0;
  for (let r = 0; r < WARMUP_PASSES; r++) {
    for (const dir of DIR_PATHS) {
      if (prefixes.has(dir)) sink++;
      const dirPrefix = dir + '/';
      for (const key of statusMap.keys()) {
        if (key.startsWith(dirPrefix)) {
          sink++;
          break;
        }
      }
    }
  }
  return sink;
}

describe('perf M2 scaling — directory indicator lookup (B3 AC2)', () => {
  let gitStatus: GitStatusService;

  beforeEach(async () => {
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { branch: branch(), files: [], isGitRepo: true },
    });

    TestBed.configureTestingModule({
      providers: [
        GitStatusService,
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace(WORKSPACE_ROOT);
    gitStatus.startListening();
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    gitStatus.stopListening();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  /**
   * Load `fileCount` changed files, then time both lookup strategies over the
   * same DIR_NODE_COUNT directories. The set and map are materialized (and the
   * set build separately timed) BEFORE the loops, so the per-node figures are
   * lookup cost only.
   */
  function measure(fileCount: number): {
    buildMs: number;
    shippedMs: number;
    referenceMs: number;
    marked: number;
  } {
    gitStatus.handleMessage({
      type: MESSAGE_TYPES.GIT_STATUS_UPDATE,
      payload: {
        branch: branch(),
        files: buildFiles(fileCount),
        isGitRepo: true,
        workspaceRoot: WORKSPACE_ROOT,
      },
    });

    // One-per-update cost, O(total path segments) — reported for completeness,
    // not part of the per-node figures below.
    const buildStart = performance.now();
    const prefixes = gitStatus.changedDirPrefixes();
    const buildMs = performance.now() - buildStart;
    const statusMap = gitStatus.fileStatusMap();

    warmUp(prefixes, statusMap);

    let marked = 0;
    const shippedStart = performance.now();
    for (let r = 0; r < REPETITIONS; r++) {
      for (const dir of DIR_PATHS) {
        if (prefixes.has(dir)) marked++;
      }
    }
    const shippedMs = performance.now() - shippedStart;

    let referenceMarked = 0;
    const referenceStart = performance.now();
    for (let r = 0; r < REPETITIONS; r++) {
      for (const dir of DIR_PATHS) {
        const dirPrefix = dir + '/';
        for (const key of statusMap.keys()) {
          if (key.startsWith(dirPrefix)) {
            referenceMarked++;
            break;
          }
        }
      }
    }
    const referenceMs = performance.now() - referenceStart;

    // Both strategies must agree, or the comparison is meaningless.
    expect(marked).toBe(referenceMarked);

    return { buildMs, shippedMs, referenceMs, marked };
  }

  it('stays flat as changed files grow 10x, where the pre-B3 scan grows with them', () => {
    const small = measure(SMALL_FILE_COUNT);
    const large = measure(LARGE_FILE_COUNT);

    // Exactly the changed half is marked, at both workloads (B3 AC3, both
    // directions, over the same data the timings came from).
    expect(small.marked).toBe(CHANGED_DIR_COUNT * REPETITIONS);
    expect(large.marked).toBe(CHANGED_DIR_COUNT * REPETITIONS);

    const shippedGrowth = large.shippedMs / small.shippedMs;
    const referenceGrowth = large.referenceMs / small.referenceMs;

    console.log(
      `[perf-m2-scaling] ${DIR_NODE_COUNT} dirs (${CHANGED_DIR_COUNT} changed / ` +
        `${UNCHANGED_DIR_COUNT} untouched) x ${REPETITIONS} passes\n` +
        `  ${SMALL_FILE_COUNT} files: shipped=${small.shippedMs.toFixed(
          3,
        )}ms reference=${small.referenceMs.toFixed(
          3,
        )}ms setBuild=${small.buildMs.toFixed(3)}ms\n` +
        `  ${LARGE_FILE_COUNT} files: shipped=${large.shippedMs.toFixed(
          3,
        )}ms reference=${large.referenceMs.toFixed(
          3,
        )}ms setBuild=${large.buildMs.toFixed(3)}ms\n` +
        `  growth on 10x files: shipped=${shippedGrowth.toFixed(
          2,
        )}x reference=${referenceGrowth.toFixed(2)}x`,
    );

    // The B3 claim: the (directories x changed files) term is gone.
    expect(shippedGrowth).toBeLessThan(MAX_SHIPPED_GROWTH_FACTOR);
  });
});
