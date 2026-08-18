/**
 * Workspace agent transformers (decision #4) — ported from the deleted
 * `multi-cli-agent-writer.workspace.spec.ts` (agent-generation) onto the new
 * `IHarnessAgentTransformer` API: `transform({agentId, content})` returns the
 * rendered string directly (no filesystem write, no workspace root), and
 * `relPathFor(agentId)` answers the workspace-relative path a target would
 * write it to.
 *
 * Every assertion's intent survives the port: rel paths, bare names (no
 * `ptah-` prefix), Codex TOML `name`/`description`/`developer_instructions`,
 * the YAML-quoted-description unquoting case, and the reviewer read-only
 * sandbox case.
 */

import { CodexAgentTransformer } from './codex-agent-transformer';
import { CopilotAgentTransformer } from './copilot-agent-transformer';
import { CursorAgentTransformer } from './cursor-agent-transformer';
import type { HarnessAgentSource } from './agent-transformer.port';

function agentSource(id: string, body = 'Agent body'): HarnessAgentSource {
  return {
    agentId: id,
    content: `---\nname: ${id}\ndescription: ${id} agent\n---\n${body}`,
  };
}

describe('Workspace agent transformers (decision #4)', () => {
  it('Cursor agents target .cursor/agents/{slug}.md (bare-name)', () => {
    const transformer = new CursorAgentTransformer();
    expect(transformer.relPathFor('backend-developer')).toBe(
      '.cursor/agents/backend-developer.md',
    );
    expect(transformer.relPathFor('backend-developer')).not.toContain('ptah-');
  });

  it('Copilot agent targets .github/agents/{slug}.agent.md', () => {
    const transformer = new CopilotAgentTransformer();
    expect(transformer.relPathFor('senior-tester')).toBe(
      '.github/agents/senior-tester.agent.md',
    );
  });

  it('Codex subagent transform targets .codex/agents/{slug}.toml', () => {
    const transformer = new CodexAgentTransformer();
    expect(transformer.relPathFor('x')).toBe('.codex/agents/x.toml');
  });

  it('Codex subagent TOML carries name/description and the body as developer_instructions', () => {
    const result = new CodexAgentTransformer().transform(
      agentSource('backend-developer', 'Implement the feature.'),
    );
    expect(result).toContain('name = "backend-developer"');
    expect(result).toContain('description = "backend-developer agent"');
    expect(result).toContain('developer_instructions = """');
    expect(result).toContain('Implement the feature.');
    // Body only — no leftover YAML frontmatter delimiters.
    expect(result).not.toContain('\n---\n');
  });

  it('Codex TOML unquotes a YAML-quoted frontmatter description (no leaked ")', () => {
    // Mirrors the real orchestrator-emitted source: double-quoted YAML scalar.
    const source: HarnessAgentSource = {
      agentId: 'backend-developer',
      content:
        '---\nname: backend-developer\ndescription: "Backend developer for Ptah\'s Nx monorepo: NestJS"\nmodel: opus\n---\n\nImplement the feature.',
    };

    const result = new CodexAgentTransformer().transform(source);
    expect(result).toContain(
      'description = "Backend developer for Ptah\'s Nx monorepo: NestJS"',
    );
    // The bug this guards: surrounding quotes leaking as escaped `\"...\"`.
    expect(result).not.toContain('description = "\\"');
  });

  it('Codex reviewer agents run in the read-only sandbox', () => {
    const reviewer = new CodexAgentTransformer().transform(
      agentSource('code-logic-reviewer'),
    );
    expect(reviewer).toContain('sandbox_mode = "read-only"');

    const worker = new CodexAgentTransformer().transform(
      agentSource('backend-developer'),
    );
    expect(worker).not.toContain('sandbox_mode');
  });

  it('agent name is the BARE agentId (no ptah- prefix) for all CLIs', () => {
    const id = 'backend-developer';
    const source = agentSource(id);

    expect(new CursorAgentTransformer().transform(source)).toContain(
      `name: ${id}`,
    );
    expect(new CopilotAgentTransformer().transform(source)).toContain(
      `name: ${id}`,
    );
    expect(new CodexAgentTransformer().transform(source)).toContain(
      `name = "${id}"`,
    );

    for (const transformer of [
      new CursorAgentTransformer(),
      new CopilotAgentTransformer(),
      new CodexAgentTransformer(),
    ]) {
      expect(transformer.transform(source)).not.toContain('ptah-');
    }
  });
});
