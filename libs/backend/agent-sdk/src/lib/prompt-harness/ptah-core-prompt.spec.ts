/**
 * Guards on the two prompt strings this file ships.
 *
 * Both are paid for on every request of every session that assembles them, and
 * a prompt has no compiler: the only thing that stops it growing back is a
 * measurement that fails. See `.ptah/specs/TASK_PROMPT_EFFICIENCY/audit.md`.
 */
import {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
  PTAH_MCP_MANDATE_PROMPT,
  PTAH_MCP_SUBSTITUTION_SECTION,
} from './ptah-core-prompt';

describe('PTAH_CORE_SYSTEM_PROMPT', () => {
  it('stays within the ~4,000-token budget its header declares', () => {
    expect(PTAH_CORE_SYSTEM_PROMPT_TOKENS).toBeLessThanOrEqual(4000);
  });

  it('carries the MCP substitution section exactly once', () => {
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(PTAH_MCP_SUBSTITUTION_SECTION);
    expect(
      PTAH_CORE_SYSTEM_PROMPT.split('| Instead of... | CALL THIS TOOL | Why |'),
    ).toHaveLength(2);
  });

  it('keeps the efficiency rules that were already in place', () => {
    // Each of these is load-bearing per audit §4 — a trim must not drop them.
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain('ptah_ast_analyze');
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(
      'call once after edits, not on every step',
    );
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(
      'at most one AskUserQuestion call per task',
    );
  });

  it('teaches the push signal instead of a polling loop', () => {
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain('<agent-lane-completed>');
    expect(PTAH_CORE_SYSTEM_PROMPT).not.toContain('poll until complete');
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain('Never call it in a loop');
  });

  it('states the token-economy rules', () => {
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain('### Token economy');
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(
      'Verify only the projects you changed',
    );
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain('Never a wait/status loop');
  });
});

describe('PTAH_MCP_MANDATE_PROMPT', () => {
  it('reuses the one substitution section rather than a second copy', () => {
    expect(PTAH_MCP_MANDATE_PROMPT).toContain(PTAH_MCP_SUBSTITUTION_SECTION);
    expect(
      PTAH_MCP_MANDATE_PROMPT.split('| Instead of... | CALL THIS TOOL | Why |'),
    ).toHaveLength(2);
  });

  it('teaches the same non-polling delegation pattern', () => {
    expect(PTAH_MCP_MANDATE_PROMPT).toContain('<agent-lane-completed>');
    expect(PTAH_MCP_MANDATE_PROMPT).toContain('Never call it in a loop');
  });
});
