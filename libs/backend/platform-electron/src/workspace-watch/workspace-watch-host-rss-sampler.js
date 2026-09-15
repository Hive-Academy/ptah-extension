'use strict';

/**
 * RSS-by-PID sampler (TASK_2026_437 Batch 15 review fix, style serious #3).
 *
 * ONE implementation, used two ways:
 * - `require`d for a single, synchronous, OUTSIDE-the-measured-window sample
 *   (`readHostRssKb` in the harness).
 * - run directly (`node workspace-watch-host-rss-sampler.js <pid> <intervalMs>`)
 *   as the body of the PERSISTENT monitor child `RssPeakMonitor` spawns, so
 *   the repeated `execFileSync` calls a peak-RSS poll needs happen on THAT
 *   child's own event loop, never on the process being measured.
 *
 * Plain CommonJS `.js`, not `.ts`: it has to run under a bare `node`, with no
 * ts-node/tsx in the child. This is real, linted, type-checked-by-JSDoc-only
 * source, not an inline string — the review's specific complaint about the
 * first version (a `node -e` string reimplementing this same branching,
 * silently swallowing every error) is what this file replaces.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

/**
 * @param {number} pid
 * @returns {number | undefined} RSS in KB, or `undefined` if the OS query
 *   failed (missing tool, locale-shifted output, process already gone).
 */
function sampleRssKb(pid) {
  if (process.platform === 'linux') {
    const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
    const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
    return match ? Number(match[1]) : undefined;
  }
  if (process.platform === 'win32') {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', '(Get-Process -Id ' + pid + ').WorkingSet64'],
      { encoding: 'utf8', windowsHide: true },
    );
    const bytes = Number(out.trim());
    return Number.isFinite(bytes) ? Math.round(bytes / 1024) : undefined;
  }
  const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  const kb = Number(out.trim());
  return Number.isFinite(kb) ? kb : undefined;
}

module.exports = { sampleRssKb: sampleRssKb };

// Run as the persistent monitor child when invoked directly. Every sample
// outcome is REPORTED over IPC, success or failure — an error must be seen,
// not swallowed (review logic-question-3 / serious-adjacent finding on the
// old inline script's bare `catch (e) {}`).
if (require.main === module) {
  const pid = Number(process.argv[2]);
  const intervalMs = Number(process.argv[3]);

  const sample = function sample() {
    try {
      const kb = sampleRssKb(pid);
      if (typeof kb === 'number' && Number.isFinite(kb)) {
        if (process.send) process.send({ type: 'sample', kb: kb });
      } else if (process.send) {
        process.send({
          type: 'error',
          message: 'sampleRssKb returned no finite value for pid ' + pid,
        });
      }
    } catch (error) {
      if (process.send) {
        process.send({
          type: 'error',
          message:
            error && error.message ? String(error.message) : String(error),
        });
      }
    }
  };

  sample();
  const timer = setInterval(sample, intervalMs);
  process.on('message', function (message) {
    if (message === 'stop') {
      clearInterval(timer);
      process.exit(0);
    }
  });
}
