#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseCliFlags, verifyDemoArtifacts } from './live-demo-cli.mjs';
import { start as startStaticServer } from './live-demo-static-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '../..');
const DEFAULT_ROOT = 'dist/ptah-landing-page/browser';
const DEFAULT_OUT = 'apps/ptah-landing-page/public/assets/live-demo';
const DEFAULT_SCENARIOS = Object.freeze([
  'orchestration',
  'tribunal-council',
  'command-center',
  'multi-agent',
]);
const DEFAULT_SPEED = 2;
const DEFAULT_TIMEOUT_MS = 90_000;
const POSTER_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const VIDEO_SIZE_CANDIDATES = Object.freeze([
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 640 },
]);
const JPG_QUALITY_CANDIDATES = Object.freeze([80, 72, 65, 55, 45]);
const MAX_WEBM_BYTES = 3 * 1024 * 1024;
const MAX_JPG_BYTES = 250 * 1024;

export function parseArgs(argv = process.argv.slice(2)) {
  return parseCliFlags(argv, {
    defaults: {
      root: DEFAULT_ROOT,
      out: DEFAULT_OUT,
      scenarios: [],
      speed: DEFAULT_SPEED,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      json: null,
    },
    flags: {
      '--root': (o, nextVal) => {
        o.root = nextVal();
      },
      '--out': (o, nextVal) => {
        o.out = nextVal();
      },
      '--scenario': (o, nextVal) => {
        o.scenarios.push(nextVal());
      },
      '--speed': (o, nextVal) => {
        o.speed = Number(nextVal());
      },
      '--timeout': (o, nextVal) => {
        o.timeoutMs = Number(nextVal());
      },
      '--json': (o, nextVal) => {
        o.json = nextVal();
      },
    },
  });
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes.toLocaleString('en-US')} B)`;
  }
  return `${(bytes / 1024).toFixed(1)} KB (${bytes.toLocaleString('en-US')} B)`;
}

async function waitForReady(page, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const snap = await page.evaluate(() => ({
      state: window.__ptahReplay?.state ?? null,
      misses: window.__ptahReplay?.misses ?? [],
    }));
    if (snap.state?.error) {
      throw new Error(`Replay state error before ready: ${snap.state.error}`);
    }
    if (
      Array.isArray(snap.misses) &&
      snap.misses.some(
        (m) => m?.kind === 'scenario-load' || m?.kind === 'ready-timeout',
      )
    ) {
      throw new Error(
        `Replay miss before ready: ${JSON.stringify(snap.misses)}`,
      );
    }
    if (snap.state?.ready === true) {
      return snap.state;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for __ptahReplay.state.ready (${timeoutMs}ms)`);
}

async function triggerInteractiveSendIfNeeded(page, scenarioId, state, timeoutMs) {
  const needsSend =
    scenarioId === 'orchestration' || state?.waitingForSend === true;
  if (!needsSend) {
    return false;
  }

  const deadline = performance.now() + Math.min(timeoutMs, 20_000);
  const sendSelector =
    'ptah-chat-input button[data-testid="chat-send-btn"]:not([disabled]), ptah-chat-input button[aria-label*="Send"]:not([disabled])';

  while (performance.now() < deadline) {
    const readyToClick = await page.evaluate((sel) => {
      const textarea = document.querySelector(
        'ptah-chat-input textarea:not([readonly])',
      );
      const sendBtn = document.querySelector(sel);
      return Boolean(
        textarea &&
          typeof textarea.value === 'string' &&
          textarea.value.trim().length > 0 &&
          sendBtn &&
          !sendBtn.disabled,
      );
    }, sendSelector);

    if (readyToClick) {
      // Brief pause so the pre-filled composer prompt is visible at the start of the video
      await page.waitForTimeout(300);
      await page.locator(sendSelector).first().click();
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const sendDeadline = performance.now() + 10_000;
  while (performance.now() < sendDeadline) {
    const postSend = await page.evaluate(
      () => window.__ptahReplay?.state ?? null,
    );
    if (postSend && postSend.waitingForSend === false) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Scenario "${scenarioId}" remained in waitingForSend after clicking Send`,
  );
}

async function selectCommandCenterSessionIfNeeded(page, scenarioId) {
  if (scenarioId !== 'command-center') {
    return false;
  }
  const pickerSelector = '[data-testid="recent-grid"] button';
  const deadline = performance.now() + 6_000;
  let clicked = false;
  while (performance.now() < deadline) {
    const hasScene = await page.evaluate(() =>
      Boolean(document.querySelector('ptah-command-scene')),
    );
    if (hasScene) {
      break;
    }
    if (!clicked) {
      const count = await page.locator(pickerSelector).count();
      if (count > 0) {
        await page.locator(pickerSelector).first().click();
        clicked = true;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.__ptahReplay?.play();
  });
  return clicked;
}

async function shouldCapturePosterNow(page, scenarioId, state) {
  const duration = Number(state?.duration ?? 0);
  const elapsed = Number(state?.elapsed ?? 0);
  if (duration <= 0) {
    return false;
  }
  const progress = elapsed / duration;
  if (scenarioId === 'orchestration') {
    // In orchestration, stats arrive at 38s and summary text completes around 40.9s (of 47s).
    // Capture at ~88% (or at >=58% if stats are already populated without '—').
    if (progress >= 0.88) {
      return true;
    }
    if (progress >= 0.58) {
      const hasLiveTokens = await page.evaluate(() => {
        const text = document.body?.innerText ?? '';
        return text.includes('9.6k') || text.includes('$0.08');
      });
      return hasLiveTokens;
    }
    return false;
  }
  return progress >= 0.58;
}

async function capturePosterJpeg(page, jpgPath) {
  let chosenQuality = JPG_QUALITY_CANDIDATES[0];
  let chosenBuffer = null;

  for (const quality of JPG_QUALITY_CANDIDATES) {
    const buf = await page.screenshot({
      type: 'jpeg',
      quality,
      fullPage: false,
    });
    chosenQuality = quality;
    chosenBuffer = buf;
    if (buf.length <= MAX_JPG_BYTES) {
      break;
    }
  }

  await mkdir(dirname(jpgPath), { recursive: true });
  await writeFile(jpgPath, chosenBuffer);
  return {
    bytes: chosenBuffer.length,
    quality: chosenQuality,
  };
}

async function runSingleCaptureAttempt({
  browser,
  rootDir,
  outDir,
  scenarioId,
  speed,
  timeoutMs,
  videoSize,
}) {
  const serverHandle = await startStaticServer({ root: rootDir, port: 0 });
  const serverOrigin = new URL(serverHandle.url).origin;
  const tempVideoDir = await mkdtemp(
    join(tmpdir(), `ptah-live-demo-video-${scenarioId}-`),
  );

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const externalRequests = [];
  const httpErrors = [];

  let context = null;
  let page = null;
  let video = null;
  let timedOut = false;
  let navError = null;
  let pageData = null;
  let posterInfo = null;
  let posterElapsedMs = null;
  const jpgPath = join(outDir, `${scenarioId}.jpg`);
  const webmPath = join(outDir, `${scenarioId}.webm`);
  const t0 = performance.now();

  try {
    context = await browser.newContext({
      viewport: POSTER_VIEWPORT,
      colorScheme: 'dark',
      recordVideo: {
        dir: tempVideoDir,
        size: videoSize,
      },
    });
    page = await context.newPage();
    video = page.video();

    await page.addInitScript(() => {
      window.__ptahCspViolations = [];
      window.addEventListener('securitypolicyviolation', (event) => {
        window.__ptahCspViolations.push({
          blockedURI: event.blockedURI,
          violatedDirective: event.violatedDirective,
          effectiveDirective: event.effectiveDirective,
          sourceFile: event.sourceFile,
          lineNumber: event.lineNumber,
        });
      });
    });

    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      try {
        const parsed = new URL(reqUrl);
        if (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          parsed.origin !== serverOrigin
        ) {
          externalRequests.push(reqUrl);
          await route.abort('internetdisconnected');
          return;
        }
      } catch {
        externalRequests.push(reqUrl);
        await route.abort('internetdisconnected');
        return;
      }
      await route.continue();
    });

    page.on('request', (req) => {
      const reqUrl = req.url();
      try {
        const parsed = new URL(reqUrl);
        if (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          parsed.origin !== serverOrigin &&
          !externalRequests.includes(reqUrl)
        ) {
          externalRequests.push(reqUrl);
        }
      } catch {
        // Ignore non-standard schemes
      }
    });

    page.on('response', (res) => {
      if (res.status() >= 400) {
        httpErrors.push(`${res.status()} ${res.url()}`);
      }
    });

    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error') {
        consoleErrors.push(msg.text());
      } else if (type === 'warning') {
        consoleWarnings.push(msg.text());
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err?.stack || err?.message || String(err));
    });

    const query = new URLSearchParams({ scenario: scenarioId });
    if (scenarioId === 'command-center') {
      query.set('autoplay', '0');
    }
    if (Number.isFinite(speed) && speed > 0) {
      query.set('speed', String(speed));
    }
    const targetUrl = `${serverHandle.url}/demo/?${query.toString()}`;

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    const readyState = await waitForReady(page, Math.min(timeoutMs, 25_000));
    await triggerInteractiveSendIfNeeded(
      page,
      scenarioId,
      readyState,
      timeoutMs,
    );
    await selectCommandCenterSessionIfNeeded(page, scenarioId);

    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const snapshot = await page.evaluate(() => ({
        state: window.__ptahReplay?.state ?? null,
        misses: window.__ptahReplay?.misses ?? [],
      }));

      if (
        !posterInfo &&
        snapshot.state &&
        (await shouldCapturePosterNow(page, scenarioId, snapshot.state))
      ) {
        posterInfo = await capturePosterJpeg(page, jpgPath);
        posterElapsedMs = Math.round(Number(snapshot.state.elapsed ?? 0));
      }

      if (snapshot.state?.complete === true) {
        timedOut = false;
        break;
      }

      if (
        Array.isArray(snapshot.misses) &&
        snapshot.misses.some((m) => m?.kind === 'scenario-load')
      ) {
        timedOut = false;
        break;
      }

      await new Promise((r) => setTimeout(r, 100));
    }

    const postLoopState = await page.evaluate(
      () => window.__ptahReplay?.state ?? null,
    );
    if (!postLoopState?.complete) {
      timedOut = true;
    }

    if (!posterInfo) {
      posterInfo = await capturePosterJpeg(page, jpgPath);
      posterElapsedMs = Math.round(Number(postLoopState?.elapsed ?? 0));
    }

    // Hold final completed state briefly so the end frame is clearly visible in the video
    await page.waitForTimeout(250);

    const completeWallMs = Math.round(performance.now() - t0);
    pageData = await page.evaluate((wallComplete) => {
      const paintEntries = performance.getEntriesByType('paint');
      const fcp =
        paintEntries.find((p) => p.name === 'first-contentful-paint')
          ?.startTime ??
        paintEntries.find((p) => p.name === 'first-paint')?.startTime ??
        null;
      const state = window.__ptahReplay?.state ?? null;
      return {
        state,
        misses: window.__ptahReplay?.misses ?? [],
        cspViolations: window.__ptahCspViolations ?? [],
        timings: {
          readyAt:
            state?.readyAt != null ? Math.round(Number(state.readyAt)) : null,
          firstPaint: fcp != null ? Math.round(Number(fcp)) : null,
          completeWallMs: state?.complete ? wallComplete : null,
          scenarioDurationMs:
            state?.duration != null ? Math.round(Number(state.duration)) : null,
        },
      };
    }, completeWallMs);
  } catch (err) {
    navError = err instanceof Error ? err.message : String(err);
  } finally {
    await context?.close();
    await serverHandle.close();
  }

  let webmBytes = 0;
  try {
    if (video) {
      const recordedPath = await video.path();
      if (recordedPath && existsSync(recordedPath)) {
        await mkdir(dirname(webmPath), { recursive: true });
        await copyFile(recordedPath, webmPath);
        webmBytes = statSync(webmPath).size;
      }
    }
  } finally {
    await rm(tempVideoDir, { recursive: true, force: true });
  }

  const jpgBytes =
    posterInfo?.bytes ?? (existsSync(jpgPath) ? statSync(jpgPath).size : 0);
  const misses = pageData?.misses ?? [];
  const cspViolations = pageData?.cspViolations ?? [];
  const timings = pageData?.timings ?? {
    readyAt: null,
    firstPaint: null,
    completeWallMs: null,
    scenarioDurationMs: null,
  };
  const complete = Boolean(pageData?.state?.complete) && !timedOut && !navError;

  const failureReasons = [];
  if (navError) failureReasons.push(`navError: ${navError}`);
  if (timedOut) failureReasons.push(`timeout after ${timeoutMs}ms`);
  if (!complete && !timedOut && !navError)
    failureReasons.push('state.complete is false');
  if (misses.length > 0) failureReasons.push(`misses: ${misses.length}`);
  if (consoleErrors.length > 0)
    failureReasons.push(`consoleErrors: ${consoleErrors.length}`);
  if (consoleWarnings.length > 0)
    failureReasons.push(`consoleWarnings: ${consoleWarnings.length}`);
  if (pageErrors.length > 0)
    failureReasons.push(`pageErrors: ${pageErrors.length}`);
  if (externalRequests.length > 0)
    failureReasons.push(`externalRequests: ${externalRequests.length}`);
  if (cspViolations.length > 0)
    failureReasons.push(`cspViolations: ${cspViolations.length}`);
  if (httpErrors.length > 0)
    failureReasons.push(`httpErrors: ${httpErrors.length}`);
  if (webmBytes === 0) failureReasons.push('webm was not produced');
  if (webmBytes > MAX_WEBM_BYTES)
    failureReasons.push(
      `webm exceeds ${formatBytes(MAX_WEBM_BYTES)}: ${formatBytes(webmBytes)}`,
    );
  if (jpgBytes === 0) failureReasons.push('jpg was not produced');
  if (jpgBytes > MAX_JPG_BYTES)
    failureReasons.push(
      `jpg exceeds ${formatBytes(MAX_JPG_BYTES)}: ${formatBytes(jpgBytes)}`,
    );

  return {
    scenario: scenarioId,
    passed: failureReasons.length === 0,
    videoSize,
    webmPath,
    webmBytes,
    jpgPath,
    jpgBytes,
    jpgQuality: posterInfo?.quality ?? null,
    posterElapsedMs,
    timings,
    state: pageData?.state ?? null,
    misses,
    consoleErrors,
    consoleWarnings,
    pageErrors,
    externalRequests,
    cspViolations,
    httpErrors,
    failureReasons,
  };
}

async function captureScenarioWithSizeFallback(options) {
  let lastResult = null;
  for (let i = 0; i < VIDEO_SIZE_CANDIDATES.length; i++) {
    const videoSize = VIDEO_SIZE_CANDIDATES[i];
    const result = await runSingleCaptureAttempt({
      ...options,
      videoSize,
    });
    lastResult = result;

    const onlyWebmTooLarge =
      result.webmBytes > MAX_WEBM_BYTES &&
      result.failureReasons.every((r) => r.startsWith('webm exceeds'));
    if (onlyWebmTooLarge && i + 1 < VIDEO_SIZE_CANDIDATES.length) {
      const nextSize = VIDEO_SIZE_CANDIDATES[i + 1];
      console.log(
        `[capture-live-demo-media] ${options.scenarioId}.webm at ${videoSize.width}x${videoSize.height} was ${formatBytes(result.webmBytes)} (> 3 MB); retrying at ${nextSize.width}x${nextSize.height}...`,
      );
      continue;
    }
    return result;
  }
  return lastResult;
}

function printSummaryTable(results) {
  const headers = [
    'Scenario',
    'Status',
    'VideoRes',
    'WebM Size',
    'JPG Size',
    'Wall(ms)',
    'Replay(ms)',
    'PosterAt(ms)',
    'Misses',
    'Errors',
  ];
  const rows = results.map((r) => [
    r.scenario,
    r.passed ? 'PASS' : 'FAIL',
    `${r.videoSize.width}x${r.videoSize.height}`,
    `${(r.webmBytes / (1024 * 1024)).toFixed(2)} MB`,
    `${(r.jpgBytes / 1024).toFixed(1)} KB`,
    String(r.timings.completeWallMs ?? '-'),
    String(r.timings.scenarioDurationMs ?? '-'),
    String(r.posterElapsedMs ?? '-'),
    String(r.misses.length),
    String(
      r.consoleErrors.length +
        r.consoleWarnings.length +
        r.pageErrors.length +
        r.httpErrors.length +
        r.cspViolations.length +
        r.externalRequests.length,
    ),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  );
  const formatRow = (cols) =>
    cols.map((c, i) => c.padEnd(widths[i])).join(' | ');

  console.log(formatRow(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('-+-'));
  for (const row of rows) {
    console.log(formatRow(row));
  }

  for (const r of results) {
    if (!r.passed) {
      console.error(
        `[capture-live-demo-media] FAIL (${r.scenario}): ${r.failureReasons.join(', ')}`,
      );
      if (r.misses.length > 0) {
        console.error('  misses:', JSON.stringify(r.misses));
      }
      if (r.consoleErrors.length > 0) {
        console.error('  consoleErrors:', JSON.stringify(r.consoleErrors));
      }
      if (r.consoleWarnings.length > 0) {
        console.error('  consoleWarnings:', JSON.stringify(r.consoleWarnings));
      }
      if (r.pageErrors.length > 0) {
        console.error('  pageErrors:', JSON.stringify(r.pageErrors));
      }
      if (r.cspViolations.length > 0) {
        console.error('  cspViolations:', JSON.stringify(r.cspViolations));
      }
      if (r.externalRequests.length > 0) {
        console.error(
          '  externalRequests:',
          JSON.stringify(r.externalRequests),
        );
      }
      if (r.httpErrors.length > 0) {
        console.error('  httpErrors:', JSON.stringify(r.httpErrors));
      }
    }
  }
}

export async function captureLiveDemoMedia(rawOptions = {}) {
  const rootDir = resolve(WORKSPACE_ROOT, rawOptions.root ?? DEFAULT_ROOT);
  const outDir = resolve(WORKSPACE_ROOT, rawOptions.out ?? DEFAULT_OUT);
  const scenarios =
    Array.isArray(rawOptions.scenarios) && rawOptions.scenarios.length > 0
      ? rawOptions.scenarios
      : [...DEFAULT_SCENARIOS];
  const speed = Number(rawOptions.speed ?? DEFAULT_SPEED);
  const timeoutMs = Number(rawOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const artifactInfo = await verifyDemoArtifacts(rootDir);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const scenarioId of scenarios) {
      console.log(
        `[capture-live-demo-media] Capturing scenario "${scenarioId}" (speed=${speed}x)...`,
      );
      const res = await captureScenarioWithSizeFallback({
        browser,
        rootDir,
        outDir,
        scenarioId,
        speed,
        timeoutMs,
      });
      results.push(res);
    }
  } finally {
    await browser.close();
  }

  const passed = results.every((r) => r.passed);
  const summary = {
    passed,
    rootDir,
    outDir,
    speed,
    capturedAt: new Date().toISOString(),
    artifactInfo,
    results,
  };

  if (rawOptions.json) {
    const jsonPath = resolve(WORKSPACE_ROOT, rawOptions.json);
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  }

  printSummaryTable(results);
  return summary;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const summary = await captureLiveDemoMedia(opts);
    if (!summary.passed) {
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `[capture-live-demo-media] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
