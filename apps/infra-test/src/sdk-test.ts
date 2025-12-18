/**
 * SDK Message Structure Test
 *
 * This test directly calls the Claude Agent SDK to understand:
 * 1. What message structure the SDK returns
 * 2. How messages should be grouped (by messageId? by type?)
 * 3. The relationship between message_start, text_delta, and message_complete
 */

import * as fs from 'fs';
import * as path from 'path';

interface SDKMessage {
  type: string;
  uuid?: string;
  message?: {
    id?: string;
    content?: unknown[];
    model?: string;
    usage?: { input_tokens: number; output_tokens: number };
  };
  event?: {
    type?: string;
    message?: { id?: string };
    index?: number;
    delta?: {
      type?: string;
      text?: string;
    };
  };
  [key: string]: unknown;
}

async function testSdkMessageStructure(): Promise<void> {
  console.log('\n' + '='.repeat(70));
  console.log('  SDK MESSAGE STRUCTURE TEST');
  console.log('='.repeat(70) + '\n');

  try {
    // Dynamic import of ESM SDK
    console.log('Importing Claude Agent SDK...');
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    console.log('SDK imported successfully\n');

    const allMessages: SDKMessage[] = [];
    const messagesByType = new Map<string, SDKMessage[]>();
    const messagesByUuid = new Map<string, SDKMessage[]>();

    // Longer prompt to potentially trigger streaming events
    const prompt =
      'Write a haiku about TypeScript programming. Then explain what makes it good.';
    console.log(`Prompt: "${prompt}"\n`);

    console.log('Starting SDK query...\n');
    // Use includePartialMessages: true to enable streaming events
    // This is what our real adapter uses
    const sdkQuery = query({
      prompt,
      options: {
        maxTurns: 1,
        includePartialMessages: true, // CRITICAL: Enable streaming events
      },
    });

    let messageCount = 0;
    for await (const message of sdkQuery) {
      messageCount++;
      const sdkMsg = message as SDKMessage;
      allMessages.push(sdkMsg);

      // Group by type
      const type = sdkMsg.type;
      if (!messagesByType.has(type)) {
        messagesByType.set(type, []);
      }
      messagesByType.get(type)!.push(sdkMsg);

      // Group by UUID (for assistant/user messages)
      const uuid =
        sdkMsg.uuid || sdkMsg.message?.id || sdkMsg.event?.message?.id;
      if (uuid) {
        if (!messagesByUuid.has(uuid)) {
          messagesByUuid.set(uuid, []);
        }
        messagesByUuid.get(uuid)!.push(sdkMsg);
      }

      // Log each message
      console.log(`[${messageCount}] type=${type}`);
      if (sdkMsg.uuid) console.log(`     uuid=${sdkMsg.uuid}`);
      if (sdkMsg.event?.type)
        console.log(`     event.type=${sdkMsg.event.type}`);
      if (sdkMsg.event?.message?.id)
        console.log(`     event.message.id=${sdkMsg.event.message.id}`);
      if (sdkMsg.event?.delta?.type)
        console.log(`     delta.type=${sdkMsg.event.delta.type}`);
      if (sdkMsg.event?.delta?.text)
        console.log(`     delta.text="${sdkMsg.event.delta.text}"`);
      console.log('');
    }

    console.log('\n' + '='.repeat(70));
    console.log('  ANALYSIS');
    console.log('='.repeat(70) + '\n');

    console.log(`Total messages received: ${messageCount}\n`);

    // Show message types
    console.log('Messages by TYPE:');
    for (const [type, msgs] of messagesByType) {
      console.log(`  ${type}: ${msgs.length} messages`);
    }
    console.log('');

    // Show messages grouped by UUID
    console.log('Messages by UUID:');
    for (const [uuid, msgs] of messagesByUuid) {
      const types = msgs.map((m) => m.type || m.event?.type).join(', ');
      console.log(
        `  ${uuid.substring(0, 20)}...: ${msgs.length} messages (${types})`
      );
    }
    console.log('');

    // Save raw output for analysis
    const outputPath = path.join(process.cwd(), 'sdk-messages-raw.json');
    fs.writeFileSync(outputPath, JSON.stringify(allMessages, null, 2));
    console.log(`Raw messages saved to: ${outputPath}`);

    // Key insights
    console.log('\n' + '='.repeat(70));
    console.log('  KEY INSIGHTS');
    console.log('='.repeat(70) + '\n');

    // Check if stream_event messages are present
    const streamEvents = messagesByType.get('stream_event') || [];
    const assistantMessages = messagesByType.get('assistant') || [];
    const userMessages = messagesByType.get('user') || [];
    const systemMessages = messagesByType.get('system') || [];
    const resultMessages = messagesByType.get('result') || [];

    console.log('Message flow:');
    console.log(`  1. system (init): ${systemMessages.length} messages`);
    console.log(`  2. user: ${userMessages.length} messages`);
    console.log(
      `  3. stream_event (streaming): ${streamEvents.length} messages`
    );
    console.log(
      `  4. assistant (complete): ${assistantMessages.length} messages`
    );
    console.log(`  5. result (stats): ${resultMessages.length} messages`);

    if (assistantMessages.length > 0) {
      const assistant = assistantMessages[0];
      console.log('\n--- Complete assistant message structure ---');
      console.log(JSON.stringify(assistant, null, 2).substring(0, 2000));
    }

    if (streamEvents.length > 0) {
      console.log('\n--- Sample stream_event structures ---');
      // Show message_start, text_delta, message_stop
      const msgStart = streamEvents.find(
        (e) => e.event?.type === 'message_start'
      );
      const textDelta = streamEvents.find(
        (e) => e.event?.delta?.type === 'text_delta'
      );
      const msgStop = streamEvents.find(
        (e) => e.event?.type === 'message_stop'
      );

      if (msgStart) {
        console.log('\nmessage_start:');
        console.log(JSON.stringify(msgStart, null, 2).substring(0, 1000));
      }
      if (textDelta) {
        console.log('\ncontent_block_delta (text):');
        console.log(JSON.stringify(textDelta, null, 2));
      }
      if (msgStop) {
        console.log('\nmessage_stop:');
        console.log(JSON.stringify(msgStop, null, 2));
      }
    }
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Run the test
testSdkMessageStructure()
  .then(() => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
