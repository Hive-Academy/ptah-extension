#!/usr/bin/env node
/**
 * M3 measurement script — `git status` invocations from cache churn.
 * (B0, TASK_2026_173). See the companion perf-m3-watcher-churn.md procedure.
 *
 * ZERO PRODUCT-CODE CHANGE. This script does not modify
 * apps/ptah-electron/src/services/git-watcher.service.ts or any other
 * shipped file. It faithfully REPLICATES that file's watch/exclude/debounce
 * behavior standalone (see inline citations below) so the measurement can
 * run without a full Electron main-process bootstrap (DI container, license
 * check, SQLite, BrowserWindow) — those are irrelevant to what M3 measures
 * and would only add noise and risk to a 60s timing window.
 *
 * Replicated behavior, with the exact source it mirrors:
 *   - Exclusion predicate: `.git/`, `node_modules/`, `dist/` only — NOT
 *     `.nx/` or `.angular/`. (git-watcher.service.ts:376-393,
 *     `watchWorkspaceRoot`)
 *   - Debounce: WORKSPACE_DEBOUNCE_MS = 2000ms, timer reset on every
 *     qualifying event. (git-watcher.service.ts:102, :394-397)
 *   - The fetch itself: `git status --porcelain=v2 --branch`.
 *     (git-info.service.ts:54-55, `GitInfoService.getGitInfo`)
 *
 * Workload: rather than shelling out a full multi-minute `nx build` (slow,
 * non-deterministic wall-clock, and this repo's dev build is already the
 * subject under test — running it recursively here would be circular), this
 * script writes small probe files into `.nx/cache/` and `.angular/cache/` on
 * a fixed cadence, chosen to be JUST ABOVE the 2000ms debounce window
 * (2200ms) so writes do not all coalesce into one or two status calls — this
 * reproduces the "many separate cache-write bursts over a 60s dev-build
 * window" shape a real build produces, in a controlled, reproducible way.
 * This is a documented methodology choice, not a hidden shortcut — the
 * procedure doc describes how to instead point this at a real
 * `nx serve ptah-electron` + concurrent build session for the gold-standard
 * variant.
 *
 * Usage: node perf-m3-watcher-churn.script.mjs [repoRoot] [windowMs] [probeRelPath]
 */

import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const REPO_ROOT = path.resolve(process.argv[2] ?? process.cwd());
const WINDOW_MS = Number(process.argv[3] ?? 60_000);
const PROBE_REL_PATH = process.argv[4] ?? 'apps/ptah-electron-e2e/README.md';
const WORKSPACE_DEBOUNCE_MS = 2_000; // git-watcher.service.ts:102
const CACHE_WRITE_INTERVAL_MS = 2_200; // just above the debounce window
const MID_WINDOW_PROBE_FILE = path.join(REPO_ROOT, PROBE_REL_PATH);

let statusInvocations = 0;
let statusTraceLines = 0;
let debounceTimer = null;
let cacheWriteTimer = null;
const invocationLog = [];
let midWindowProbeFiredAt = null;
let midWindowProbeConfirmed = false;

function runGitStatus(trigger) {
  const startedAt = Date.now();
  const child = spawn('git', ['status', '--porcelain=v2', '--branch'], {
    cwd: REPO_ROOT,
    env: { ...process.env, GIT_TRACE: '1' },
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.on('close', () => {
    statusInvocations += 1;
    const traceLines = stderr
      .split('\n')
      .filter((l) => l.toLowerCase().includes('trace:') && l.includes('git'));
    statusTraceLines += traceLines.length;
    invocationLog.push({
      t: startedAt,
      trigger,
      traceLineCount: traceLines.length,
    });
    if (
      midWindowProbeFiredAt !== null &&
      !midWindowProbeConfirmed &&
      startedAt >= midWindowProbeFiredAt
    ) {
      midWindowProbeConfirmed = true;
    }
  });
}

function scheduleUpdate(trigger) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runGitStatus(trigger);
  }, WORKSPACE_DEBOUNCE_MS);
}

/** Mirrors git-watcher.service.ts:376-393 exactly. */
function isExcluded(filename) {
  if (typeof filename !== 'string') return false;
  if (
    filename.startsWith('.git/') ||
    filename.startsWith('.git\\') ||
    filename === '.git'
  ) {
    return true;
  }
  if (
    filename.startsWith('node_modules/') ||
    filename.startsWith('node_modules\\') ||
    filename.startsWith('dist/') ||
    filename.startsWith('dist\\')
  ) {
    return true;
  }
  return false;
}

console.log(
  `[perf-m3] watching ${REPO_ROOT} recursively for ${WINDOW_MS}ms (GIT_TRACE=1, debounce=${WORKSPACE_DEBOUNCE_MS}ms)`,
);

let eventCount = 0;
const watcher = watch(REPO_ROOT, { recursive: true }, (eventType, filename) => {
  if (isExcluded(filename)) return;
  eventCount += 1;
  scheduleUpdate(`${eventType}:${filename ?? '?'}`);
});
watcher.on('error', (err) => {
  console.error('[perf-m3] watcher error:', err);
});

// --- synthetic cache churn: .nx/cache and .angular/cache -------------------
const nxCacheDir = path.join(REPO_ROOT, '.nx', 'cache');
const angularCacheDir = path.join(REPO_ROOT, '.angular', 'cache', 'm3-probe');
fs.mkdirSync(nxCacheDir, { recursive: true });
fs.mkdirSync(angularCacheDir, { recursive: true });

let cacheWriteCount = 0;
function writeCacheProbe() {
  const nxFile = path.join(nxCacheDir, `m3-probe-${cacheWriteCount}.tmp`);
  const ngFile = path.join(angularCacheDir, `m3-probe-${cacheWriteCount}.tmp`);
  fs.writeFileSync(nxFile, String(Date.now()));
  fs.writeFileSync(ngFile, String(Date.now()));
  cacheWriteCount += 1;
  cacheWriteTimer = setTimeout(writeCacheProbe, CACHE_WRITE_INTERVAL_MS);
}
writeCacheProbe();

// --- mid-window genuine tracked-file change (B4 AC3 proof) ------------------
const originalProbeContent = fs.readFileSync(MID_WINDOW_PROBE_FILE, 'utf8');
setTimeout(
  () => {
    fs.writeFileSync(
      MID_WINDOW_PROBE_FILE,
      originalProbeContent + '\n<!-- m3-probe -->\n',
    );
    midWindowProbeFiredAt = Date.now();
    console.log(
      '[perf-m3] mid-window: appended to a tracked file (genuine-change proof)',
    );
  },
  Math.floor(WINDOW_MS / 2),
);

// --- wind down ---------------------------------------------------------------
setTimeout(() => {
  watcher.close();
  clearTimeout(cacheWriteTimer);
  if (debounceTimer) clearTimeout(debounceTimer);

  // Give the final debounced status call time to complete, then clean up and report.
  setTimeout(() => {
    fs.writeFileSync(MID_WINDOW_PROBE_FILE, originalProbeContent);
    try {
      fs.rmSync(path.join(REPO_ROOT, '.angular', 'cache', 'm3-probe'), {
        recursive: true,
        force: true,
      });
    } catch {
      /* best-effort cleanup */
    }
    for (let i = 0; i < cacheWriteCount; i++) {
      try {
        fs.rmSync(path.join(nxCacheDir, `m3-probe-${i}.tmp`), { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }

    const report = {
      repoRoot: REPO_ROOT,
      windowMs: WINDOW_MS,
      workspaceDebounceMs: WORKSPACE_DEBOUNCE_MS,
      cacheWriteIntervalMs: CACHE_WRITE_INTERVAL_MS,
      cacheWriteCount,
      qualifyingFsEvents: eventCount,
      statusInvocations,
      statusTraceLines,
      midWindowProbeFired: midWindowProbeFiredAt !== null,
      midWindowProbeConfirmedByStatusCall: midWindowProbeConfirmed,
      invocationLog,
    };
    console.log('---PERF-M3-REPORT-JSON-START---');
    console.log(JSON.stringify(report, null, 2));
    console.log('---PERF-M3-REPORT-JSON-END---');
    process.exit(0);
  }, WORKSPACE_DEBOUNCE_MS + 1_000);
}, WINDOW_MS);
