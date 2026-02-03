/**
 * Power-Up Registry (TASK_2025_135)
 *
 * Static registry of available power-ups with metadata and content.
 * Power-ups are pre-defined prompt enhancements extracted from
 * existing agent patterns in `.claude/agents/`.
 *
 * Pattern source: libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts
 *
 * Design Decision: Hardcoded in TypeScript (Option A from requirements)
 * Rationale:
 * - Version controlled with extension releases
 * - No file I/O overhead at startup
 * - Type-safe access
 * - Easy to test
 */

import type { PowerUpCategory, PowerUpDefinition } from './types';

/**
 * Registry of all available power-ups
 *
 * To add a new power-up:
 * 1. Add an entry to this array with all required fields
 * 2. No other code changes required - the registry drives all behavior
 */
export const POWER_UP_DEFINITIONS: readonly PowerUpDefinition[] = [
  // ============================================================
  // Investigation Category (extracted from software-architect.md)
  // ============================================================
  {
    id: 'investigation-first',
    name: 'Investigation-First Protocol',
    description:
      'Systematically investigate codebase before proposing solutions',
    category: 'investigation',
    sourceAgent: 'software-architect',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 10,
    tokenCount: 450,
    content: `## Investigation-First Protocol

**Your superpower is INVESTIGATION, not ASSUMPTION.**

Before proposing any implementation, systematically explore the codebase:
- What patterns already exist?
- What libraries are available and how do they work?
- What conventions are established?
- What similar problems have been solved?

**You never hallucinate APIs.** Every decorator, class, interface, and pattern you propose exists in the codebase and is verified through investigation.

### Investigation Methodology
1. **Question Formulation** - Start with specific questions
2. **Evidence Discovery** - Use Glob, Grep, Read to find answers
3. **Pattern Extraction** - Analyze 2-3 examples to extract patterns
4. **Source Verification** - Verify every API exists in codebase
5. **Evidence Citation** - Cite file:line for every decision`,
  },

  {
    id: 'anti-hallucination',
    name: 'Anti-Hallucination Protocol',
    description: 'Verify all APIs exist before using, cite evidence',
    category: 'investigation',
    sourceAgent: 'software-architect',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 15,
    tokenCount: 200,
    content: `## Anti-Hallucination Protocol

**CRITICAL**: Verify every API you propose exists in the codebase:

- [ ] All imports verified in library source
- [ ] All decorators confirmed as exports
- [ ] All classes verified as actual exports
- [ ] All interfaces verified in type definition files

**If you can't grep it, don't propose it.**

When uncertain, investigate more. When you can't find evidence, mark it as an assumption and flag for validation.`,
  },

  // ============================================================
  // Code Quality Category (extracted from code-logic-reviewer.md)
  // ============================================================
  {
    id: 'code-quality-paranoid',
    name: 'Paranoid Code Review',
    description: 'Hunt for failure modes, never assume happy path',
    category: 'code-quality',
    sourceAgent: 'code-logic-reviewer',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 20,
    tokenCount: 350,
    content: `## Paranoid Code Review Protocol

**Your default stance**: This code has bugs. Your job is to find them.

### The 5 Paranoid Questions
For EVERY implementation, explicitly answer these:
1. **How does this fail silently?** (Hidden failures)
2. **What user action causes unexpected behavior?** (UX failures)
3. **What data makes this produce wrong results?** (Data failures)
4. **What happens when dependencies fail?** (Integration failures)
5. **What's missing that the requirements didn't mention?** (Gap analysis)

If you can't find failure modes, **you haven't looked hard enough**.`,
  },

  {
    id: 'solid-principles',
    name: 'SOLID Principles',
    description: 'Apply SOLID, DRY, YAGNI, KISS to implementations',
    category: 'code-quality',
    sourceAgent: 'backend-developer',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 30,
    tokenCount: 400,
    content: `## SOLID Principles (Apply to Every Implementation)

### Single Responsibility
A class/module should have one, and only one, reason to change.

### Open/Closed
Open for extension, closed for modification. But only when variations exist (YAGNI).

### Liskov Substitution
Subtypes must be substitutable for their base types.

### Interface Segregation
Many client-specific interfaces better than one general-purpose interface.

### Dependency Inversion
Depend on abstractions, not concretions.

### Supporting Principles
- **DRY**: Don't Repeat Yourself - but wait for 3rd occurrence (Rule of Three)
- **YAGNI**: You Ain't Gonna Need It - build for current requirements only
- **KISS**: Keep It Simple - complexity must justify itself`,
  },

  // ============================================================
  // Workflow Category (extracted from backend-developer.md)
  // ============================================================
  {
    id: 'escalation-protocol',
    name: 'Escalation Protocol',
    description: 'Escalate when task differs from plan, never deviate silently',
    category: 'workflow',
    sourceAgent: 'backend-developer',
    isPremium: false,
    version: '1.0.0',
    defaultPriority: 25,
    tokenCount: 300,
    content: `## Mandatory Escalation Protocol

**CRITICAL**: You are NOT authorized to make architectural decisions silently.

### Escalation Trigger Conditions (STOP and Report If ANY Apply)
- Task seems too complex to implement as specified
- You find a "simpler" or "better" approach than what's planned
- Technology/API doesn't work as expected
- Implementation reveals missing requirements
- You want to skip, defer, or simplify a planned task

### What You MUST Do When Triggered
1. **STOP implementation immediately**
2. **Document the issue clearly** with options (NOT decisions)
3. **Return to user** with escalation before proceeding`,
  },

  // ============================================================
  // Premium MCP Category
  // ============================================================
  {
    id: 'mcp-cost-optimization',
    name: 'MCP Cost Optimization',
    description: 'Use invokeAgent for routine tasks with cheaper models',
    category: 'mcp',
    sourceAgent: 'premium',
    isPremium: true,
    version: '1.0.0',
    defaultPriority: 40,
    tokenCount: 150,
    content: `## Cost Optimization Tips (MCP Server)

**Delegate routine work to cheaper models** (150x cost savings):
- Use \`ptah.ai.invokeAgent(agentPath, task, 'gpt-4o-mini')\` for:
  - Code review
  - Documentation generation
  - Test writing
  - Boilerplate generation

Example: \`ptah.ai.invokeAgent('.claude/agents/code-reviewer.md', 'Review this function', 'gpt-4o-mini')\``,
  },

  {
    id: 'mcp-token-intelligence',
    name: 'MCP Token Intelligence',
    description: 'Check token counts before reading large files',
    category: 'mcp',
    sourceAgent: 'premium',
    isPremium: true,
    version: '1.0.0',
    defaultPriority: 45,
    tokenCount: 100,
    content: `## Token Intelligence (MCP Server)

**Before reading large files or generating content:**
- \`ptah.ai.countFileTokens(file)\` - Check file size before reading
- \`ptah.ai.fitsInContext(content, model, reserve)\` - Verify context capacity

Default reserve: 4000 tokens for user query. Plan ahead to avoid context overflow.`,
  },

  {
    id: 'mcp-ide-powers',
    name: 'MCP IDE Powers',
    description: 'Use LSP references, organize imports, IDE actions',
    category: 'mcp',
    sourceAgent: 'premium',
    isPremium: true,
    version: '1.0.0',
    defaultPriority: 50,
    tokenCount: 150,
    content: `## IDE Powers (MCP Server)

**Use VS Code's LSP capabilities:**
- \`ptah.ai.ide.lsp.getReferences(file, line, col)\` - Find all usages before refactoring
- \`ptah.ai.ide.actions.organizeImports(file)\` - Clean up imports
- \`ptah.ai.ide.editor.getDirtyFiles()\` - Check for unsaved changes

**Pro tip**: Always use \`getReferences()\` before renaming or deleting to find all usages.`,
  },
] as const satisfies readonly PowerUpDefinition[];

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get a power-up definition by ID
 *
 * @param id - Power-up ID to look up
 * @returns Power-up definition, or undefined if not found
 */
export function getPowerUp(id: string): PowerUpDefinition | undefined {
  return POWER_UP_DEFINITIONS.find((p) => p.id === id);
}

/**
 * Get all power-ups in a specific category
 *
 * @param category - Category to filter by
 * @returns Array of power-up definitions in that category
 */
export function getPowerUpsByCategory(
  category: PowerUpCategory
): PowerUpDefinition[] {
  return POWER_UP_DEFINITIONS.filter((p) => p.category === category);
}

/**
 * Get all free (non-premium) power-ups
 *
 * @returns Array of free power-up definitions
 */
export function getFreePowerUps(): PowerUpDefinition[] {
  return POWER_UP_DEFINITIONS.filter((p) => !p.isPremium);
}

/**
 * Get all premium power-ups
 *
 * @returns Array of premium power-up definitions
 */
export function getPremiumPowerUps(): PowerUpDefinition[] {
  return POWER_UP_DEFINITIONS.filter((p) => p.isPremium);
}

/**
 * Get all available power-up categories
 *
 * @returns Array of unique category names
 */
export function getPowerUpCategories(): PowerUpCategory[] {
  const categories = new Set<PowerUpCategory>();
  for (const powerUp of POWER_UP_DEFINITIONS) {
    categories.add(powerUp.category);
  }
  return Array.from(categories);
}

/**
 * Calculate total token count for a list of power-up IDs
 *
 * @param powerUpIds - Array of power-up IDs
 * @returns Total token count
 */
export function calculateTotalTokens(powerUpIds: string[]): number {
  let total = 0;
  for (const id of powerUpIds) {
    const powerUp = getPowerUp(id);
    if (powerUp) {
      total += powerUp.tokenCount;
    }
  }
  return total;
}
