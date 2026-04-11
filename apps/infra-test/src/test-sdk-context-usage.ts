/**
 * Claude Agent SDK getContextUsage() Test
 *
 * Tests the getContextUsage() API which returns maxTokens (real context window).
 * Must be called on an active session before the transport closes.
 *
 * Usage: npx tsx apps/infra-test/src/test-sdk-context-usage.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'os';

async function testContextUsageDuringStream(tier: string): Promise<void> {
  console.log(`\n  Testing --model ${tier}...`);

  try {
    const conversation = query({
      prompt: 'respond with just the word hello',
      options: {
        cwd: os.homedir(),
        model: tier,
        maxTurns: 1,
      },
    });

    // Call getContextUsage() immediately — the session should be initialized
    // before the first message arrives
    let contextFetched = false;

    for await (const msg of conversation) {
      const m = msg as Record<string, unknown>;

      // Try to get context usage as soon as we see the first message_start
      if (!contextFetched && m.type === 'assistant') {
        try {
          const ctx = await conversation.getContextUsage();
          console.log(`    model: ${ctx.model}`);
          console.log(`    maxTokens: ${ctx.maxTokens.toLocaleString()}`);
          console.log(`    rawMaxTokens: ${ctx.rawMaxTokens.toLocaleString()}`);
          console.log(`    totalTokens: ${ctx.totalTokens.toLocaleString()}`);
          console.log(`    percentage: ${ctx.percentage}%`);
          contextFetched = true;
        } catch (e) {
          console.log(
            `    getContextUsage() during assistant: ${(e as Error).message}`,
          );
        }
      }

      if (m.type === 'result') {
        // Also try modelUsage for comparison
        if (m.modelUsage) {
          for (const [modelId, usage] of Object.entries(
            m.modelUsage as Record<string, { contextWindow: number }>,
          )) {
            console.log(
              `    modelUsage[${modelId}].contextWindow: ${usage.contextWindow.toLocaleString()}`,
            );
          }
        }

        // Try getContextUsage right at result time (before loop exits)
        if (!contextFetched) {
          try {
            const ctx = await conversation.getContextUsage();
            console.log(`    model: ${ctx.model}`);
            console.log(`    maxTokens: ${ctx.maxTokens.toLocaleString()}`);
            console.log(
              `    rawMaxTokens: ${ctx.rawMaxTokens.toLocaleString()}`,
            );
            contextFetched = true;
          } catch (e) {
            console.log(
              `    getContextUsage() at result: ${(e as Error).message}`,
            );
          }
        }
      }
    }

    if (!contextFetched) {
      console.log(`    Could not fetch context usage`);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.log(`    [FAIL] ${err.message.substring(0, 300)}`);
  }
}

async function main(): Promise<void> {
  console.log('==========================================================');
  console.log('  Claude Agent SDK getContextUsage() Test');
  console.log('==========================================================');

  const tiers = ['opus', 'sonnet', 'haiku'];

  for (const tier of tiers) {
    await testContextUsageDuringStream(tier);
    console.log('');
  }

  console.log('=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
