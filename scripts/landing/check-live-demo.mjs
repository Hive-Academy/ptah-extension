#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { parseCliFlags, verifyDemoArtifacts } from './live-demo-cli.mjs';
import { start as startStaticServer } from './live-demo-static-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '../..');
const DEFAULT_ROOT = 'dist/ptah-landing-page/browser';
const DEFAULT_TIMEOUT_MS = 120_000;
/**
 * Size budget for one replay: the gzipped bytes of every same-origin file the
 * demo page fetched. Gzip of the files on disk stands in for the compressed
 * transfer of the static host, so the number is stable between runs.
 */
// Measured at about 1.7 MB per scenario with the old PNG logo and backdrop;
// re-measure and lower this after the webp swap.
const DEFAULT_MAX_TRANSFER_KB = 1900;

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = parseCliFlags(argv, {
    defaults: {
      root: DEFAULT_ROOT,
      scenarios: [],
      json: null,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxTransferKb: DEFAULT_MAX_TRANSFER_KB,
    },
    flags: {
      '--root': (o, nextVal) => {
        o.root = nextVal();
      },
      '--scenario': (o, nextVal) => {
        o.scenarios.push(nextVal());
      },
      '--json': (o, nextVal) => {
        o.json = nextVal();
      },
      '--timeout': (o, nextVal) => {
        o.timeoutMs = Number(nextVal());
      },
      '--max-transfer-kb': (o, nextVal) => {
        o.maxTransferKb = Number(nextVal());
      },
    },
  });
  return opts;
}

async function resolveScenarios(rootDir, requestedScenarios) {
  if (requestedScenarios.length > 0) {
    return requestedScenarios;
  }
  const indexPath = join(rootDir, 'demo', 'scenarios', 'index.json');
  if (!existsSync(indexPath)) {
    throw new Error(`Missing scenarios index at ${indexPath}`);
  }
  const parsed = JSON.parse(await readFile(indexPath, 'utf8'));
  const ids = Array.isArray(parsed) ? parsed : parsed?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(`No scenarios listed in ${indexPath}`);
  }
  return ids;
}

const SEND_BUTTON_SELECTOR =
  'ptah-chat-input button[data-testid="chat-send-btn"]:not([disabled]), ptah-chat-input button[aria-label*="Send"]:not([disabled])';

async function waitForScenarioCompletion(page, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const snapshot = await page.evaluate(() => ({
      state: window.__ptahReplay?.state ?? null,
      misses: window.__ptahReplay?.misses ?? [],
    }));
    if (snapshot.state?.complete === true) {
      return { timedOut: false, snapshot };
    }
    // On-send scenarios wait for the visitor to click Send in the composer.
    if (snapshot.state?.waitingForSend === true) {
      const sendButton = page.locator(SEND_BUTTON_SELECTOR).first();
      if (await sendButton.isVisible().catch(() => false)) {
        await sendButton.click().catch(() => undefined);
      }
    }
    if (
      Array.isArray(snapshot.misses) &&
      snapshot.misses.some((m) => m?.kind === 'scenario-load')
    ) {
      return { timedOut: false, snapshot };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const finalSnapshot = await page.evaluate(() => ({
    state: window.__ptahReplay?.state ?? null,
    misses: window.__ptahReplay?.misses ?? [],
  }));
  return { timedOut: true, snapshot: finalSnapshot };
}

/** Gzipped size in KB of the files under `rootDir` that the page fetched. */
export function gzippedTransferKb(rootDir, pathnames) {
  // Dedupe on the resolved file: `/demo` and `/demo/`, or `/` and `/index.html`, are one file.
  const files = new Set();
  for (const pathname of pathnames) {
    let rel;
    try {
      rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch {
      continue;
    }
    let file = resolve(rootDir, rel);
    if (relative(rootDir, file).startsWith('..')) continue;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (existsSync(file) && statSync(file).isFile()) files.add(file);
  }
  let bytes = 0;
  for (const file of files) bytes += gzipSync(readFileSync(file)).length;
  return Math.round(bytes / 1024);
}

async function runScenarioCheck(browser, serverUrl, scenarioId, timeoutMs, rootDir, maxTransferKb) {
  const serverOrigin = new URL(serverUrl).origin;
  const fetchedPaths = new Set();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const externalRequests = [];
  const httpErrors = [];

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
      return;
    }
    try {
      const parsed = new URL(res.url());
      // Redirects carry no body; their target is collected as its own response.
      if (res.status() < 300 && parsed.origin === serverOrigin) fetchedPaths.add(parsed.pathname);
    } catch {
      // Ignore non-standard schemes
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

  const t0 = performance.now();
  let timedOut = false;
  let pageData = null;
  let navError = null;

  try {
    const targetUrl = `${serverUrl}/demo/?scenario=${encodeURIComponent(scenarioId)}`;
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    const waitResult = await waitForScenarioCompletion(page, timeoutMs);
    timedOut = waitResult.timedOut;
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
          complete: state?.complete ? wallComplete : null,
        },
      };
    }, completeWallMs);
  } catch (err) {
    navError = err instanceof Error ? err.message : String(err);
  } finally {
    await context.close();
  }

  const misses = pageData?.misses ?? [];
  const cspViolations = pageData?.cspViolations ?? [];
  const timings = pageData?.timings ?? {
    readyAt: null,
    firstPaint: null,
    complete: null,
  };
  const complete = Boolean(pageData?.state?.complete) && !timedOut && !navError;
  const transferKb = gzippedTransferKb(rootDir, fetchedPaths);

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
  if (transferKb > maxTransferKb)
    failureReasons.push(`transfer ${transferKb}KB gzip > budget ${maxTransferKb}KB`);

  return {
    scenario: scenarioId,
    passed: failureReasons.length === 0,
    timings,
    transferKb,
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

function printCompactTable(results) {
  const headers = [
    'Scenario',
    'Status',
    'firstPaint(ms)',
    'readyAt(ms)',
    'complete(ms)',
    'gzKB',
    'Misses',
    'Errors',
    'Warns',
    'CSP',
    'ExtReq',
  ];
  const rows = results.map((r) => [
    r.scenario,
    r.passed ? 'PASS' : 'FAIL',
    String(r.timings.firstPaint ?? '-'),
    String(r.timings.readyAt ?? '-'),
    String(r.timings.complete ?? '-'),
    String(r.transferKb),
    String(r.misses.length),
    String(r.consoleErrors.length + r.pageErrors.length + r.httpErrors.length),
    String(r.consoleWarnings.length),
    String(r.cspViolations.length),
    String(r.externalRequests.length),
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
        `[check-live-demo] FAIL (${r.scenario}): ${r.failureReasons.join(', ')}`,
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

export async function checkLiveDemo(rawOptions = {}) {
  const rootDir = resolve(WORKSPACE_ROOT, rawOptions.root ?? DEFAULT_ROOT);
  const timeoutMs = Number(rawOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxTransferKb = Number(rawOptions.maxTransferKb ?? DEFAULT_MAX_TRANSFER_KB);
  if (!(maxTransferKb > 0)) {
    throw new Error(`--max-transfer-kb must be a positive number, got ${rawOptions.maxTransferKb}`);
  }
  const artifactInfo = await verifyDemoArtifacts(rootDir);
  const scenarios = await resolveScenarios(
    rootDir,
    rawOptions.scenarios ?? [],
  );

  const serverHandle = await startStaticServer({ root: rootDir, port: 0 });
  let browser;
  const results = [];

  try {
    browser = await chromium.launch({ headless: true });
    for (const scenarioId of scenarios) {
      const res = await runScenarioCheck(
        browser,
        serverHandle.url,
        scenarioId,
        timeoutMs,
        rootDir,
        maxTransferKb,
      );
      results.push(res);
    }
  } finally {
    await browser?.close();
    await serverHandle.close();
  }

  const passed = results.every((r) => r.passed);
  const summary = {
    passed,
    rootDir,
    checkedAt: new Date().toISOString(),
    artifactInfo,
    results,
  };

  if (rawOptions.json) {
    const jsonPath = resolve(WORKSPACE_ROOT, rawOptions.json);
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  }

  printCompactTable(results);
  return summary;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const summary = await checkLiveDemo(opts);
    if (!summary.passed) {
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `[check-live-demo] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
