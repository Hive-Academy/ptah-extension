// CommonJS — VS Code's test runner loads this via require() inside the
// extension host. Plain Node assert keeps the dep surface to zero.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const vscode = require('vscode');

const EXTENSION_ID = 'ptah-extensions.ptah-coding-orchestra';
const ACTIVATION_TIMEOUT_MS = 30_000;

/**
 * Wait until the extension is active (or fail with a clear timeout).
 * Returns the active extension.
 */
async function waitForActivation() {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  if (!ext) {
    throw new Error(
      `Extension "${EXTENSION_ID}" not found. Did you build it into ` +
        `dist/apps/ptah-extension-vscode and point extensionDevelopmentPath ` +
        `at that directory?`,
    );
  }

  // Force activation if it hasn't fired on its own (activationEvents may be
  // `onStartupFinished` which lags behind test startup).
  if (!ext.isActive) {
    const deadline = Date.now() + ACTIVATION_TIMEOUT_MS;
    let lastError;
    try {
      await ext.activate();
    } catch (err) {
      lastError = err;
    }
    while (!ext.isActive && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ext.isActive) {
      const reason =
        lastError instanceof Error
          ? `${lastError.message}\n${lastError.stack ?? ''}`
          : String(lastError ?? '(no error captured)');
      throw new Error(
        `Extension never reached isActive=true within ${ACTIVATION_TIMEOUT_MS}ms.\n` +
          `Last activate() error (if any): ${reason}`,
      );
    }
  }

  return ext;
}

/** Minimal test runner — Mocha-free, dependency-free. */
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ----- Specs -------------------------------------------------------------

test('extension is discovered by VS Code', async () => {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} not registered`);
  assert.equal(ext.id, EXTENSION_ID);
});

test('activate() resolves without throwing', async () => {
  const ext = await waitForActivation();
  assert.equal(ext.isActive, true, 'extension did not become active');
});

test('exports the expected activation API surface (or empty if intentional)', async () => {
  const ext = await waitForActivation();
  // The extension currently exports nothing public; assert the shape is
  // `undefined` or a plain object so a future accidental string/throw fails.
  const exported = ext.exports;
  if (exported !== undefined) {
    assert.equal(
      typeof exported,
      'object',
      `extension exports should be object|undefined, got ${typeof exported}`,
    );
  }
});

test('at least one Ptah command is registered after activation', async () => {
  await waitForActivation();
  const allCommands = await vscode.commands.getCommands(true);
  const ptahCommands = allCommands.filter((c) => c.startsWith('ptah.'));
  assert.ok(
    ptahCommands.length > 0,
    `expected at least one ptah.* command, found 0 (total registered: ${allCommands.length})`,
  );
});

test('package.json declares ptah activation events', async () => {
  const ext = await waitForActivation();
  const events = ext.packageJSON.activationEvents;
  assert.ok(Array.isArray(events), 'activationEvents must be an array');
  assert.ok(
    events.length > 0,
    `activationEvents should be non-empty; got: ${JSON.stringify(events)}`,
  );
  // The current manifest activates on view + a handful of commands. Assert
  // that ptah.* commands are listed so a future scope-creep removal fails.
  const ptahEvents = events.filter(
    (e) => e.includes('ptah.') || e.includes('ptah:'),
  );
  assert.ok(
    ptahEvents.length > 0,
    `expected at least one ptah.* activation event; got: ${JSON.stringify(events)}`,
  );
});

// ----- State-aware checks ------------------------------------------------
//
// The cold-start case passes trivially. The failure mode reported in
// production is state-dependent: it only triggers when ~/.ptah/ already
// has a settings file, secrets blob, or sqlite db from a previous version.
// These specs document the state we observed AT FAILURE so a future
// regression in the v3 migration / stateful activation path fails CI
// instead of fails Marketplace.

test('~/.ptah directory state at end of activation is observable', async () => {
  // We don't assert specific contents — only that we can read the dir
  // (rules out permission issues) and that no half-written temp files
  // remain after activation completes.
  await waitForActivation();
  const ptahDir = path.join(os.homedir(), '.ptah');
  if (!fs.existsSync(ptahDir)) {
    // First run — directory may not exist yet; that's a valid state.
    return;
  }
  const entries = fs.readdirSync(ptahDir);
  const leftoverTemps = entries.filter(
    (e) => e.endsWith('.tmp') || e.endsWith('.partial'),
  );
  assert.equal(
    leftoverTemps.length,
    0,
    `~/.ptah contains leftover temp files after activation: ${leftoverTemps.join(', ')}`,
  );
});

test('activation does not leave the host with pending unhandledRejections', async () => {
  // Capture rejections during a settle window AFTER activation. If the
  // host had a deferred rejection (the production failure pattern), it
  // would surface here. We attach the listener inside the extension host
  // because that's where the rejection would fire.
  await waitForActivation();
  const captured = [];
  const onReject = (reason) => captured.push(reason);
  process.on('unhandledRejection', onReject);
  try {
    // Give the extension's fire-and-forget paths (preloadSdk, prewarm,
    // discovery watchers, indexer cold-start) a window to settle.
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    process.removeListener('unhandledRejection', onReject);
  }
  if (captured.length > 0) {
    const messages = captured.map((r) =>
      r instanceof Error ? `${r.message}\n${r.stack ?? ''}` : String(r),
    );
    assert.fail(
      `unhandledRejection(s) fired after activation:\n${messages.join('\n---\n')}`,
    );
  }
});

// ----- Mocha-style entry point expected by @vscode/test-electron ---------

module.exports = {
  async run() {
    const failures = [];
    const startedAt = Date.now();
    console.log(`\n  Ptah VS Code activation e2e (${tests.length} tests)\n`);
    for (const { name, fn } of tests) {
      const t0 = Date.now();
      try {
        await fn();
        const dt = Date.now() - t0;
        console.log(`    ✓ ${name} (${dt}ms)`);
      } catch (err) {
        const dt = Date.now() - t0;
        failures.push({ name, err });
        const msg =
          err instanceof Error
            ? `${err.message}\n${err.stack ?? ''}`
            : String(err);
        console.error(`    ✗ ${name} (${dt}ms)\n      ${msg}`);
      }
    }
    const totalMs = Date.now() - startedAt;
    console.log(
      `\n  ${tests.length - failures.length} passing, ${failures.length} failing (${totalMs}ms)\n`,
    );
    if (failures.length > 0) {
      throw new Error(`${failures.length} e2e test(s) failed`);
    }
  },
};

// Silence unused-warning for the suite path constant (left for future use).
void path;
