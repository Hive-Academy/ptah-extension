/**
 * Verify Tool Linking Script
 *
 * This script verifies that tool_use and tool_result are properly linked
 * by tool_use_id in the execution agent files.
 *
 * Usage: node verify-tool-linking.js <agent-file.jsonl>
 */

const fs = require('fs');
const path = require('path');

function analyzeToolLinking(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());

  // Collect tool_use blocks
  const toolUses = new Map(); // id -> { name, input, lineNumber }

  // Collect tool_result blocks
  const toolResults = new Map(); // tool_use_id -> { content, lineNumber }

  for (let i = 0; i < lines.length; i++) {
    try {
      const msg = JSON.parse(lines[i]);
      const content = msg.message?.content;

      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === 'tool_use' && block.id) {
          toolUses.set(block.id, {
            name: block.name,
            input: block.input,
            lineNumber: i + 1,
          });
        }

        if (block.type === 'tool_result' && block.tool_use_id) {
          const resultContent = block.content;
          let contentPreview = '';

          if (typeof resultContent === 'string') {
            contentPreview = resultContent.substring(0, 100);
          } else if (Array.isArray(resultContent)) {
            contentPreview = resultContent
              .filter((c) => c.type === 'text')
              .map((c) => c.text || '')
              .join('\n')
              .substring(0, 100);
          }

          toolResults.set(block.tool_use_id, {
            content: contentPreview,
            lineNumber: i + 1,
          });
        }
      }
    } catch (e) {
      console.error(`Error parsing line ${i + 1}: ${e.message}`);
    }
  }

  // Report
  console.log(`\n=== Tool Linking Analysis: ${path.basename(filePath)} ===\n`);
  console.log(`Total tool_use blocks: ${toolUses.size}`);
  console.log(`Total tool_result blocks: ${toolResults.size}`);

  // Check linking
  let linked = 0;
  let unlinked = 0;

  console.log('\n--- Tool Use -> Result Linking ---\n');

  for (const [id, toolUse] of toolUses) {
    const result = toolResults.get(id);

    if (result) {
      linked++;
      console.log(`✅ ${toolUse.name} (line ${toolUse.lineNumber})`);
      console.log(`   ID: ${id}`);
      console.log(
        `   Result (line ${result.lineNumber}): ${result.content.substring(
          0,
          60
        )}...`
      );
    } else {
      unlinked++;
      console.log(
        `❌ ${toolUse.name} (line ${toolUse.lineNumber}) - NO RESULT FOUND`
      );
      console.log(`   ID: ${id}`);
    }
    console.log('');
  }

  // Check for orphan results (results without matching tool_use)
  const orphanResults = [];
  for (const [id, result] of toolResults) {
    if (!toolUses.has(id)) {
      orphanResults.push({ id, result });
    }
  }

  if (orphanResults.length > 0) {
    console.log('\n--- Orphan Results (no matching tool_use) ---\n');
    for (const { id, result } of orphanResults) {
      console.log(`⚠️ tool_use_id: ${id} (line ${result.lineNumber})`);
    }
  }

  console.log('\n--- Summary ---\n');
  console.log(`Linked: ${linked}`);
  console.log(`Unlinked (no result): ${unlinked}`);
  console.log(`Orphan results: ${orphanResults.length}`);
  console.log(`Link rate: ${((linked / toolUses.size) * 100).toFixed(1)}%`);
}

// Run
const filePath = process.argv[2];
if (!filePath) {
  console.log('Usage: node verify-tool-linking.js <agent-file.jsonl>');
  console.log(
    'Example: node verify-tool-linking.js ./test-sessions/agent-0df145bd.jsonl'
  );
  process.exit(1);
}

try {
  analyzeToolLinking(filePath);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
