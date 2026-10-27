/*
 * Preparing shell (TASK_2026_721 component 6).
 *
 * Shown while the Electron host boots, before Angular loads. Two modes:
 *
 * - `?state=recovery`: static recovery copy plus the error code. Boot progress
 *   is ignored.
 * - otherwise: a progress ring and three staged rows fed by `boot:progress`
 *   messages, which the preload relays to `window` as `message` events. With no
 *   message the ring stays indeterminate on step 1.
 *
 * The shell has no bundler, so the payload rules of `BootProgressPayloadSchema`
 * (libs/shared/src/lib/types/rpc/rpc-readiness.types.ts) are mirrored by hand
 * below. The DOM is only written through `textContent` and attributes.
 */
(function () {
  'use strict';

  const STEP_IDS = ['verify', 'restore', 'agents'];
  const STEP_STATES = ['active', 'done', 'failed'];
  const PAYLOAD_KEYS = [
    'stepId',
    'index',
    'total',
    'state',
    'done',
    'count',
    'elapsedMs',
    'startedAt',
  ];
  const RING_CIRCUMFERENCE = 439.82; // 2 * PI * r, r = 70 in the markup.

  /** Live-region copy, announced once per step state change. */
  const ANNOUNCEMENTS = {
    verify: {
      active: 'Verifying local state before Ptah starts.',
      done: 'Local state verified.',
      failed: 'Could not verify local state.',
    },
    restore: {
      active: 'Restoring workspace history.',
      done: 'Workspace history restored.',
      failed: 'Could not restore workspace history.',
    },
    agents: {
      active: 'Starting agents.',
      done: 'Agents started.',
      failed: 'Could not start agents.',
    },
  };

  const params = new URLSearchParams(window.location.search);
  const shell = document.getElementById('shell');
  const detail = document.getElementById('detail');

  if (params.get('state') === 'recovery') {
    document.title = 'Ptah — Workspace recovery required';
    document.getElementById('progress').hidden = true;
    document.getElementById('steps').hidden = true;
    document.getElementById('title').textContent =
      'Workspace recovery required';
    detail.textContent =
      'Ptah stopped before opening workspace data to avoid using a stale copy.';
    const errorCode = document.getElementById('error-code');
    errorCode.textContent = `Error code: ${params.get('code') ?? 'startup-failed'}`;
    errorCode.hidden = false;
    shell.setAttribute('aria-busy', 'false');
    shell.dataset.mode = 'recovery';
    return;
  }

  const ring = document.getElementById('ring');
  const ringArc = document.getElementById('ring-arc');
  const ringPercent = document.getElementById('ring-percent');
  const ringStep = document.getElementById('ring-step');

  /** Latest validated payload per step id. */
  const latest = {};

  function isCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  /**
   * Hand-validated mirror of `BootProgressPayloadSchema`: strict keys, known
   * step id at its own index, integer counts, `done <= count`.
   * Returns the payload, or `null` when anything is off.
   */
  function parseBootProgress(data) {
    if (typeof data !== 'object' || data === null) return null;
    if (data.type !== 'boot:progress') return null;
    const p = data.payload;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
    for (const key of Object.keys(p)) {
      if (!PAYLOAD_KEYS.includes(key)) return null;
    }
    const index = STEP_IDS.indexOf(p.stepId);
    if (index < 0 || p.index !== index || p.total !== 3) return null;
    if (!STEP_STATES.includes(p.state)) return null;
    if (!isCount(p.startedAt)) return null;
    for (const key of ['done', 'count', 'elapsedMs']) {
      if (p[key] !== undefined && !isCount(p[key])) return null;
    }
    if (p.done !== undefined && p.count !== undefined && p.done > p.count) {
      return null;
    }
    return p;
  }

  function formatElapsed(ms) {
    const seconds = ms / 1000;
    return seconds < 10
      ? `${seconds.toFixed(1)} s`
      : `${Math.round(seconds)} s`;
  }

  function hasCounts(p) {
    return p.done !== undefined && p.count !== undefined;
  }

  function renderStep(p) {
    const row = document.querySelector(`.step[data-step="${p.stepId}"]`);
    row.dataset.state = p.state;

    const meter = row.querySelector('.meter');
    const counted = hasCounts(p) && p.count > 0;
    meter.hidden = !(p.state === 'active' && counted);
    meter.firstElementChild.style.transform = `scaleX(${
      counted ? p.done / p.count : 0
    })`;

    const figure = row.querySelector('.step-figure');
    if (p.state === 'done' && p.elapsedMs !== undefined) {
      figure.textContent = formatElapsed(p.elapsedMs);
    } else if (hasCounts(p)) {
      figure.textContent = `${p.done} / ${p.count}`;
    } else {
      figure.textContent = '';
    }
  }

  function renderRing() {
    const payloads = STEP_IDS.map((id) => latest[id]).filter(Boolean);
    const doneSteps = payloads.filter((p) => p.state === 'done').length;
    const failed = payloads.some((p) => p.state === 'failed');
    let fraction = 0;
    for (const p of payloads) {
      if (p.state === 'active' && hasCounts(p) && p.count > 0) {
        fraction = Math.max(fraction, p.done / p.count);
      }
    }
    const allDone = doneSteps === STEP_IDS.length;
    // 100 % is reserved for "every step done".
    const percent = allDone
      ? 100
      : Math.min(
          99,
          Math.floor(((doneSteps + fraction) / STEP_IDS.length) * 100),
        );

    // Nothing measurable yet (an uncounted first step): keep spinning.
    const indeterminate = !failed && percent === 0;
    if (failed) ring.dataset.mode = 'failed';
    else if (allDone) ring.dataset.mode = 'done';
    else ring.dataset.mode = indeterminate ? 'indeterminate' : 'determinate';

    if (!indeterminate) {
      ringArc.setAttribute(
        'stroke-dasharray',
        `${((percent / 100) * RING_CIRCUMFERENCE).toFixed(2)} ${RING_CIRCUMFERENCE}`,
      );
    }
    // A failed ring names the failure instead of a misleading percentage.
    ringPercent.textContent = failed ? 'Failed' : `${percent}%`;
    ringPercent.hidden = indeterminate;
    ringStep.textContent = `step ${Math.min(doneSteps + 1, STEP_IDS.length)} of ${STEP_IDS.length}`;
    let ringLabel = `${percent}%`;
    if (failed) ringLabel = 'Startup failed';
    else if (indeterminate) ringLabel = 'Preparing';
    ring.setAttribute('aria-label', ringLabel);
    shell.setAttribute('aria-busy', failed || allDone ? 'false' : 'true');
    return { allDone, failed };
  }

  function announce(p, summary) {
    // A failure stays the last word; later steps do not talk over it.
    if (summary.failed && p.state !== 'failed') return;
    if (summary.allDone) {
      detail.textContent = 'Workspace ready.';
      return;
    }
    let text = ANNOUNCEMENTS[p.stepId][p.state];
    if (p.state === 'done' && hasCounts(p)) {
      text = `${text} ${p.done} of ${p.count}.`;
    }
    detail.textContent = text;
  }

  window.addEventListener('message', (event) => {
    // The preload dispatches a synthetic MessageEvent, whose origin is empty.
    // A real postMessage always carries an origin, so it is not ours.
    if (event.origin !== '') return;
    const p = parseBootProgress(event.data);
    if (p === null) return;
    const previous = latest[p.stepId];
    // Terminal states stick, matching the publisher.
    if (previous && previous.state !== 'active') return;
    latest[p.stepId] = p;
    renderStep(p);
    const summary = renderRing();
    if (!previous || previous.state !== p.state) {
      announce(p, summary);
    }
  });
})();
