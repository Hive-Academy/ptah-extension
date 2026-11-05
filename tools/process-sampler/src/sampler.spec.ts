import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  aggregate,
  buildTrees,
  classify,
  outputPaths,
  parseArgs,
  parseCmdline,
  parseStat,
  percentile,
  processCpuPercent,
  renderMarkdown,
  summarizeSample,
} from './sampler';

// /proc/<pid>/stat fixtures: the first captured on Linux 7.0, the second with
// a comm that contains spaces and parentheses.
const CAT_STAT =
  '1159907 (cat) R 1159904 1159907 1159904 0 -1 4194304 90 0 0 0 0 0 0 0 20 0 1 0 12421357 8646656 442 18446744073709551615 98492877529088 98492877546673 140737235511200 0 0 0 0 0 0 0 0 0 17 1 0 0 0 0 0 98492877560464 98492877561960 98493309726720 140737235518716 140737235518736 140737235518736 140737235521515 0\n';
const ODD_COMM_STAT =
  '4242 (Web Content (2)) S 4200 4242 4200 0 -1 4194560 1200 0 3 0 1534 287 0 0 20 0 31 0 9876543 3221225472 51200 18446744073709551615 1 1 0 0 0 0 0 4096 1073745144 0 0 0 17 3 0 0 0 0 0 0 0 0 0 0 0 0 0\n';

describe('parseStat', () => {
  it('reads pid, comm, ppid, cpu ticks, start time and rss pages', () => {
    expect(parseStat(CAT_STAT)).toEqual({
      pid: 1159907,
      comm: 'cat',
      state: 'R',
      ppid: 1159904,
      utime: 0,
      stime: 0,
      starttime: 12421357,
      rssPages: 442,
    });
  });

  it('handles a comm with spaces and parentheses', () => {
    const stat = parseStat(ODD_COMM_STAT);
    expect(stat).toMatchObject({
      pid: 4242,
      comm: 'Web Content (2)',
      ppid: 4200,
      utime: 1534,
      stime: 287,
      starttime: 9876543,
      rssPages: 51200,
    });
  });

  it('returns null for truncated or garbage text', () => {
    expect(parseStat('')).toBeNull();
    expect(parseStat('12 (x) S 1 2 3')).toBeNull();
    expect(parseStat('not a stat line')).toBeNull();
  });
});

describe('parseCmdline', () => {
  it('splits a NUL-separated cmdline and drops the trailing NUL', () => {
    expect(parseCmdline('node\0/usr/bin/claude\0--print\0')).toEqual([
      'node',
      '/usr/bin/claude',
      '--print',
    ]);
    expect(parseCmdline('')).toEqual([]);
  });
});

describe('classify', () => {
  it.each([
    [['/opt/Ptah/ptah-desktop', '--type=renderer'], 'electron'],
    [['/repo/node_modules/electron/dist/electron', '.'], 'electron'],
    [
      [
        'node',
        '/usr/lib/node_modules/@hive-academy/ptah-cli/dist/main.js',
        'worker',
        'serve',
      ],
      'ptah-worker',
    ],
    [['node', '/usr/local/bin/ptah', 'interact'], 'ptah-worker'],
    [['node', '/usr/local/bin/claude', '--print'], 'cli-lane'],
    [
      [
        '/home/u/.npm/_npx/x/node_modules/@openai/codex/vendor/x86_64/codex/codex',
        'exec',
      ],
      'cli-lane',
    ],
    [['gemini', '-p', 'hi'], 'cli-lane'],
    [['node', '/repo/node_modules/.bin/nx', 'run-many'], 'nx-jest'],
    [
      ['/usr/bin/node', '/repo/node_modules/jest-worker/build/processChild.js'],
      'nx-jest',
    ],
    [
      ['python3', 'client.py', '--host', 'http://ollama:11434'],
      'ollama-client',
    ],
    [['/usr/bin/bash'], 'other'],
  ])('%j is %s', (argv, expected) => {
    expect(classify(argv, 'x')).toBe(expected);
  });

  it('falls back to comm when the cmdline is empty', () => {
    expect(classify([], 'kworker/0:1')).toBe('other');
    expect(classify([], 'claude')).toBe('cli-lane');
  });
});

describe('buildTrees', () => {
  const procs = [
    { pid: 1, ppid: 0, comm: 'systemd', argv: ['/sbin/init'] },
    {
      pid: 100,
      ppid: 1,
      comm: 'ptah-desktop',
      argv: ['/opt/Ptah/ptah-desktop'],
    },
    {
      pid: 101,
      ppid: 100,
      comm: 'ptah-desktop',
      argv: ['/opt/Ptah/ptah-desktop', '--type=gpu-process'],
    },
    // A CLI lane spawned by the desktop app is its own tree.
    {
      pid: 200,
      ppid: 100,
      comm: 'node',
      argv: ['node', '/usr/local/bin/claude'],
    },
    // Its unclassified children inherit the lane.
    { pid: 201, ppid: 200, comm: 'bash', argv: ['/bin/bash', '-c', 'ls'] },
    { pid: 202, ppid: 201, comm: 'rg', argv: ['rg', 'foo'] },
    { pid: 300, ppid: 1, comm: 'bash', argv: ['/bin/bash'] },
    { pid: 301, ppid: 300, comm: 'vim', argv: ['vim'] },
    // Parent already exited: rooted at itself.
    {
      pid: 400,
      ppid: 999,
      comm: 'node',
      argv: ['node', '/repo/node_modules/.bin/nx', 'test'],
    },
    { pid: 401, ppid: 400, comm: 'node', argv: ['node', 'worker.js'] },
  ];

  it('roots every process at its nearest classified tree', () => {
    const trees = buildTrees(procs);
    expect(trees.get(100)).toEqual({ group: 'electron', rootPid: 100 });
    // Same-class child stays in its parent's tree.
    expect(trees.get(101)).toEqual({ group: 'electron', rootPid: 100 });
    expect(trees.get(200)).toEqual({ group: 'cli-lane', rootPid: 200 });
    expect(trees.get(201)).toEqual({ group: 'cli-lane', rootPid: 200 });
    expect(trees.get(202)).toEqual({ group: 'cli-lane', rootPid: 200 });
    expect(trees.get(400)).toEqual({ group: 'nx-jest', rootPid: 400 });
    expect(trees.get(401)).toEqual({ group: 'nx-jest', rootPid: 400 });
  });

  it('puts unclassified chains in other, rooted at the topmost known ancestor', () => {
    const trees = buildTrees(procs);
    expect(trees.get(1)).toEqual({ group: 'other', rootPid: 1 });
    expect(trees.get(300)).toEqual({ group: 'other', rootPid: 1 });
    expect(trees.get(301)).toEqual({ group: 'other', rootPid: 1 });
    expect(trees.size).toBe(procs.length);
  });

  it('terminates on a parent cycle', () => {
    const trees = buildTrees([
      { pid: 10, ppid: 11, comm: 'a', argv: ['a'] },
      { pid: 11, ppid: 10, comm: 'b', argv: ['b'] },
    ]);
    expect(trees.get(10)?.group).toBe('other');
    expect(trees.get(11)?.group).toBe('other');
  });
});

describe('processCpuPercent', () => {
  const proc = {
    pid: 5,
    ppid: 1,
    comm: 'x',
    argv: [],
    ticks: 350,
    starttime: 1000,
    rssBytes: 0,
  };

  it('converts the tick delta over the interval into % of one core', () => {
    const previous = new Map([['5:1000', 250]]);
    // 100 ticks at 100 Hz over 2 s = 0.5 core-seconds per second.
    expect(
      processCpuPercent(proc, previous, {
        elapsedSec: 2,
        previousUptimeSec: 50,
        clkTck: 100,
      }),
    ).toBe(50);
  });

  it('counts a process born after the previous sample from its start', () => {
    // starttime 1000 ticks = 10 s after boot; the previous sample was at 9 s.
    expect(
      processCpuPercent(proc, new Map(), {
        elapsedSec: 2,
        previousUptimeSec: 9,
        clkTck: 100,
      }),
    ).toBe(175);
  });

  it('has no value for an older process without a baseline or the first sample', () => {
    expect(
      processCpuPercent(proc, new Map(), {
        elapsedSec: 2,
        previousUptimeSec: 60,
        clkTck: 100,
      }),
    ).toBeNull();
    expect(
      processCpuPercent(proc, new Map(), {
        elapsedSec: 0,
        previousUptimeSec: null,
        clkTck: 100,
      }),
    ).toBeNull();
  });
});

describe('summarizeSample', () => {
  it('sums cpu and rss per group and counts distinct roots', () => {
    const base = { comm: 'node', ticks: 0, starttime: 1 };
    const processes = [
      { ...base, pid: 200, ppid: 1, argv: ['claude'], rssBytes: 100 },
      { ...base, pid: 201, ppid: 200, argv: ['bash'], rssBytes: 50 },
      { ...base, pid: 300, ppid: 1, argv: ['codex'], rssBytes: 25 },
    ];
    const trees = buildTrees(processes);
    const cpu = new Map([
      [200, 10],
      [201, 5],
      [300, 1],
    ]);
    expect(summarizeSample(processes, trees, cpu)).toEqual({
      'cli-lane': { cpuPercent: 16, rssBytes: 175, processes: 3, roots: 2 },
    });
  });
});

describe('percentile and aggregate', () => {
  it('uses nearest-rank percentiles', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBe(0);
  });

  it('reports mean, p95 and max per group over the samples where it was present', () => {
    const g = (
      cpuPercent: number,
      rssBytes: number,
      processes = 1,
      roots = 1,
    ) => ({
      cpuPercent,
      rssBytes,
      processes,
      roots,
    });
    const report = aggregate([
      // First sample: no CPU baseline, RSS only.
      { cpuValid: false, groups: { other: g(0, 10), electron: g(0, 1000, 4) } },
      { cpuValid: true, groups: { other: g(2, 20), electron: g(30, 1200, 5) } },
      {
        cpuValid: true,
        groups: { electron: g(10, 1100, 5), 'cli-lane': g(80, 500, 3, 2) },
      },
    ]);
    expect(report.map((r) => r.group)).toEqual([
      'electron',
      'cli-lane',
      'other',
    ]);
    const [electron, lane, other] = report;
    expect(electron).toEqual({
      group: 'electron',
      presentSamples: 3,
      cpuPercent: { mean: 20, p95: 30, max: 30 },
      rssBytes: { mean: 1100, p95: 1200, max: 1200 },
      maxProcesses: 5,
      maxRoots: 1,
    });
    expect(lane.cpuPercent).toEqual({ mean: 80, p95: 80, max: 80 });
    expect(lane.maxRoots).toBe(2);
    expect(other.presentSamples).toBe(2);
    expect(other.cpuPercent).toEqual({ mean: 2, p95: 2, max: 2 });
    expect(other.rssBytes.mean).toBe(15);
  });

  it('renders a Markdown row per group and the overhead line', () => {
    const groups = aggregate([
      {
        cpuValid: true,
        groups: {
          electron: {
            cpuPercent: 12.5,
            rssBytes: 1048576 * 300,
            processes: 6,
            roots: 1,
          },
        },
      },
    ]);
    const md = renderMarkdown({
      startedAt: '2026-11-02T00:00:00.000Z',
      durationSec: 4,
      intervalMs: 2000,
      sampleCount: 1,
      overhead: { cpuPercent: 0.25, limitPercent: 1, withinLimit: true },
      groups,
    });
    expect(md).toContain(
      '| electron | 1 | 12.5 | 12.5 | 12.5 | 300.0 | 300.0 | 300.0 | 6 | 1 |',
    );
    expect(md).toContain(
      'Sampler overhead: 0.250% of one core (limit 1%: within).',
    );
  });
});

describe('parseArgs and outputPaths', () => {
  it('parses duration, interval and out', () => {
    expect(parseArgs(['--duration', '1800', '--out', 'r.json'])).toEqual({
      durationSec: 1800,
      intervalMs: 2000,
      out: 'r.json',
    });
    expect(parseArgs(['--interval', '500']).intervalMs).toBe(500);
  });

  it('rejects unknown flags and bad numbers', () => {
    expect(() => parseArgs(['--duration', 'abc'])).toThrow(
      '--duration needs a positive number',
    );
    expect(() => parseArgs(['--bogus'])).toThrow('unknown argument');
    expect(() => parseArgs(['--out'])).toThrow('--out needs a file path');
  });

  it('derives the json and md paths', () => {
    expect(outputPaths('r.json')).toEqual({ json: 'r.json', md: 'r.md' });
    expect(outputPaths('out/report')).toEqual({
      json: 'out/report.json',
      md: 'out/report.md',
    });
  });
});

describe('CLI entry', () => {
  const script = join(__dirname, 'sampler.js');

  function runNode(args: string[], preload?: string) {
    const dir = mkdtempSync(join(tmpdir(), 'process-sampler-'));
    try {
      const nodeArgs: string[] = [];
      if (preload) {
        const file = join(dir, 'preload.js');
        writeFileSync(file, preload);
        nodeArgs.push('--require', file);
      }
      return spawnSync(process.execPath, [...nodeArgs, script, ...args], {
        encoding: 'utf8',
        timeout: 20000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('exits 2 on a non-Linux platform', () => {
    const result = runNode(
      ['--duration', '1'],
      "Object.defineProperty(process, 'platform', { value: 'darwin' });",
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Linux /proc required (platform darwin)');
  });

  it('exits 64 with usage on a bad argument', () => {
    const result = runNode(['--bogus']);
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('usage: sampler.js');
  });

  (process.platform === 'linux' ? it : it.skip)(
    'samples the live host and writes JSON plus Markdown',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'process-sampler-out-'));
      try {
        const out = join(dir, 'report');
        const result = runNode([
          '--duration',
          '1',
          '--interval',
          '500',
          '--out',
          out,
        ]);
        expect(result.status).toBe(0);
        const report = JSON.parse(readFileSync(`${out}.json`, 'utf8'));
        expect(report.sampleCount).toBe(3);
        expect(report.groups.length).toBeGreaterThan(0);
        expect(typeof report.overhead.cpuPercent).toBe('number');
        expect(readFileSync(`${out}.md`, 'utf8')).toContain(
          '| Group | Samples |',
        );
        expect(result.stdout).toContain('Sampler overhead:');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
