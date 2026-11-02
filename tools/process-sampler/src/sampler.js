#!/usr/bin/env node
// Phase 0 process sampler (TASK_2026_858_f7b9, P0-1).
//
// Samples /proc/<pid>/stat (CPU ticks and RSS) on a fixed interval, groups
// every process under its nearest classified ancestor (the tree root), and
// reports mean, p95 and max CPU (% of one core) and RSS per group as JSON and
// a Markdown table.
//
// CommonJS with Node built-ins only, so it runs unbuilt on a Node 20 worker:
//   node tools/process-sampler/src/sampler.js --duration 1800 --out report
// Linux only: any other platform exits with code 2.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXIT_UNSUPPORTED = 2;
const EXIT_USAGE = 64;
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_DURATION_SEC = 60;
const OVERHEAD_LIMIT_PERCENT = 1;

/**
 * Command-line classes, in match order. The first class whose test accepts a
 * process wins; a process that matches none is `other` and inherits the class
 * of its nearest classified ancestor.
 */
const GROUPS = Object.freeze([
  'ptah-worker',
  'electron',
  'cli-lane',
  'nx-jest',
  'ollama-client',
  'other',
]);

const LANE_NAME = /^(codex|kimi|grok|claude|gemini)(?:[-.]|$)/i;
const LANE_PACKAGE =
  /(?:^|\/)(?:@openai\/codex|@anthropic-ai\/claude-code|@google\/gemini-cli|kimi-cli|grok-cli)(?:\/|$)/i;
const NX_JEST_TOKEN = /(?:^|\/)(?:nx|jest|jest-worker)(?:\/|\.js$|$)/;

/**
 * @typedef {object} StatRecord
 * @property {number} pid
 * @property {string} comm
 * @property {string} state
 * @property {number} ppid
 * @property {number} utime   user-mode ticks
 * @property {number} stime   kernel-mode ticks
 * @property {number} starttime ticks after boot
 * @property {number} rssPages resident pages (field 24; the same mm counter
 *   statm reports as `resident`, so statm is not read separately)
 */

/**
 * @typedef {object} ProcessInfo
 * @property {number} pid
 * @property {number} ppid
 * @property {string} comm
 * @property {string[]} argv
 * @property {number} ticks   utime + stime
 * @property {number} starttime
 * @property {number} rssBytes
 */

/**
 * @typedef {object} TreeNode
 * @property {string} group
 * @property {number} rootPid
 */

/**
 * @typedef {object} GroupSample
 * @property {number} cpuPercent % of one core summed over the group
 * @property {number} rssBytes   summed resident set
 * @property {number} processes
 * @property {number} roots      distinct tree roots
 */

/**
 * @typedef {object} Stats
 * @property {number} mean
 * @property {number} p95
 * @property {number} max
 */

/**
 * @typedef {object} GroupReport
 * @property {string} group
 * @property {number} presentSamples
 * @property {Stats} cpuPercent
 * @property {Stats} rssBytes
 * @property {number} maxProcesses
 * @property {number} maxRoots
 */

/**
 * Parse the text of /proc/<pid>/stat. `comm` may contain spaces and
 * parentheses, so the fixed fields are read after the last `)`.
 * @param {string} text
 * @returns {StatRecord | null} null when the text is not a stat line
 */
function parseStat(text) {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 1 || close < open) return null;
  const pid = Number(text.slice(0, open).trim());
  const rest = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // rest[0] is field 3 (state); field N sits at rest[N - 3].
  if (!Number.isInteger(pid) || rest.length < 22) return null;
  const record = {
    pid,
    comm: text.slice(open + 1, close),
    state: rest[0],
    ppid: Number(rest[1]),
    utime: Number(rest[11]),
    stime: Number(rest[12]),
    starttime: Number(rest[19]),
    rssPages: Number(rest[21]),
  };
  const numeric = [
    record.ppid,
    record.utime,
    record.stime,
    record.starttime,
    record.rssPages,
  ];
  return numeric.every(Number.isFinite) ? record : null;
}

/**
 * Split /proc/<pid>/cmdline (NUL-separated, NUL-terminated) into argv.
 * Kernel threads have an empty cmdline and yield an empty array.
 * @param {string} text
 * @returns {string[]}
 */
function parseCmdline(text) {
  return text.split('\0').filter((part) => part.length > 0);
}

/**
 * Classify one process by its command line; `comm` is the fallback when the
 * cmdline is empty or unreadable.
 * @param {string[]} argv
 * @param {string} comm
 * @returns {string} one of GROUPS
 */
function classify(argv, comm) {
  const tokens = argv.length > 0 ? argv : [comm];
  const base = tokens.map((token) => path.posix.basename(token));
  const head = tokens.slice(0, 3);
  const headBase = base.slice(0, 3);

  const ptahEntry = head.some(
    (token, i) =>
      /ptah/i.test(token) &&
      !/ptah-desktop/i.test(token) &&
      (headBase[i] === 'ptah' || /ptah-cli/i.test(token)),
  );
  if (ptahEntry && tokens.some((t) => t === 'worker' || t === 'interact')) {
    return 'ptah-worker';
  }
  if (
    tokens.some((t) => /ptah-desktop/i.test(t)) ||
    /^electron$/i.test(base[0]) ||
    /(?:^|\/)electron\/dist\//i.test(tokens[0])
  ) {
    return 'electron';
  }
  if (
    headBase.slice(0, 2).some((b) => LANE_NAME.test(b)) ||
    head.slice(0, 2).some((t) => LANE_PACKAGE.test(t))
  ) {
    return 'cli-lane';
  }
  if (head.some((t) => NX_JEST_TOKEN.test(t))) return 'nx-jest';
  if (tokens.some((t) => /ollama/i.test(t))) return 'ollama-client';
  return 'other';
}

/**
 * Assign every process to a tree. A classified process roots its own tree
 * unless its parent has the same class (an Electron renderer under the main
 * process); an unclassified process joins its parent's tree. Unclassified
 * chains with no classified ancestor form `other`, rooted at their topmost
 * known ancestor.
 * @param {Iterable<{pid: number, ppid: number, argv: string[], comm: string}>} processes
 * @returns {Map<number, TreeNode>}
 */
function buildTrees(processes) {
  /** @type {Map<number, {pid: number, ppid: number, argv: string[], comm: string}>} */
  const byPid = new Map();
  for (const proc of processes) byPid.set(proc.pid, proc);

  /** @type {Map<number, string>} */
  const ownClass = new Map();
  for (const [pid, proc] of byPid)
    ownClass.set(pid, classify(proc.argv, proc.comm));

  /** @type {Map<number, TreeNode>} */
  const result = new Map();
  /** @type {Set<number>} */
  const visiting = new Set();

  /**
   * @param {number} pid a key of byPid
   * @returns {TreeNode}
   */
  const resolve = (pid) => {
    const known = result.get(pid);
    if (known) return known;
    visiting.add(pid);
    const proc = /** @type {{pid: number, ppid: number}} */ (byPid.get(pid));
    const group = ownClass.get(pid) ?? 'other';
    // A parent already on the walk means a cycle (a pid reused mid-read):
    // treat it as missing so the walk terminates.
    const hasParent = byPid.has(proc.ppid) && !visiting.has(proc.ppid);
    /** @type {TreeNode} */
    let node;
    if (group !== 'other') {
      node =
        hasParent && ownClass.get(proc.ppid) === group
          ? { group, rootPid: resolve(proc.ppid).rootPid }
          : { group, rootPid: pid };
    } else {
      node = hasParent ? resolve(proc.ppid) : { group: 'other', rootPid: pid };
    }
    visiting.delete(pid);
    result.set(pid, node);
    return node;
  };

  for (const pid of byPid.keys()) resolve(pid);
  return result;
}

/**
 * Per-process CPU since the previous sample, in % of one core.
 * A process first seen in this sample counts its ticks since start only when
 * it started after the previous sample; otherwise it has no baseline.
 * @param {ProcessInfo} proc
 * @param {Map<string, number>} previousTicks keyed by `${pid}:${starttime}`
 * @param {{ elapsedSec: number, previousUptimeSec: number | null, clkTck: number }} timing
 * @returns {number | null}
 */
function processCpuPercent(proc, previousTicks, timing) {
  if (timing.elapsedSec <= 0) return null;
  const before = previousTicks.get(`${proc.pid}:${proc.starttime}`);
  let delta;
  if (before !== undefined) {
    delta = proc.ticks - before;
  } else if (
    timing.previousUptimeSec !== null &&
    proc.starttime / timing.clkTck >= timing.previousUptimeSec
  ) {
    delta = proc.ticks;
  } else {
    return null;
  }
  return (Math.max(0, delta) / timing.clkTck / timing.elapsedSec) * 100;
}

/**
 * Sum one sample's processes per group.
 * @param {ProcessInfo[]} processes
 * @param {Map<number, TreeNode>} trees
 * @param {Map<number, number>} cpuByPid
 * @returns {Record<string, GroupSample>}
 */
function summarizeSample(processes, trees, cpuByPid) {
  /** @type {Record<string, GroupSample>} */
  const groups = {};
  /** @type {Record<string, Set<number>>} */
  const roots = {};
  for (const proc of processes) {
    const node = trees.get(proc.pid) ?? { group: 'other', rootPid: proc.pid };
    const entry =
      groups[node.group] ??
      (groups[node.group] = {
        cpuPercent: 0,
        rssBytes: 0,
        processes: 0,
        roots: 0,
      });
    entry.cpuPercent += cpuByPid.get(proc.pid) ?? 0;
    entry.rssBytes += proc.rssBytes;
    entry.processes += 1;
    (roots[node.group] ?? (roots[node.group] = new Set())).add(node.rootPid);
  }
  for (const group of Object.keys(groups))
    groups[group].roots = roots[group].size;
  return groups;
}

/**
 * Nearest-rank percentile of an unsorted list.
 * @param {number[]} values
 * @param {number} p 0..100
 * @returns {number}
 */
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/**
 * @param {number[]} values
 * @returns {Stats}
 */
function stats(values) {
  if (values.length === 0) return { mean: 0, p95: 0, max: 0 };
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    mean: sum / values.length,
    p95: percentile(values, 95),
    max: Math.max(...values),
  };
}

/**
 * Aggregate per-sample group sums into mean, p95 and max per group. Stats are
 * taken over the samples in which the group had at least one process.
 * CPU skips samples without a CPU baseline (the first sample).
 * @param {Array<{ cpuValid: boolean, groups: Record<string, GroupSample> }>} samples
 * @returns {GroupReport[]} in GROUPS order, then any unknown group by name
 */
function aggregate(samples) {
  /** @type {Map<string, { cpu: number[], rss: number[], present: number, maxProcesses: number, maxRoots: number }>} */
  const acc = new Map();
  for (const sample of samples) {
    for (const [group, value] of Object.entries(sample.groups)) {
      let entry = acc.get(group);
      if (!entry) {
        entry = { cpu: [], rss: [], present: 0, maxProcesses: 0, maxRoots: 0 };
        acc.set(group, entry);
      }
      entry.present += 1;
      entry.rss.push(value.rssBytes);
      if (sample.cpuValid) entry.cpu.push(value.cpuPercent);
      entry.maxProcesses = Math.max(entry.maxProcesses, value.processes);
      entry.maxRoots = Math.max(entry.maxRoots, value.roots);
    }
  }
  const order = (/** @type {string} */ g) => {
    const i = GROUPS.indexOf(g);
    return i === -1 ? GROUPS.length : i;
  };
  return [...acc.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([group, entry]) => ({
      group,
      presentSamples: entry.present,
      cpuPercent: stats(entry.cpu),
      rssBytes: stats(entry.rss),
      maxProcesses: entry.maxProcesses,
      maxRoots: entry.maxRoots,
    }));
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatMiB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * @param {{ startedAt: string, durationSec: number, intervalMs: number, sampleCount: number, overhead: { cpuPercent: number, limitPercent: number, withinLimit: boolean }, groups: GroupReport[] }} report
 * @returns {string}
 */
function renderMarkdown(report) {
  const lines = [
    `# Process sample — ${report.startedAt}`,
    '',
    `Duration ${report.durationSec.toFixed(0)} s, interval ${report.intervalMs} ms, ` +
      `${report.sampleCount} samples. CPU is % of one core; RSS in MiB. ` +
      'Stats cover the samples in which the group was present.',
    '',
    '| Group | Samples | CPU mean | CPU p95 | CPU max | RSS mean | RSS p95 | RSS max | Max procs | Max roots |',
    '| ----- | ------: | -------: | ------: | ------: | -------: | ------: | ------: | --------: | --------: |',
  ];
  for (const g of report.groups) {
    lines.push(
      `| ${g.group} | ${g.presentSamples} | ${g.cpuPercent.mean.toFixed(1)} | ` +
        `${g.cpuPercent.p95.toFixed(1)} | ${g.cpuPercent.max.toFixed(1)} | ` +
        `${formatMiB(g.rssBytes.mean)} | ${formatMiB(g.rssBytes.p95)} | ` +
        `${formatMiB(g.rssBytes.max)} | ${g.maxProcesses} | ${g.maxRoots} |`,
    );
  }
  const o = report.overhead;
  lines.push(
    '',
    `Sampler overhead: ${o.cpuPercent.toFixed(3)}% of one core ` +
      `(limit ${o.limitPercent}%: ${o.withinLimit ? 'within' : 'EXCEEDED'}).`,
    '',
  );
  return lines.join('\n');
}

/**
 * @param {string[]} args
 * @returns {{ durationSec: number, intervalMs: number, out: string | null }}
 */
function parseArgs(args) {
  const options = {
    durationSec: DEFAULT_DURATION_SEC,
    intervalMs: DEFAULT_INTERVAL_MS,
    /** @type {string | null} */
    out: null,
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === '--duration' || flag === '--interval') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(
          `${flag} needs a positive number, got "${value ?? ''}"`,
        );
      }
      if (flag === '--duration') options.durationSec = n;
      else options.intervalMs = n;
      i++;
    } else if (flag === '--out') {
      if (!value) throw new Error('--out needs a file path');
      options.out = value;
      i++;
    } else {
      throw new Error(`unknown argument "${flag}"`);
    }
  }
  return options;
}

/**
 * Output paths for `--out`: `x.json` writes x.json and x.md, anything else
 * gets both extensions appended.
 * @param {string} out
 * @returns {{ json: string, md: string }}
 */
function outputPaths(out) {
  const stem =
    out.endsWith('.json') || out.endsWith('.md')
      ? out.replace(/\.(json|md)$/, '')
      : out;
  return { json: `${stem}.json`, md: `${stem}.md` };
}

/**
 * @param {string[]} command
 * @param {number} fallback
 * @returns {number}
 */
function getconf(command, fallback) {
  try {
    const value = Number(
      execFileSync('getconf', command, {
        encoding: 'utf8',
        timeout: 2000,
      }).trim(),
    );
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    // getconf missing (minimal images): Linux USER_HZ and page size defaults.
    return fallback;
  }
}

/**
 * @param {string} file
 * @returns {string | null} null when the process exited or is unreadable
 */
function readProcFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    // ENOENT/ESRCH: the process exited mid-sample; EACCES: not ours. Skip it.
    return null;
  }
}

/**
 * Read every live process once.
 * @param {{ pageSize: number, selfPid: number, cmdlineCache: Map<string, string[]> }} ctx
 * @returns {ProcessInfo[]}
 */
function readProcesses(ctx) {
  /** @type {ProcessInfo[]} */
  const processes = [];
  /** @type {Set<string>} */
  const liveKeys = new Set();
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === ctx.selfPid) continue;
    const statText = readProcFile(`/proc/${name}/stat`);
    const stat = statText === null ? null : parseStat(statText);
    if (!stat) continue;
    const key = `${pid}:${stat.starttime}:${stat.comm}`;
    liveKeys.add(key);
    let argv = ctx.cmdlineCache.get(key);
    if (!argv) {
      const cmdText = readProcFile(`/proc/${name}/cmdline`);
      if (cmdText === null) continue;
      argv = parseCmdline(cmdText);
      ctx.cmdlineCache.set(key, argv);
    }
    processes.push({
      pid,
      ppid: stat.ppid,
      comm: stat.comm,
      argv,
      ticks: stat.utime + stat.stime,
      starttime: stat.starttime,
      rssBytes: stat.rssPages * ctx.pageSize,
    });
  }
  for (const key of ctx.cmdlineCache.keys()) {
    if (!liveKeys.has(key)) ctx.cmdlineCache.delete(key);
  }
  return processes;
}

/** @returns {number} */
function readUptimeSec() {
  return Number(fs.readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]);
}

/**
 * Run the sampling loop and resolve with the report.
 * @param {{ durationSec: number, intervalMs: number }} options
 * @param {{ shouldStop: () => boolean }} control
 */
async function run(options, control) {
  const clkTck = getconf(['CLK_TCK'], 100);
  const ctx = {
    pageSize: getconf(['PAGESIZE'], 4096),
    selfPid: process.pid,
    /** @type {Map<string, string[]>} */
    cmdlineCache: new Map(),
  };
  const startedAt = new Date().toISOString();
  const wallStart = process.hrtime.bigint();
  const cpuStart = process.cpuUsage();
  /** @type {Array<{ cpuValid: boolean, groups: Record<string, GroupSample> }>} */
  const samples = [];
  /** @type {Map<string, number>} */
  let previousTicks = new Map();
  /** @type {number | null} */
  let previousUptime = null;
  // Samples at fixed offsets t0 + i * interval (no drift), the last one at or
  // before t0 + duration.
  const plannedSamples =
    Math.floor((options.durationSec * 1000) / options.intervalMs) + 1;
  const t0 = Date.now();

  for (let i = 0; i < plannedSamples && !control.shouldStop(); i++) {
    const wait = t0 + i * options.intervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (control.shouldStop()) break;

    const uptime = readUptimeSec();
    const processes = readProcesses(ctx);
    const trees = buildTrees(processes);
    const elapsedSec = previousUptime === null ? 0 : uptime - previousUptime;
    /** @type {Map<number, number>} */
    const cpuByPid = new Map();
    /** @type {Map<string, number>} */
    const ticksNow = new Map();
    for (const proc of processes) {
      ticksNow.set(`${proc.pid}:${proc.starttime}`, proc.ticks);
      const cpu = processCpuPercent(proc, previousTicks, {
        elapsedSec,
        previousUptimeSec: previousUptime,
        clkTck,
      });
      if (cpu !== null) cpuByPid.set(proc.pid, cpu);
    }
    samples.push({
      cpuValid: previousUptime !== null && elapsedSec > 0,
      groups: summarizeSample(processes, trees, cpuByPid),
    });
    previousTicks = ticksNow;
    previousUptime = uptime;
  }

  const wallSec = Number(process.hrtime.bigint() - wallStart) / 1e9;
  const cpu = process.cpuUsage(cpuStart);
  const cpuSec = (cpu.user + cpu.system) / 1e6;
  // Each sample owns one interval, so the steady-state duty cycle is the
  // sampler's CPU time over (samples x interval).
  const budgetSec = (samples.length * options.intervalMs) / 1000;
  const overheadPercent = budgetSec > 0 ? (cpuSec / budgetSec) * 100 : 0;
  return {
    startedAt,
    durationSec: wallSec,
    intervalMs: options.intervalMs,
    sampleCount: samples.length,
    clkTck,
    pageSize: ctx.pageSize,
    overhead: {
      cpuPercent: overheadPercent,
      limitPercent: OVERHEAD_LIMIT_PERCENT,
      withinLimit: overheadPercent < OVERHEAD_LIMIT_PERCENT,
    },
    groups: aggregate(samples),
  };
}

async function main() {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/stat')) {
    process.stderr.write(
      `process-sampler: Linux /proc required (platform ${process.platform})\n`,
    );
    process.exit(EXIT_UNSUPPORTED);
  }
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `process-sampler: ${error instanceof Error ? error.message : String(error)}\n` +
        'usage: sampler.js [--duration <sec>] [--interval <ms>] [--out <file>]\n',
    );
    process.exit(EXIT_USAGE);
  }
  let stop = false;
  const requestStop = () => {
    stop = true;
  };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);

  const report = await run(options, { shouldStop: () => stop });
  const markdown = renderMarkdown(report);
  if (options.out) {
    const paths = outputPaths(options.out);
    fs.mkdirSync(path.dirname(path.resolve(paths.json)), { recursive: true });
    fs.writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(paths.md, markdown);
    process.stderr.write(
      `process-sampler: wrote ${paths.json} and ${paths.md}\n`,
    );
  }
  process.stdout.write(markdown);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `process-sampler: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
}

module.exports = {
  GROUPS,
  parseStat,
  parseCmdline,
  classify,
  buildTrees,
  processCpuPercent,
  summarizeSample,
  percentile,
  aggregate,
  renderMarkdown,
  parseArgs,
  outputPaths,
};
