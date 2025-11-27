/**
 * Schema Extraction Script v2 for Claude CLI JSONL Files
 *
 * Improved version that properly groups agents by slug and shows relationships.
 *
 * Usage: node analyze-schema-v2.js <directory>
 */

const fs = require('fs');
const path = require('path');

// Analyze a single JSONL file
function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());

  const fileAnalysis = {
    path: filePath,
    fileName: path.basename(filePath),
    lineCount: lines.length,
    // From first message
    agentId: null,
    sessionId: null,
    isSidechain: null,
    model: null,
    // Aggregated from all messages
    slugs: new Set(),
    hasToolUse: false,
    hasToolResult: false,
    toolNames: new Set(),
    contentTypes: new Set(),
    // Message breakdown
    messageTypes: {},
  };

  for (let i = 0; i < lines.length; i++) {
    try {
      const msg = JSON.parse(lines[i]);

      // Extract basic info from first message
      if (i === 0) {
        fileAnalysis.agentId = msg.agentId;
        fileAnalysis.sessionId = msg.sessionId;
        fileAnalysis.isSidechain = msg.isSidechain;
        fileAnalysis.model = msg.message?.model;
      }

      // Collect slugs from ANY message
      if (msg.slug) {
        fileAnalysis.slugs.add(msg.slug);
      }

      // Track message types
      const typeKey = msg.type || 'unknown';
      if (!fileAnalysis.messageTypes[typeKey]) {
        fileAnalysis.messageTypes[typeKey] = 0;
      }
      fileAnalysis.messageTypes[typeKey]++;

      // Analyze content blocks
      if (msg.message?.content && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          fileAnalysis.contentTypes.add(block.type);

          if (block.type === 'tool_use') {
            fileAnalysis.hasToolUse = true;
            if (block.name) {
              fileAnalysis.toolNames.add(block.name);
            }
          }
          if (block.type === 'tool_result') {
            fileAnalysis.hasToolResult = true;
          }
        }
      }
    } catch (e) {
      console.error(`Error parsing line ${i + 1} in ${filePath}: ${e.message}`);
    }
  }

  // Convert Sets to arrays for display
  fileAnalysis.slugs = [...fileAnalysis.slugs];
  fileAnalysis.toolNames = [...fileAnalysis.toolNames];
  fileAnalysis.contentTypes = [...fileAnalysis.contentTypes];

  return fileAnalysis;
}

// Main analysis function
function analyzeDirectory(dirPath) {
  const files = fs.readdirSync(dirPath);

  const mainSessions = [];
  const agentSessions = [];

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;

    const filePath = path.join(dirPath, file);
    const isAgentFile = file.startsWith('agent-');

    const analysis = analyzeFile(filePath);

    if (isAgentFile) {
      agentSessions.push(analysis);
    } else {
      mainSessions.push(analysis);
    }
  }

  return { mainSessions, agentSessions };
}

// Classify agent type
function classifyAgent(agent) {
  if (agent.slugs.length === 0 && !agent.hasToolUse) {
    return 'WARMUP';
  }
  if (agent.slugs.length > 0 && agent.hasToolUse) {
    return 'EXECUTION';
  }
  if (agent.slugs.length > 0 && !agent.hasToolUse) {
    return 'SUMMARY';
  }
  // Edge case: no slug but has tool_use - orphan execution
  if (agent.slugs.length === 0 && agent.hasToolUse) {
    return 'ORPHAN_EXECUTION';
  }
  return 'UNKNOWN';
}

// Generate report
function generateReport(analysis) {
  const { mainSessions, agentSessions } = analysis;

  console.log('\n' + '='.repeat(80));
  console.log('CLAUDE CLI JSONL SCHEMA ANALYSIS REPORT v2');
  console.log('='.repeat(80));

  // Main Sessions
  console.log('\n## MAIN SESSIONS\n');
  for (const session of mainSessions) {
    console.log(`### ${session.fileName}`);
    console.log(`   SessionId: ${session.sessionId}`);
    console.log(`   Lines: ${session.lineCount}`);
    console.log(`   Message Types: ${JSON.stringify(session.messageTypes)}`);
    console.log(`   Content Types: ${session.contentTypes.join(', ')}`);
    console.log(`   Tools Used: ${session.toolNames.join(', ') || 'none'}`);
    console.log('');
  }

  // Group agents by sessionId, then by slug
  console.log('\n## AGENT SESSIONS (Grouped by Session & Slug)\n');

  const bySessionId = {};
  for (const agent of agentSessions) {
    if (!bySessionId[agent.sessionId]) {
      bySessionId[agent.sessionId] = [];
    }
    bySessionId[agent.sessionId].push(agent);
  }

  for (const [sessionId, agents] of Object.entries(bySessionId)) {
    console.log(`### Session: ${sessionId}`);
    console.log(`   Total agent files: ${agents.length}`);

    // Group by slug
    const bySlug = {};
    const noSlug = [];

    for (const agent of agents) {
      if (agent.slugs.length > 0) {
        const slug = agent.slugs[0]; // Use first slug
        if (!bySlug[slug]) bySlug[slug] = [];
        bySlug[slug].push(agent);
      } else {
        noSlug.push(agent);
      }
    }

    // Show slug groups
    for (const [slug, slugAgents] of Object.entries(bySlug)) {
      console.log(`\n   #### Slug: "${slug}"`);
      console.log(`      Agent files in this group: ${slugAgents.length}`);

      for (const agent of slugAgents) {
        const classification = classifyAgent(agent);
        console.log(`\n      [${classification}] ${agent.fileName}`);
        console.log(`         AgentId: ${agent.agentId}`);
        console.log(`         Model: ${agent.model}`);
        console.log(`         Lines: ${agent.lineCount}`);
        console.log(`         isSidechain: ${agent.isSidechain}`);
        console.log(`         Has tool_use: ${agent.hasToolUse}`);
        console.log(`         Content types: ${agent.contentTypes.join(', ')}`);
        if (agent.toolNames.length > 0) {
          console.log(`         Tools: ${agent.toolNames.join(', ')}`);
        }
        console.log(
          `         Message breakdown: ${JSON.stringify(agent.messageTypes)}`
        );
      }
    }

    // Show no-slug agents
    if (noSlug.length > 0) {
      console.log(`\n   #### No Slug (Warmup/Orphan)`);
      for (const agent of noSlug) {
        const classification = classifyAgent(agent);
        console.log(`\n      [${classification}] ${agent.fileName}`);
        console.log(`         AgentId: ${agent.agentId}`);
        console.log(`         Model: ${agent.model}`);
        console.log(`         Lines: ${agent.lineCount}`);
        console.log(`         Has tool_use: ${agent.hasToolUse}`);
        console.log(`         Content types: ${agent.contentTypes.join(', ')}`);
      }
    }

    console.log('\n');
  }

  // Summary statistics
  console.log('\n## CLASSIFICATION SUMMARY\n');

  const classifications = {
    WARMUP: 0,
    SUMMARY: 0,
    EXECUTION: 0,
    ORPHAN_EXECUTION: 0,
    UNKNOWN: 0,
  };

  for (const agent of agentSessions) {
    const type = classifyAgent(agent);
    classifications[type]++;
  }

  console.log(
    `   WARMUP agents (no slug, no tool_use): ${classifications.WARMUP}`
  );
  console.log(
    `   SUMMARY agents (has slug, no tool_use): ${classifications.SUMMARY}`
  );
  console.log(
    `   EXECUTION agents (has slug, has tool_use): ${classifications.EXECUTION}`
  );
  console.log(
    `   ORPHAN_EXECUTION (no slug, has tool_use): ${classifications.ORPHAN_EXECUTION}`
  );
  console.log(`   UNKNOWN: ${classifications.UNKNOWN}`);

  // Key insight
  console.log('\n## KEY INSIGHTS\n');
  console.log(
    '   1. Agents with the SAME SLUG belong to the SAME logical agent invocation'
  );
  console.log(
    '   2. SUMMARY agents: Have slug, mostly text content (XML-like <function_calls>)'
  );
  console.log(
    '   3. EXECUTION agents: Have slug, contain actual tool_use blocks'
  );
  console.log(
    '   4. WARMUP agents: No slug, just initial response text - FILTER OUT'
  );
  console.log(
    '   5. The slug may appear on ANY message (not always the first line!)'
  );
}

// Run
const targetDir = process.argv[2] || './test-sessions';
console.log(`Analyzing directory: ${targetDir}`);

try {
  const analysis = analyzeDirectory(targetDir);
  generateReport(analysis);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
