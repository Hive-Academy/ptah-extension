/**
 * Schema Extraction Script for Claude CLI JSONL Files
 *
 * This script analyzes JSONL session files to understand the structure
 * of different message types and agent sessions.
 *
 * Usage: node analyze-schema.js <directory>
 * Example: node analyze-schema.js ./test-sessions
 */

const fs = require('fs');
const path = require('path');

// Track unique schemas by message type
const schemas = {
  // Main session message types
  mainSession: {
    byType: new Map(),        // type -> Set of field combinations
    bySubtype: new Map(),     // type:subtype -> Set of field combinations
  },
  // Agent session patterns
  agentSession: {
    bySlugPresence: {
      withSlug: [],           // Agents that have slug field
      withoutSlug: [],        // Agents without slug field
    },
    byContentType: new Map(), // content[0].type -> examples
  },
  // Field value examples
  fieldExamples: new Map(),   // fieldPath -> Set of example values
};

// Extract all keys from an object recursively
function extractKeys(obj, prefix = '') {
  const keys = [];
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      keys.push(fullKey);

      // Don't recurse into large arrays or deep objects
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Limit depth
        if (fullKey.split('.').length < 4) {
          keys.push(...extractKeys(value, fullKey));
        }
      }
    }
  }
  return keys;
}

// Get a simplified schema signature for a message
function getSchemaSignature(msg) {
  const keys = extractKeys(msg);
  return keys.sort().join('|');
}

// Extract important field values for analysis
function extractFieldValues(msg, fieldExamples) {
  const importantFields = [
    'type', 'subtype', 'isSidechain', 'isMeta', 'userType',
    'slug', 'agentId', 'tool', 'tool_use_id', 'parent_tool_use_id'
  ];

  for (const field of importantFields) {
    if (msg[field] !== undefined) {
      if (!fieldExamples.has(field)) {
        fieldExamples.set(field, new Set());
      }
      const examples = fieldExamples.get(field);
      if (examples.size < 10) { // Limit examples
        examples.add(JSON.stringify(msg[field]));
      }
    }
  }

  // Check message.content types
  if (msg.message?.content && Array.isArray(msg.message.content)) {
    const contentTypes = msg.message.content.map(c => c.type).join(',');
    if (!fieldExamples.has('message.content[].type')) {
      fieldExamples.set('message.content[].type', new Set());
    }
    fieldExamples.get('message.content[].type').add(contentTypes);
  }
}

// Analyze a single JSONL file
function analyzeFile(filePath, isAgentFile) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const fileAnalysis = {
    path: filePath,
    fileName: path.basename(filePath),
    lineCount: lines.length,
    messages: [],
    hasSlug: false,
    slugValue: null,
    hasToolUse: false,
    agentId: null,
    sessionId: null,
    isSidechain: null,
    model: null,
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

      // Check for slug
      if (msg.slug) {
        fileAnalysis.hasSlug = true;
        fileAnalysis.slugValue = msg.slug;
      }

      // Check for tool_use
      if (msg.message?.content && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            fileAnalysis.hasToolUse = true;
          }
        }
      }

      // Analyze message structure
      const msgAnalysis = {
        lineNumber: i + 1,
        type: msg.type,
        subtype: msg.subtype,
        role: msg.message?.role,
        contentTypes: [],
        hasSlug: !!msg.slug,
        isSidechain: msg.isSidechain,
        isMeta: msg.isMeta,
        toolName: null,
        toolUseId: msg.tool_use_id,
        parentToolUseId: msg.parent_tool_use_id,
      };

      // Analyze content blocks
      if (msg.message?.content && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          msgAnalysis.contentTypes.push(block.type);
          if (block.type === 'tool_use') {
            msgAnalysis.toolName = block.name;
          }
        }
      }

      fileAnalysis.messages.push(msgAnalysis);

      // Track schemas
      extractFieldValues(msg, schemas.fieldExamples);

      if (!isAgentFile) {
        // Main session tracking
        const typeKey = msg.type || 'unknown';
        if (!schemas.mainSession.byType.has(typeKey)) {
          schemas.mainSession.byType.set(typeKey, new Set());
        }
        schemas.mainSession.byType.get(typeKey).add(getSchemaSignature(msg));

        if (msg.subtype) {
          const subtypeKey = `${typeKey}:${msg.subtype}`;
          if (!schemas.mainSession.bySubtype.has(subtypeKey)) {
            schemas.mainSession.bySubtype.set(subtypeKey, new Set());
          }
          schemas.mainSession.bySubtype.get(subtypeKey).add(getSchemaSignature(msg));
        }
      }

    } catch (e) {
      console.error(`Error parsing line ${i + 1} in ${filePath}: ${e.message}`);
    }
  }

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

    const analysis = analyzeFile(filePath, isAgentFile);

    if (isAgentFile) {
      agentSessions.push(analysis);
    } else {
      mainSessions.push(analysis);
    }
  }

  return { mainSessions, agentSessions };
}

// Generate report
function generateReport(analysis) {
  const { mainSessions, agentSessions } = analysis;

  console.log('\n' + '='.repeat(80));
  console.log('CLAUDE CLI JSONL SCHEMA ANALYSIS REPORT');
  console.log('='.repeat(80));

  // Main Sessions
  console.log('\n## MAIN SESSIONS\n');
  for (const session of mainSessions) {
    console.log(`### ${session.fileName}`);
    console.log(`   Lines: ${session.lineCount}`);
    console.log(`   SessionId: ${session.sessionId}`);

    // Group messages by type
    const byType = {};
    for (const msg of session.messages) {
      const key = `${msg.type}${msg.subtype ? ':' + msg.subtype : ''}`;
      if (!byType[key]) byType[key] = [];
      byType[key].push(msg);
    }

    console.log('   Message Types:');
    for (const [type, msgs] of Object.entries(byType)) {
      console.log(`     - ${type}: ${msgs.length} messages`);

      // Show content type patterns
      const contentPatterns = new Set();
      for (const msg of msgs) {
        if (msg.contentTypes.length > 0) {
          contentPatterns.add(msg.contentTypes.join(', '));
        }
      }
      if (contentPatterns.size > 0) {
        console.log(`       Content patterns: ${[...contentPatterns].join(' | ')}`);
      }

      // Show tool names for assistant messages
      const toolNames = new Set();
      for (const msg of msgs) {
        if (msg.toolName) toolNames.add(msg.toolName);
      }
      if (toolNames.size > 0) {
        console.log(`       Tools used: ${[...toolNames].join(', ')}`);
      }
    }
    console.log('');
  }

  // Agent Sessions
  console.log('\n## AGENT SESSIONS\n');

  // Classification summary
  const withSlug = agentSessions.filter(a => a.hasSlug);
  const withoutSlugWithToolUse = agentSessions.filter(a => !a.hasSlug && a.hasToolUse);
  const withoutSlugNoToolUse = agentSessions.filter(a => !a.hasSlug && !a.hasToolUse);

  console.log('### Classification Summary:');
  console.log(`   - With slug (SUMMARY agents): ${withSlug.length}`);
  console.log(`   - Without slug + has tool_use (EXECUTION agents): ${withoutSlugWithToolUse.length}`);
  console.log(`   - Without slug + no tool_use (WARMUP agents): ${withoutSlugNoToolUse.length}`);
  console.log('');

  // Detailed agent info
  console.log('### Agent Details:\n');
  for (const agent of agentSessions) {
    const classification = agent.hasSlug
      ? 'SUMMARY'
      : (agent.hasToolUse ? 'EXECUTION' : 'WARMUP');

    console.log(`#### ${agent.fileName} [${classification}]`);
    console.log(`   AgentId: ${agent.agentId}`);
    console.log(`   SessionId: ${agent.sessionId}`);
    console.log(`   Model: ${agent.model}`);
    console.log(`   isSidechain: ${agent.isSidechain}`);
    console.log(`   Lines: ${agent.lineCount}`);
    console.log(`   Has slug: ${agent.hasSlug}${agent.slugValue ? ` (${agent.slugValue})` : ''}`);
    console.log(`   Has tool_use: ${agent.hasToolUse}`);

    // Show message breakdown
    const byType = {};
    for (const msg of agent.messages) {
      const key = `${msg.type}${msg.subtype ? ':' + msg.subtype : ''}`;
      if (!byType[key]) byType[key] = [];
      byType[key].push(msg);
    }

    console.log('   Messages:');
    for (const [type, msgs] of Object.entries(byType)) {
      const contentInfo = msgs
        .filter(m => m.contentTypes.length > 0)
        .map(m => m.contentTypes.join(','))
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 3);

      console.log(`     - ${type}: ${msgs.length}${contentInfo.length > 0 ? ` [${contentInfo.join(' | ')}]` : ''}`);
    }
    console.log('');
  }

  // Field value examples
  console.log('\n## FIELD VALUE EXAMPLES\n');
  for (const [field, values] of schemas.fieldExamples) {
    console.log(`### ${field}`);
    console.log(`   Values: ${[...values].join(', ')}`);
  }

  // Schema patterns for main session
  console.log('\n## SCHEMA PATTERNS (Main Session)\n');
  for (const [type, signatures] of schemas.mainSession.byType) {
    console.log(`### Type: ${type}`);
    console.log(`   Unique schemas: ${signatures.size}`);
    // Show first schema as example
    const firstSchema = [...signatures][0];
    if (firstSchema) {
      const fields = firstSchema.split('|').slice(0, 15);
      console.log(`   Sample fields: ${fields.join(', ')}${fields.length < firstSchema.split('|').length ? '...' : ''}`);
    }
  }
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
