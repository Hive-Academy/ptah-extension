/**
 * Claude Agent SDK Model Mapping Test
 *
 * Tests what models the Claude CLI/SDK exposes and how 'default' resolves,
 * by querying the CLI with different model aliases.
 *
 * Key finding (2026-03-15): 'default' now resolves to claude-opus-4-6[1m],
 * not Sonnet as previously assumed. This affects tier mapping in the extension.
 *
 * Usage: npx ts-node apps/infra-test/src/test-claude-sdk-models.ts
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface CliJsonResult {
  type: string;
  model?: string;
  modelUsage?: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      costUSD: number;
      contextWindow: number;
    }
  >;
  [key: string]: unknown;
}

// ── Test 1: Model alias resolution ──────────────────────────────────────────

async function testModelAliasResolution(): Promise<void> {
  console.log('\n=== Test 1: Model Alias Resolution ===\n');

  const aliases = ['default', 'sonnet', 'opus', 'haiku'];

  for (const alias of aliases) {
    try {
      console.log(`  Testing --model ${alias}...`);

      const { stdout } = await execFileAsync(
        'claude',
        [
          '--model',
          alias,
          '-p',
          '--output-format',
          'json',
          'respond with just the word hello',
        ],
        { timeout: 30_000, shell: true }
      );

      const result = JSON.parse(stdout.trim()) as CliJsonResult;

      // Extract actual model from modelUsage keys
      const actualModels = result.modelUsage
        ? Object.keys(result.modelUsage)
        : [];

      console.log(`    Alias "${alias}" → ${actualModels.join(', ')}`);

      if (result.modelUsage) {
        for (const [modelId, usage] of Object.entries(result.modelUsage)) {
          console.log(
            `      Model: ${modelId}, Context: ${
              usage.contextWindow
            }, Cost: $${usage.costUSD.toFixed(6)}`
          );
        }
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.log(`    [FAIL] ${err.message.substring(0, 200)}`);
    }
    console.log('');
  }
}

// ── Test 2: Init message model field ────────────────────────────────────────

async function testInitMessage(): Promise<void> {
  console.log('\n=== Test 2: Init Message (default model) ===\n');

  try {
    const { stdout } = await execFileAsync(
      'claude',
      [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        'respond with just hello',
      ],
      { timeout: 30_000, shell: true }
    );

    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      try {
        const event = JSON.parse(line);

        if (event.type === 'system' && event.subtype === 'init') {
          console.log(`  Default model (from init): ${event.model}`);
          console.log(`  Claude Code version: ${event.claude_code_version}`);
          console.log(`  Fast mode: ${event.fast_mode_state}`);

          // Determine tier
          const model = (event.model as string).toLowerCase();
          if (model.includes('opus')) {
            console.log(
              '\n  [CONFIRMED] Default model is now OPUS (was Sonnet previously)'
            );
          } else if (model.includes('sonnet')) {
            console.log('\n  [INFO] Default model is still Sonnet');
          } else {
            console.log(`\n  [INFO] Default model: ${event.model}`);
          }
          break;
        }
      } catch {
        // skip non-JSON lines
      }
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.log(`  [FAIL] ${err.message.substring(0, 200)}`);
  }
}

// ── Test 3: Extension impact analysis ───────────────────────────────────────

function analyzeExtensionImpact(): void {
  console.log('\n=== Test 3: Extension Impact Analysis ===\n');

  console.log('  Affected code in config-rpc.handlers.ts:\n');

  console.log('  1. TIER MAPPING (line ~350):');
  console.log(
    '     Current: valueLower === "default" → maps to tierOverrides.sonnet'
  );
  console.log(
    '     Problem: "default" is now Opus, so it should map to tierOverrides.opus'
  );
  console.log(
    '     Fix: Use displayName to detect tier, or map "default" → opus\n'
  );

  console.log('  2. isRecommended FLAG (line ~375):');
  console.log(
    '     Current: isRecommended = valueLower.includes("sonnet") || valueLower === "default"'
  );
  console.log(
    '     Problem: "default" (now Opus) gets the "Recommended" badge'
  );
  console.log(
    '     Fix: Remove valueLower === "default" from isRecommended condition\n'
  );

  console.log('  3. FALLBACK_MODELS (sdk-model-service.ts):');
  console.log(
    '     Current first entry: claude-sonnet-4-5-20250929 (used by getDefaultModel())'
  );
  console.log(
    '     Consider: Should first entry be Opus now to match SDK behavior?\n'
  );

  console.log('  4. SAVED MODEL DEFAULT (config-rpc.handlers.ts line ~312):');
  console.log('     Current: defaults to "claude-sonnet-4-5-20250929"');
  console.log(
    '     Consider: Should this default to Opus to match new SDK behavior?\n'
  );

  console.log('  Recommended fix approach:');
  console.log(
    '  - Use displayName (contains "Opus"/"Sonnet"/"Haiku") for tier detection'
  );
  console.log(
    '  - This is more resilient than matching on the value "default"'
  );
  console.log(
    '  - The displayName approach also handles future value changes gracefully'
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('==========================================================');
  console.log('  Claude Agent SDK Model Mapping Test');
  console.log('==========================================================\n');
  console.log(`Platform: ${process.platform}`);
  console.log(`Node: ${process.version}`);

  await testModelAliasResolution();
  await testInitMessage();
  analyzeExtensionImpact();

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
