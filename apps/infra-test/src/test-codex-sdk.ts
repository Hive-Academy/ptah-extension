/**
 * Codex SDK Spawn Test
 *
 * Isolates the `spawn EINVAL` issue with @openai/codex-sdk on Windows.
 * Tests both the raw SDK path and the resolved binary path (unwrapping .cmd).
 *
 * Usage: npx ts-node apps/infra-test/src/test-codex-sdk.ts
 */
import whichLib from 'which';
import { readFile } from 'fs/promises';
import * as path from 'path';

const TEST_PROMPT = 'What is 2+2? Reply with just the number.';
const TIMEOUT_MS = 30_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveCliPath(binary: string): Promise<string | null> {
  try {
    return await whichLib(binary);
  } catch {
    return null;
  }
}

/**
 * On Windows, npm-installed CLIs are .cmd wrapper scripts.
 * The Codex SDK uses child_process.spawn() internally, which cannot
 * execute .cmd files without shell: true — causing EINVAL.
 *
 * This extracts the actual Node.js script path from the .cmd wrapper.
 */
async function resolveWindowsCmd(binaryPath: string): Promise<string> {
  if (process.platform !== 'win32') return binaryPath;
  if (!binaryPath.toLowerCase().endsWith('.cmd')) return binaryPath;

  try {
    const content = await readFile(binaryPath, 'utf8');
    const dir = path.dirname(binaryPath);

    // npm .cmd wrappers use %~dp0 as the wrapper's directory.
    // The actual target is the last "%~dp0\<path>" reference.
    const regex = /"%(?:~dp0|dp0)%\\([^"]+)"/g;
    let lastMatch: string | null = null;
    let m;
    while ((m = regex.exec(content)) !== null) {
      lastMatch = m[1];
    }

    if (lastMatch) {
      return path.join(dir, lastMatch);
    }
  } catch {
    // Can't read/parse .cmd file — fall through to original
  }

  return binaryPath;
}

// ── SDK Test ─────────────────────────────────────────────────────────────────

async function testCodexSdk(codexPathOverride?: string): Promise<void> {
  const label = codexPathOverride
    ? `SDK with codexPathOverride="${codexPathOverride}"`
    : 'SDK with default path resolution';

  console.log(`\n--- Test: ${label} ---\n`);

  try {
    console.log('  [1] Importing @openai/codex-sdk (ESM dynamic import)...');
    // ESM-only package — use dynamic import() which works in both CJS and ESM contexts.
    // In CJS, Node.js handles "import" condition via dynamic import().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = await (Function(
      'return import("@openai/codex-sdk")'
    )() as Promise<any>);
    console.log('  [OK] SDK imported successfully');
    console.log('  [1a] SDK exports:', Object.keys(sdk).join(', '));

    console.log('  [2] Creating Codex client...');
    const options: Record<string, unknown> = {};
    if (codexPathOverride) {
      options['codexPathOverride'] = codexPathOverride;
    }
    const codex = new sdk.Codex(options);
    console.log('  [OK] Codex client created');

    console.log('  [3] Starting thread...');
    const thread = codex.startThread({
      workingDirectory: process.cwd(),
      approvalPolicy: 'never',
    });
    console.log('  [OK] Thread started');

    console.log('  [4] Running streamed turn...');
    const abortController = new AbortController();

    // Timeout guard
    const timer = setTimeout(() => {
      console.log(`\n  [TIMEOUT] Aborting after ${TIMEOUT_MS / 1000}s`);
      abortController.abort();
    }, TIMEOUT_MS);

    try {
      const streamedTurn = await thread.runStreamed(TEST_PROMPT, {
        signal: abortController.signal,
      });

      console.log('  [OK] runStreamed() returned — iterating events...\n');

      let eventCount = 0;
      for await (const event of streamedTurn.events) {
        eventCount++;
        const eventSummary = summarizeEvent(event);
        console.log(`  Event #${eventCount}: ${eventSummary}`);

        if (eventCount > 50) {
          console.log('  [LIMIT] Stopping after 50 events');
          abortController.abort();
          break;
        }
      }

      console.log(`\n  [DONE] Received ${eventCount} events total`);
    } finally {
      clearTimeout(timer);
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.log(`\n  [FAIL] ${err.message}`);
    if (err.message.includes('EINVAL')) {
      console.log('  [DIAGNOSIS] spawn EINVAL — the SDK is trying to spawn a');
      console.log('    .cmd wrapper file directly via child_process.spawn().');
      console.log(
        '    On Windows, .cmd files require shell: true or the actual'
      );
      console.log('    Node.js script path must be used instead.');
    }
    if ('code' in err) {
      console.log(`  [ERROR CODE] ${(err as NodeJS.ErrnoException).code}`);
    }
    // Print stack for deeper diagnosis
    if (err.stack) {
      console.log(`  [STACK]\n${err.stack.split('\n').slice(0, 8).join('\n')}`);
    }
  }
}

function summarizeEvent(event: Record<string, unknown>): string {
  const type = event['type'] as string;
  switch (type) {
    case 'thread.started':
      return `thread.started (id: ${event['thread_id']})`;
    case 'turn.started':
      return 'turn.started';
    case 'turn.completed': {
      const usage = event['usage'] as Record<string, number> | undefined;
      return usage
        ? `turn.completed (in: ${usage['input_tokens']}, out: ${usage['output_tokens']})`
        : 'turn.completed';
    }
    case 'turn.failed': {
      const err = event['error'] as Record<string, string> | undefined;
      return `turn.failed: ${err?.['message'] ?? 'unknown'}`;
    }
    case 'item.started':
    case 'item.updated':
    case 'item.completed': {
      const item = event['item'] as Record<string, unknown> | undefined;
      const itemType = item?.['type'] as string;
      const text = item?.['text'] as string;
      const preview = text ? ` "${text.substring(0, 80)}"` : '';
      return `${type} [${itemType}]${preview}`;
    }
    case 'error':
      return `error: ${event['message']}`;
    default:
      return `${type} ${JSON.stringify(event).substring(0, 100)}`;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Codex SDK Spawn Diagnostic ===\n');
  console.log(`Platform: ${process.platform}`);
  console.log(`Node: ${process.version}`);
  console.log(`CWD: ${process.cwd()}`);
  console.log(`Prompt: "${TEST_PROMPT}"`);

  // Step 1: Find codex binary
  const codexPath = await resolveCliPath('codex');
  console.log(`\nCodex binary (which): ${codexPath ?? 'NOT FOUND'}`);

  if (!codexPath) {
    console.log(
      '\nCodex CLI not found. Install with: npm install -g @openai/codex'
    );
    process.exit(1);
  }

  // Step 2: Check if it's a .cmd wrapper
  const isCmd = codexPath.toLowerCase().endsWith('.cmd');
  console.log(`Is .cmd wrapper: ${isCmd}`);

  let resolvedPath: string | undefined;
  if (isCmd) {
    resolvedPath = await resolveWindowsCmd(codexPath);
    console.log(`Resolved from .cmd: ${resolvedPath}`);

    // Show .cmd contents for diagnosis
    try {
      const cmdContent = await readFile(codexPath, 'utf8');
      console.log(`\n.cmd file contents:\n---`);
      console.log(cmdContent.substring(0, 500));
      console.log('---');
    } catch {
      console.log('Could not read .cmd file');
    }
  }

  // Test 1: No codexPathOverride — SDK resolves from PATH itself
  // This is what our fix does: skip override when path is .cmd
  await testCodexSdk();

  // Test 2: With .CMD path as override (reproduces the EINVAL bug)
  if (isCmd) {
    console.log(
      '\n[NOTE] Test 2 demonstrates the EINVAL bug when .cmd path is passed'
    );
    await testCodexSdk(codexPath);
  }

  // Test 3: With resolved .js path as override (EFTYPE on Windows)
  if (resolvedPath && resolvedPath !== codexPath) {
    console.log(
      '\n[NOTE] Test 3 demonstrates EFTYPE when .js script path is passed'
    );
    await testCodexSdk(resolvedPath);
  }

  console.log('\n=== Diagnostic Complete ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
