/**
 * Guards on the core prompt string and its shared substitution section.
 *
 * The core is paid for on every request that assembles it, and a prompt has no
 * compiler: the only thing that stops it growing back is a measurement that
 * fails. See `.ptah/specs/TASK_PROMPT_EFFICIENCY/audit.md`.
 */
import {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
  PTAH_MCP_SUBSTITUTION_SECTION,
} from './ptah-core-prompt';

describe('PTAH_CORE_SYSTEM_PROMPT', () => {
  it('stays within the measured token budget plus five percent', () => {
    expect(PTAH_CORE_SYSTEM_PROMPT_TOKENS).toBeLessThanOrEqual(3380);
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

  it('keeps CLI delegation and routing guidance', () => {
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(
      '| CLI lane | A fresh agent can complete a written brief:',
    );
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(
      'When 2+ independent subtasks exist, prefer running at least one as a CLI lane in parallel.',
    );
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(
      'When a `Routing:` system reminder is present, follow its taskType, depth and executor suggestions unless the user says otherwise.',
    );
    expect(PTAH_CORE_SYSTEM_PROMPT).not.toContain('ptah_route_decide');
  });

  it('states the token-economy rules', () => {
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain('### Token economy');
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(
      "workspace's CLAUDE.md or project instructions",
    );
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain('Never a wait/status loop');
  });

  it('defers verification and commit authorization without command contradictions', () => {
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(
      "workspace's CLAUDE.md or project instructions",
    );
    expect(PTAH_CORE_SYSTEM_PROMPT).toContain(
      "workspace's own instructions (CLAUDE.md, project rules)",
    );
    expect(PTAH_CORE_SYSTEM_PROMPT).not.toContain('nx test');
    expect(PTAH_CORE_SYSTEM_PROMPT).not.toContain('nx affected');
    expect(PTAH_CORE_SYSTEM_PROMPT).not.toContain(
      'Only commit when explicitly asked',
    );
  });
});
