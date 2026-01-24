#!/usr/bin/env node
/**
 * Validation Script for Orchestration Skill
 *
 * Validates the orchestration skill's markdown files for:
 * 1. Markdown syntax (all files parseable)
 * 2. Internal references (all links point to existing files)
 * 3. Content completeness (all 6 strategies, all 13 agents documented)
 * 4. Consistency (invocation patterns match agent-catalog)
 *
 * Run: node scripts/validate-orchestration-skill.js
 * Exit codes: 0 = success, 1 = validation failures found
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

// Required strategies that must be documented
const REQUIRED_STRATEGIES = [
  'FEATURE',
  'BUGFIX',
  'REFACTORING',
  'DOCUMENTATION',
  'RESEARCH',
  'DEVOPS',
];

// Required agents that must be documented (all 13)
const REQUIRED_AGENTS = [
  'project-manager',
  'software-architect',
  'team-leader',
  'backend-developer',
  'frontend-developer',
  'devops-engineer',
  'senior-tester',
  'code-style-reviewer',
  'code-logic-reviewer',
  'researcher-expert',
  'modernization-detector',
  'ui-ux-designer',
  'technical-content-writer',
];

// Skill directory paths
const SKILL_ROOT = path.join(
  process.cwd(),
  '.claude',
  'skills',
  'orchestration'
);
const AGENTS_DIR = path.join(process.cwd(), '.claude', 'agents');
const REFERENCES_DIR = path.join(SKILL_ROOT, 'references');

/**
 * Logs a colored message to console
 */
function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Logs an error with formatting
 */
function logError(error) {
  const lineInfo = error.line ? `:${error.line}` : '';
  console.log(
    `  ${colors.red}[${error.type.toUpperCase()}]${colors.reset} ${
      error.file
    }${lineInfo}`
  );
  console.log(`    ${colors.yellow}Message:${colors.reset} ${error.message}`);
  console.log(
    `    ${colors.cyan}Suggestion:${colors.reset} ${error.suggestion}`
  );
}

/**
 * Logs a warning with formatting
 */
function logWarning(error) {
  const lineInfo = error.line ? `:${error.line}` : '';
  console.log(
    `  ${colors.yellow}[WARNING]${colors.reset} ${error.file}${lineInfo}`
  );
  console.log(`    ${colors.yellow}Message:${colors.reset} ${error.message}`);
  console.log(
    `    ${colors.cyan}Suggestion:${colors.reset} ${error.suggestion}`
  );
}

/**
 * Gets all markdown files in the skill directory recursively
 */
function getSkillMarkdownFiles() {
  const files = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  scanDir(SKILL_ROOT);
  return files;
}

/**
 * Validates markdown syntax by checking for common issues
 */
function validateMarkdownSyntax(filePath, content) {
  const errors = [];
  const lines = content.split('\n');

  // Check for unclosed code blocks
  let codeBlockCount = 0;
  let lastCodeBlockLine = 0;

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      codeBlockCount++;
      lastCodeBlockLine = index + 1;
    }
  });

  if (codeBlockCount % 2 !== 0) {
    errors.push({
      file: path.relative(process.cwd(), filePath),
      type: 'syntax',
      message: 'Unclosed code block detected',
      suggestion: `Check code block near line ${lastCodeBlockLine} - ensure it has a closing \`\`\``,
      line: lastCodeBlockLine,
    });
  }

  // Check for broken heading syntax
  lines.forEach((line, index) => {
    // Headings should have space after #
    if (/^#{1,6}[^#\s]/.test(line)) {
      errors.push({
        file: path.relative(process.cwd(), filePath),
        type: 'syntax',
        message: 'Heading missing space after # symbols',
        suggestion: 'Add a space between # symbols and heading text',
        line: index + 1,
      });
    }
  });

  // Check for empty file
  if (content.trim().length === 0) {
    errors.push({
      file: path.relative(process.cwd(), filePath),
      type: 'syntax',
      message: 'File is empty',
      suggestion: 'Add content to the file or remove it if not needed',
    });
  }

  return errors;
}

/**
 * Extracts markdown links from content
 */
function extractMarkdownLinks(content) {
  const links = [];
  const lines = content.split('\n');

  // Match [text](link) pattern, excluding external URLs
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  lines.forEach((line, index) => {
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      const link = match[2];
      // Skip external URLs and anchors
      if (
        !link.startsWith('http://') &&
        !link.startsWith('https://') &&
        !link.startsWith('#')
      ) {
        links.push({ link, line: index + 1 });
      }
    }
  });

  return links;
}

/**
 * Validates internal references point to existing files
 */
function validateInternalReferences(filePath, content) {
  const errors = [];
  const links = extractMarkdownLinks(content);
  const fileDir = path.dirname(filePath);

  for (const { link, line } of links) {
    // Remove anchor from link
    const linkPath = link.split('#')[0];
    if (!linkPath) continue;

    // Resolve the path relative to the current file
    const resolvedPath = path.resolve(fileDir, linkPath);

    if (!fs.existsSync(resolvedPath)) {
      errors.push({
        file: path.relative(process.cwd(), filePath),
        type: 'reference',
        message: `Broken link: "${link}" - file does not exist`,
        suggestion: `Check if the file path is correct. Expected: ${path.relative(
          process.cwd(),
          resolvedPath
        )}`,
        line,
      });
    }
  }

  return errors;
}

/**
 * Validates all required strategies are documented
 */
function validateStrategiesDocumented(strategiesFile, content) {
  const errors = [];

  for (const strategy of REQUIRED_STRATEGIES) {
    // Look for strategy heading (## STRATEGY_NAME)
    const headingPattern = new RegExp(`##\\s+${strategy}`, 'i');
    if (!headingPattern.test(content)) {
      errors.push({
        file: path.relative(process.cwd(), strategiesFile),
        type: 'content',
        message: `Missing strategy documentation: ${strategy}`,
        suggestion: `Add a section "## ${strategy}" with workflow details`,
      });
    }
  }

  return errors;
}

/**
 * Validates all required agents are documented in agent-catalog
 */
function validateAgentsDocumented(catalogFile, content) {
  const errors = [];

  for (const agent of REQUIRED_AGENTS) {
    // Look for agent heading (### agent-name)
    const headingPattern = new RegExp(
      `###\\s+${agent.replace(/-/g, '[- ]?')}`,
      'i'
    );
    if (!headingPattern.test(content)) {
      errors.push({
        file: path.relative(process.cwd(), catalogFile),
        type: 'content',
        message: `Missing agent documentation: ${agent}`,
        suggestion: `Add a section "### ${agent}" with role, triggers, inputs, outputs, dependencies, invocation example`,
      });
    }
  }

  return errors;
}

/**
 * Validates agent files exist in .claude/agents/
 */
function validateAgentFilesExist() {
  const errors = [];

  for (const agent of REQUIRED_AGENTS) {
    const agentFile = path.join(AGENTS_DIR, `${agent}.md`);

    if (!fs.existsSync(agentFile)) {
      errors.push({
        file: `.claude/agents/${agent}.md`,
        type: 'content',
        message: `Agent file missing: ${agent}.md`,
        suggestion: `Create agent file at .claude/agents/${agent}.md`,
      });
    }
  }

  return errors;
}

/**
 * Validates SKILL.md has required sections
 */
function validateSkillStructure(skillFile, content) {
  const errors = [];

  const requiredSections = [
    { pattern: /##\s+Quick Start/i, name: 'Quick Start' },
    { pattern: /##\s+Your Role/i, name: 'Your Role' },
    { pattern: /##\s+Workflow Selection/i, name: 'Workflow Selection Matrix' },
    {
      pattern: /##\s+Core Orchestration Loop/i,
      name: 'Core Orchestration Loop',
    },
    { pattern: /##\s+Validation Checkpoints/i, name: 'Validation Checkpoints' },
    {
      pattern: /##\s+Team-Leader Integration/i,
      name: 'Team-Leader Integration',
    },
    { pattern: /##\s+Reference Index/i, name: 'Reference Index' },
  ];

  for (const section of requiredSections) {
    if (!section.pattern.test(content)) {
      errors.push({
        file: path.relative(process.cwd(), skillFile),
        type: 'content',
        message: `Missing required section: ${section.name}`,
        suggestion: `Add section "## ${section.name}" to SKILL.md`,
      });
    }
  }

  return errors;
}

/**
 * Validates invocation patterns in agent-catalog match actual agent names
 */
function validateInvocationPatterns(catalogFile, content) {
  const errors = [];

  // Extract subagent_type values from code blocks
  const subagentPattern = /subagent_type:\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = subagentPattern.exec(content)) !== null) {
    const agentName = match[1];

    if (!REQUIRED_AGENTS.includes(agentName)) {
      errors.push({
        file: path.relative(process.cwd(), catalogFile),
        type: 'consistency',
        message: `Unknown agent in invocation pattern: "${agentName}"`,
        suggestion: `Check if agent name is correct. Valid agents: ${REQUIRED_AGENTS.join(
          ', '
        )}`,
      });
    }
  }

  return errors;
}

/**
 * Validates reference files exist
 */
function validateReferenceFilesExist() {
  const errors = [];

  const requiredReferences = [
    'strategies.md',
    'agent-catalog.md',
    'team-leader-modes.md',
    'task-tracking.md',
    'checkpoints.md',
    'git-standards.md',
  ];

  for (const refFile of requiredReferences) {
    const refPath = path.join(REFERENCES_DIR, refFile);

    if (!fs.existsSync(refPath)) {
      errors.push({
        file: `references/${refFile}`,
        type: 'content',
        message: `Required reference file missing: ${refFile}`,
        suggestion: `Create reference file at .claude/skills/orchestration/references/${refFile}`,
      });
    }
  }

  return errors;
}

/**
 * Validates SKILL.md line count is under target
 */
function validateSkillLineCount(skillFile, content) {
  const warnings = [];
  const lineCount = content.split('\n').length;
  const TARGET_LINES = 300;

  if (lineCount > TARGET_LINES) {
    warnings.push({
      file: path.relative(process.cwd(), skillFile),
      type: 'content',
      message: `SKILL.md is ${lineCount} lines (target: <${TARGET_LINES})`,
      suggestion: 'Consider moving detailed content to reference files',
    });
  }

  return warnings;
}

/**
 * Main validation function
 */
function validateOrchestrationSkill() {
  const result = {
    errors: [],
    warnings: [],
    filesChecked: 0,
    passed: true,
  };

  log('bold', '\n========================================');
  log('bold', '  Orchestration Skill Validation');
  log('bold', '========================================\n');

  // Check skill directory exists
  if (!fs.existsSync(SKILL_ROOT)) {
    result.errors.push({
      file: SKILL_ROOT,
      type: 'content',
      message: 'Skill directory does not exist',
      suggestion:
        'Create .claude/skills/orchestration/ directory with SKILL.md',
    });
    result.passed = false;
    return result;
  }

  // Get all markdown files
  const files = getSkillMarkdownFiles();
  result.filesChecked = files.length;

  log('cyan', `Found ${files.length} markdown files to validate\n`);

  // Validate each file
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    // Syntax validation
    const syntaxErrors = validateMarkdownSyntax(file, content);
    result.errors.push(...syntaxErrors);

    // Reference validation
    const refErrors = validateInternalReferences(file, content);
    result.errors.push(...refErrors);

    // Special validations for specific files
    const fileName = path.basename(file);

    if (fileName === 'SKILL.md') {
      result.errors.push(...validateSkillStructure(file, content));
      result.warnings.push(...validateSkillLineCount(file, content));
    }

    if (fileName === 'strategies.md') {
      result.errors.push(...validateStrategiesDocumented(file, content));
    }

    if (fileName === 'agent-catalog.md') {
      result.errors.push(...validateAgentsDocumented(file, content));
      result.errors.push(...validateInvocationPatterns(file, content));
    }
  }

  // Validate agent files exist
  result.errors.push(...validateAgentFilesExist());

  // Validate reference files exist
  result.errors.push(...validateReferenceFilesExist());

  // Determine pass/fail
  result.passed = result.errors.length === 0;

  return result;
}

/**
 * Prints validation summary and results
 */
function printResults(result) {
  // Print errors
  if (result.errors.length > 0) {
    log(
      'red',
      `\n${colors.bold}ERRORS (${result.errors.length}):${colors.reset}`
    );
    for (const error of result.errors) {
      logError(error);
      console.log('');
    }
  }

  // Print warnings
  if (result.warnings.length > 0) {
    log(
      'yellow',
      `\n${colors.bold}WARNINGS (${result.warnings.length}):${colors.reset}`
    );
    for (const warning of result.warnings) {
      logWarning(warning);
      console.log('');
    }
  }

  // Print summary
  log('bold', '\n========================================');
  log('bold', '  Validation Summary');
  log('bold', '========================================');

  console.log(`  Files checked: ${result.filesChecked}`);
  console.log(`  Errors: ${colors.red}${result.errors.length}${colors.reset}`);
  console.log(
    `  Warnings: ${colors.yellow}${result.warnings.length}${colors.reset}`
  );
  console.log('');

  if (result.passed) {
    log('green', `${colors.bold}  VALIDATION PASSED${colors.reset}`);
  } else {
    log('red', `${colors.bold}  VALIDATION FAILED${colors.reset}`);
  }

  console.log('');
}

// Run validation
const result = validateOrchestrationSkill();
printResults(result);

// Exit with appropriate code
process.exit(result.passed ? 0 : 1);
