/**
 * Claude Agent SDK Context Window Test
 *
 * Tests what context window sizes the SDK reports for each model tier,
 * including the getContextUsage() API which provides maxTokens.
 *
 * Usage: npx tsx apps/infra-test/src/test-sdk-context-window.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'os';

async function testSupportedModels(): Promise<void> {
  console.log('\n=== Test 1: SDK supportedModels() ===\n');

  const emptyPrompt = (async function* () {})();

  const q = query({
    prompt: emptyPrompt,
    options: {
      cwd: os.homedir(),
    },
  });

  const models = await q.supportedModels();
  console.log(`  Found ${models.length} model tiers:\n`);
  for (const m of models) {
    console.log(`  - value: "${m.value}"`);
    console.log(`    displayName: "${m.displayName}"`);
    console.log(`    description: "${m.description}"`);
    console.log('');
  }
}

async function testModelUsageContextWindow(): Promise<void> {
  const tiers = ['opus', 'sonnet', 'haiku'];

  console.log('\n=== Test 2: modelUsage.contextWindow per tier ===\n');

  for (const tier of tiers) {
    try {
      console.log(`  Testing --model ${tier}...`);

      const conversation = query({
        prompt: 'respond with just the word hello',
        options: {
          cwd: os.homedir(),
          model: tier,
          maxTurns: 1,
        },
      });

      let result: Record<string, unknown> | undefined;
      for await (const msg of conversation) {
        if ((msg as Record<string, unknown>).type === 'result') {
          result = msg as Record<string, unknown>;
        }
      }

      if (result && result.modelUsage) {
        for (const [modelId, usage] of Object.entries(
          result.modelUsage as Record<
            string,
            {
              contextWindow: number;
              costUSD: number;
              inputTokens: number;
              outputTokens: number;
            }
          >,
        )) {
          console.log(`    Model: ${modelId}`);
          console.log(
            `    contextWindow: ${usage.contextWindow.toLocaleString()}`,
          );
          console.log(`    Cost: $${usage.costUSD.toFixed(6)}`);
        }
      } else {
        console.log(`    No modelUsage in result`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.log(`    [FAIL] ${err.message.substring(0, 200)}`);
    }
    console.log('');
  }
}

async function testGetContextUsage(): Promise<void> {
  const tiers = ['opus', 'sonnet', 'haiku'];

  console.log('\n=== Test 3: getContextUsage() — maxTokens per tier ===\n');

  for (const tier of tiers) {
    try {
      console.log(`  Testing --model ${tier}...`);

      const conversation = query({
        prompt: 'respond with just the word hello',
        options: {
          cwd: os.homedir(),
          model: tier,
          maxTurns: 1,
        },
      });

      // We need to send a message first to initialize the session,
      // then call getContextUsage()
      for await (const msg of conversation) {
        if ((msg as Record<string, unknown>).type === 'result') {
          break;
        }
      }

      // Now query context usage from the active session
      const contextUsage = await conversation.getContextUsage();
      console.log(`    model: ${contextUsage.model}`);
      console.log(`    maxTokens: ${contextUsage.maxTokens.toLocaleString()}`);
      console.log(
        `    rawMaxTokens: ${contextUsage.rawMaxTokens.toLocaleString()}`,
      );
      console.log(
        `    totalTokens: ${contextUsage.totalTokens.toLocaleString()}`,
      );
      console.log(`    percentage: ${contextUsage.percentage}%`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.log(`    [FAIL] ${err.message.substring(0, 200)}`);
    }
    console.log('');
  }
}

async function testModelSlashCommand(): Promise<void> {
  console.log('\n=== Test 4: /model query response ===\n');

  try {
    const conversation = query({
      prompt: '/model',
      options: {
        cwd: os.homedir(),
        maxTurns: 1,
      },
    });

    for await (const msg of conversation) {
      const m = msg as Record<string, unknown>;
      if (m.type === 'result') {
        console.log(`  Result type: ${m.type}`);
        console.log(`  Result subtype: ${m.subtype ?? 'N/A'}`);
        if (m.modelUsage) {
          console.log(`  modelUsage:`);
          for (const [modelId, usage] of Object.entries(
            m.modelUsage as Record<string, { contextWindow: number }>,
          )) {
            console.log(
              `    ${modelId}: contextWindow=${usage.contextWindow.toLocaleString()}`,
            );
          }
        }
        const resultText =
          typeof m.result === 'string' ? m.result : JSON.stringify(m.result);
        console.log(
          `  result text (first 500 chars): ${resultText?.substring(0, 500)}`,
        );
        break;
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.log(`  [FAIL] ${err.message.substring(0, 300)}`);
  }
}

async function main(): Promise<void> {
  console.log('==========================================================');
  console.log('  Claude Agent SDK Context Window Test');
  console.log('==========================================================\n');
  console.log(`Platform: ${process.platform}`);
  console.log(`Node: ${process.version}`);

  // Check SDK version
  try {
    const pkg = require('@anthropic-ai/claude-agent-sdk/package.json');
    console.log(`SDK: @anthropic-ai/claude-agent-sdk@${pkg.version}`);
  } catch {
    console.log('SDK: version unknown');
  }

  await testSupportedModels();
  await testModelUsageContextWindow();
  await testGetContextUsage();
  await testModelSlashCommand();

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
