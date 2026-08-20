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
 * Each workload is sampled TRIALS times, interleaved with the other, and
 * reduced by MINIMUM. That is the TASK_2026_217 fix, and the reasoning is on
 * those three constants below: the assertion is a quotient of two
 * sub-millisecond timings, which one sample each cannot measure steadily
 * enough to be worth failing a build over.
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
/**
 * Lookups per timed sample. Deliberately UNCHANGED at 50 by TASK_2026_217,
 * after raising it was tried and rejected: at 400 the same loop measured
 * 0.373ms where 50 measured 0.889ms — eight times the work in less than half
 * the time, i.e. V8 hoisting a `has` on a set it can prove never changes. A
 * bigger sample here does not buy a steadier one, it buys a meaningless one,
 * and it would silently turn this probe into a test that cannot fail. Holding
 * the workload also keeps these figures comparable with the ones recorded in
 * TASK_2026_173's measurements.md.
 */
const REPETITIONS = 50;

/**
 * Independent samples per workload, taken INTERLEAVED (small, large, small,
 * large, ...) rather than in two blocks, so a machine that gets slower partway
 * through the run does not land entirely on the large workload and manufacture
 * growth that is not there.
 *
 * This, not the threshold, is the TASK_2026_217 fix. The assertion divides one
 * sub-millisecond measurement by another, so a single GC pause or scheduler
 * slice in either one moves the QUOTIENT by an order of magnitude. Measured
 * over 12 consecutive local runs each way, on an idle machine:
 *
 *   one sample per workload   shipped growth 0.65x - 2.25x   (threshold is 3)
 *   min of 7, interleaved     shipped growth 0.94x - 1.22x
 *
 * The CI failure that opened TASK_2026_217 reported 23.89x from the left-hand
 * column. Note what the right-hand column costs: nothing but seven passes.
 */
const TRIALS = 7;

/**
 * Each workload is summarised by its MINIMUM sample, not its mean or median.
 * Timing noise is strictly additive — a sample can be delayed by a GC pause
 * but can never finish faster than the work takes — so across several samples
 * the minimum is the best available estimate of the true cost, and the one
 * least sensitive to how loaded the machine is.
 *
 * It also fixed the number this file exists to REPORT, not just the one it
 * asserts. A single sample put the reference scan's growth at 1.37x-4.67x for
 * a 10x workload; the minimum puts it at 6.0x-12.2x. A linear scan over 10x
 * the keys must cost about 10x, so the old figure was understating the very
 * growth this probe was written to show — the same noise, read as evidence.
 */
const summarise = (samples: readonly number[]): number => Math.min(...samples);

/**
 * A sample below this is dominated by timer resolution rather than by work,
 * and a ratio built from it means nothing.
 *
 * Calibrated against what the minimum sample actually measures here: ~0.038ms
 * for 5,000 lookups, i.e. ~8ns each, which is a believable optimised
 * `Set.has`. (The FIRST sample costs ~0.889ms for the same work — that is the
 * unoptimised figure recorded in measurements.md, and the reason the samples
 * below are reduced by minimum rather than averaged.) The floor sits well
 * under that so a healthy run clears it, and above what a collapsed workload
 * can reach: at REPETITIONS = 1 the same probe measures 0.005-0.014ms across
 * three runs, i.e. mostly the cost of the timer call itself. So shrinking the
 * workload, or an engine optimising the loop away entirely as raising
 * REPETITIONS to 400 did, fails loudly here rather than quietly restoring the
 * flake — or replacing it with a test that cannot fail.
 */
const MIN_MEANINGFUL_SAMPLE_MS = 0.02;
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
 * lands near 10x.
 *
 * The number is unchanged by TASK_2026_217, but its justification is now true
 * rather than hopeful: 3x was always described as leaving "generous room for
 * noise", and against a single sample it did not — noise alone reached 2.25x
 * locally and 23.89x in CI. Against the minimum of TRIALS interleaved samples
 * the observed range is 0.94x-1.22x, so 3x is finally the generous margin it
 * was documented to be, and a reintroduced scan still lands near 10x.
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
   * ONE sample: load `fileCount` changed files, then time both lookup
   * strategies over the same DIR_NODE_COUNT directories. The set and map are
   * materialized (and the set build separately timed) BEFORE the loops, so the
   * per-node figures are lookup cost only.
   *
   * Called TRIALS times per workload — see `summarise` for why the samples are
   * reduced by minimum.
   */
  function sample(fileCount: number): {
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
    const small: number[] = [];
    const large: number[] = [];
    const smallReference: number[] = [];
    const largeReference: number[] = [];
    let smallBuildMs = 0;
    let largeBuildMs = 0;

    for (let trial = 0; trial < TRIALS; trial++) {
      const s = sample(SMALL_FILE_COUNT);
      const l = sample(LARGE_FILE_COUNT);

      // Exactly the changed half is marked, at both workloads, on every trial
      // (B3 AC3, both directions, over the same data the timings came from).
      expect(s.marked).toBe(CHANGED_DIR_COUNT * REPETITIONS);
      expect(l.marked).toBe(CHANGED_DIR_COUNT * REPETITIONS);

      small.push(s.shippedMs);
      large.push(l.shippedMs);
      smallReference.push(s.referenceMs);
      largeReference.push(l.referenceMs);
      smallBuildMs = s.buildMs;
      largeBuildMs = l.buildMs;
    }

    const smallMs = summarise(small);
    const largeMs = summarise(large);
    const shippedGrowth = largeMs / smallMs;
    const referenceGrowth =
      summarise(largeReference) / summarise(smallReference);

    const format = (samples: readonly number[]): string =>
      samples.map((ms) => ms.toFixed(2)).join(' ');

    console.log(
      `[perf-m2-scaling] ${DIR_NODE_COUNT} dirs (${CHANGED_DIR_COUNT} changed / ` +
        `${UNCHANGED_DIR_COUNT} untouched) x ${REPETITIONS} lookups x ` +
        `${TRIALS} trials, reduced by min
` +
        `  ${SMALL_FILE_COUNT} files: shipped=${smallMs.toFixed(
          3,
        )}ms reference=${summarise(smallReference).toFixed(
          3,
        )}ms setBuild=${smallBuildMs.toFixed(3)}ms
` +
        `  ${LARGE_FILE_COUNT} files: shipped=${largeMs.toFixed(
          3,
        )}ms reference=${summarise(largeReference).toFixed(
          3,
        )}ms setBuild=${largeBuildMs.toFixed(3)}ms
` +
        `  growth on 10x files: shipped=${shippedGrowth.toFixed(
          2,
        )}x reference=${referenceGrowth.toFixed(2)}x
` +
        `  shipped samples (ms): small=[${format(small)}] large=[${format(
          large,
        )}]`,
    );

    // The ratio is only worth asserting on if the samples it divides are
    // measurements rather than timer granularity. This is the guard on the
    // flake itself, not on the code under test.
    expect(smallMs).toBeGreaterThan(MIN_MEANINGFUL_SAMPLE_MS);
    expect(largeMs).toBeGreaterThan(MIN_MEANINGFUL_SAMPLE_MS);

    // The B3 claim: the (directories x changed files) term is gone.
    expect(shippedGrowth).toBeLessThan(MAX_SHIPPED_GROWTH_FACTOR);
  });
});
