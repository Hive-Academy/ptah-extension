// Template Conversion Script for remaining agent and command templates
// This script reads source .md files and converts them to .template.md format

const fs = require('fs');
const path = require('path');

// Template configurations for each agent/command
const templates = [
  // Agents (remaining 8)
  {
    source: '.claude/agents/software-architect.md',
    target:
      'libs/backend/agent-generation/templates/agents/software-architect.template.md',
    templateId: 'software-architect-v2',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 70,
  },
  {
    source: '.claude/agents/team-leader.md',
    target:
      'libs/backend/agent-generation/templates/agents/team-leader.template.md',
    templateId: 'team-leader-v2',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 80,
  },
  {
    source: '.claude/agents/senior-tester.md',
    target:
      'libs/backend/agent-generation/templates/agents/senior-tester.template.md',
    templateId: 'senior-tester-v2',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 70,
  },
  {
    source: '.claude/agents/code-logic-reviewer.md',
    target:
      'libs/backend/agent-generation/templates/agents/code-logic-reviewer.template.md',
    templateId: 'code-logic-reviewer-v2',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 65,
  },
  {
    source: '.claude/agents/code-style-reviewer.md',
    target:
      'libs/backend/agent-generation/templates/agents/code-style-reviewer.template.md',
    templateId: 'code-style-reviewer-v2',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 65,
  },
  {
    source: '.claude/agents/researcher-expert.md',
    target:
      'libs/backend/agent-generation/templates/agents/researcher-expert.template.md',
    templateId: 'researcher-expert-v2',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 70,
  },
  {
    source: '.claude/agents/modernization-detector.md',
    target:
      'libs/backend/agent-generation/templates/agents/modernization-detector.template.md',
    templateId: 'modernization-detector-v2',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 60,
  },
  {
    source: '.claude/agents/ui-ux-designer.md',
    target:
      'libs/backend/agent-generation/templates/agents/ui-ux-designer.template.md',
    templateId: 'ui-ux-designer-v2',
    projectTypes: ['React', 'Angular', 'Vue', 'Svelte', 'Node'],
    alwaysInclude: false,
    minScore: 75,
    techStack: [
      'React',
      'Angular',
      'Vue',
      'Svelte',
      'TypeScript',
      'JavaScript',
      'Design Systems',
    ],
  },
  // Commands (5)
  {
    source: '.claude/commands/orchestrate.md',
    target:
      'libs/backend/agent-generation/templates/commands/orchestrate.template.md',
    templateId: 'orchestrate-command-v1',
    projectTypes: ['ALL'],
    alwaysInclude: true,
    minScore: 100,
  },
  {
    source: '.claude/commands/orchestrate-help.md',
    target:
      'libs/backend/agent-generation/templates/commands/orchestrate-help.template.md',
    templateId: 'orchestrate-help-command-v1',
    projectTypes: ['ALL'],
    alwaysInclude: true,
    minScore: 100,
  },
  {
    source: '.claude/commands/review-code.md',
    target:
      'libs/backend/agent-generation/templates/commands/review-code.template.md',
    templateId: 'review-code-command-v1',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 70,
  },
  {
    source: '.claude/commands/review-logic.md',
    target:
      'libs/backend/agent-generation/templates/commands/review-logic.template.md',
    templateId: 'review-logic-command-v1',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 70,
  },
  {
    source: '.claude/commands/review-security.md',
    target:
      'libs/backend/agent-generation/templates/commands/review-security.template.md',
    templateId: 'review-security-command-v1',
    projectTypes: ['ALL'],
    alwaysInclude: false,
    minScore: 70,
  },
];

function extractOriginalFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (match) {
    const lines = match[1].split('\n');
    const result = {};
    lines.forEach((line) => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length) {
        result[key.trim()] = valueParts.join(':').trim();
      }
    });
    return result;
  }
  return {};
}

function createTemplateFrontmatter(config, original) {
  const techStackStr = config.techStack
    ? `\n  techStack: [${config.techStack.join(', ')}]`
    : '';

  return `---
templateId: ${config.templateId}
templateVersion: 2.0.0
applicabilityRules:
  projectTypes: [${config.projectTypes.join(', ')}]
  minimumRelevanceScore: ${config.minScore}
  alwaysInclude: ${config.alwaysInclude}${techStackStr}
dependencies: []
---

---

name: ${original.name || config.templateId.replace(/-v\d+$/, '')}
description: ${original.description || 'Generated template'}
generated: true
sourceTemplate: ${config.templateId}
sourceTemplateVersion: 2.0.0
generatedAt: {{TIMESTAMP}}
projectType: {{PROJECT_TYPE}}

---`;
}

function wrapFilePathWarning(content) {
  const pathWarningMatch = content.match(
    /##\s*\*\*IMPORTANT\*\*:.*?file modification bug.*?\n/s
  );
  if (pathWarningMatch) {
    return `<!-- STATIC:FILE_PATH_WARNING -->\n\n${pathWarningMatch[0].trim()}\n\n<!-- /STATIC:FILE_PATH_WARNING -->`;
  }
  return '';
}

function wrapMainContent(content) {
  // Remove original frontmatter
  content = content.replace(/^---\n[\s\S]*?\n---\n\n/, '');

  // Extract and wrap file path warning
  const pathWarning = wrapFilePathWarning(content);
  content = content.replace(
    /##\s*\*\*IMPORTANT\*\*:.*?file modification bug.*?\n\n?/s,
    ''
  );

  // Wrap remaining content as STATIC (simplified approach - all content static by default)
  const wrapped = `${pathWarning}\n\n<!-- STATIC:MAIN_CONTENT -->\n\n${content.trim()}\n\n<!-- /STATIC:MAIN_CONTENT -->`;

  return wrapped;
}

function convertTemplate(config) {
  const sourcePath = path.join(__dirname, config.source);
  const targetPath = path.join(__dirname, config.target);

  console.log(`Converting: ${config.source} → ${config.target}`);

  // Read source
  const sourceContent = fs.readFileSync(sourcePath, 'utf-8');

  // Extract original frontmatter
  const originalFrontmatter = extractOriginalFrontmatter(sourceContent);

  // Create new frontmatter
  const newFrontmatter = createTemplateFrontmatter(config, originalFrontmatter);

  // Wrap main content
  const wrappedContent = wrapMainContent(sourceContent);

  // Combine
  const templateContent = `${newFrontmatter}\n\n${wrappedContent}\n`;

  // Ensure target directory exists
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Write template
  fs.writeFileSync(targetPath, templateContent, 'utf-8');

  console.log(`✅ Created: ${config.target} (${templateContent.length} bytes)`);
}

// Main execution
console.log('🚀 Starting template conversion...\n');

let successCount = 0;
let errorCount = 0;

templates.forEach((config, index) => {
  try {
    convertTemplate(config);
    successCount++;
  } catch (error) {
    console.error(`❌ Error converting ${config.source}:`, error.message);
    errorCount++;
  }
});

console.log(`\n✨ Conversion complete!`);
console.log(`✅ Success: ${successCount}/${templates.length}`);
if (errorCount > 0) {
  console.log(`❌ Errors: ${errorCount}`);
}
