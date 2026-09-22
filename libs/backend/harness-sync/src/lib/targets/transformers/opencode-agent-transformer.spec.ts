/**
 * `OpencodeAgentTransformer` — the format opencode v2 actually loads.
 *
 * Every assertion here corresponds to something observed in a live probe of
 * opencode v2.0.12 on 2026-09-22, where probe agents were written into a real
 * project and read back through the running server's `GET /api/agent`:
 *
 * - `.opencode/agent/<id>.md` was scanned (so was `.opencode/agents`, but the
 *   singular spelling is what `opencode agent create` defaults to);
 * - an agent carrying `name`, `source: ptah` and `target-cli` loaded with its
 *   `description` and `mode` intact, so Ptah's ownership signature is safe to
 *   emit;
 * - an agent identical but for `model: opus` DID NOT LOAD AT ALL. That is the
 *   regression the `model` tests below exist to catch: the real
 *   `.claude/agents/*.md` sources carry `model: opus`, so a transformer that
 *   passed frontmatter through would silently publish 15 agents opencode
 *   refuses to read.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { HarnessAgentSource } from './agent-transformer.port';
import { OpencodeAgentTransformer } from './opencode-agent-transformer';

/** The repo's own `backend-developer` agent — a real source, `model: opus` and all. */
function realBackendDeveloperSource(): HarnessAgentSource {
  const path = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    '.claude',
    'agents',
    'backend-developer.md',
  );
  return { agentId: 'backend-developer', content: readFileSync(path, 'utf-8') };
}

function agentSource(id: string, body = 'Agent body'): HarnessAgentSource {
  return {
    agentId: id,
    content: `---\nname: ${id}\ndescription: ${id} agent\nmodel: opus\n---\n${body}`,
  };
}

/** The leading `---`…`---` block of a rendered agent. */
function frontmatterOf(rendered: string): string {
  const match = /^---\n([\s\S]*?)\n---/.exec(rendered);
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

describe('OpencodeAgentTransformer', () => {
  const transformer = new OpencodeAgentTransformer();

  // ------------------------------------------------------------------ paths

  it('targets .opencode/agent/{slug}.md, the directory `opencode agent create` defaults to', () => {
    expect(transformer.relPathFor('backend-developer')).toBe(
      '.opencode/agent/backend-developer.md',
    );
    expect(transformer.dirRel).toBe('.opencode/agent');
  });

  it('uses the BARE agent id, with no `ptah-` prefix', () => {
    expect(transformer.relPathFor('senior-tester')).not.toContain('ptah-');
  });

  // ------------------------------------------------------------ frontmatter

  it('emits `mode: subagent`, which is what makes opencode treat the file as a delegate', () => {
    const rendered = transformer.transform(agentSource('backend-developer'));
    expect(frontmatterOf(rendered)).toContain('mode: subagent');
  });

  it('carries the `source: ptah` ownership signature opencode tolerates as an unknown key', () => {
    const rendered = transformer.transform(agentSource('backend-developer'));
    const frontmatter = frontmatterOf(rendered);
    expect(frontmatter).toContain('source: ptah');
    expect(frontmatter).toContain('target-cli: opencode');
    expect(transformer.isPtahOutput(rendered)).toBe(true);
  });

  it('NEVER emits `model` — an unresolvable tier makes opencode drop the whole agent', () => {
    // The source says `model: opus`. Emitting it is the silent-failure mode.
    const rendered = transformer.transform(agentSource('backend-developer'));
    expect(frontmatterOf(rendered)).not.toMatch(/^model:/m);
    expect(rendered).not.toContain('opus');
  });

  it('quotes the description as a YAML scalar so colons and apostrophes stay valid', () => {
    const rendered = transformer.transform({
      agentId: 'backend-developer',
      content:
        '---\nname: backend-developer\ndescription: "Backend developer for Ptah\'s Nx monorepo: NestJS"\nmodel: opus\n---\n\nImplement the feature.',
    });
    expect(frontmatterOf(rendered)).toContain(
      'description: "Backend developer for Ptah\'s Nx monorepo: NestJS"',
    );
    // The bug this guards: the source's own quotes leaking as escaped `\"`.
    expect(rendered).not.toContain('description: "\\"');
  });

  // -------------------------------------------------------------------- body

  it('keeps exactly one frontmatter block — the source\'s is replaced, not stacked', () => {
    const rendered = transformer.transform(agentSource('backend-developer'));
    expect(rendered.match(/^---$/gm)).toHaveLength(2);
  });

  it('rewrites Claude vocabulary for opencode', () => {
    const rendered = transformer.transform({
      agentId: 'x',
      content:
        '---\nname: x\ndescription: x agent\n---\nUse the Task tool to delegate. Run /orchestrate in Claude Code.\nSee @ptah-extension/shared for types.',
    });
    expect(rendered).toContain('opencode run --agent');
    expect(rendered).toContain('opencode orchestrate');
    expect(rendered).toContain('OpenCode CLI');
    // Internal import lines mean nothing outside this repo.
    expect(rendered).not.toContain('@ptah-extension/');
  });

  // ------------------------------------------------------------- round-trip

  it('round-trips the repo\'s real backend-developer agent into a loadable file', () => {
    const rendered = transformer.transform(realBackendDeveloperSource());
    const frontmatter = frontmatterOf(rendered);

    expect(frontmatter).toContain('mode: subagent');
    expect(frontmatter).toContain('source: ptah');
    // The real source's `model: opus` must not survive into the output.
    expect(frontmatter).not.toMatch(/^model:/m);
    // The real description is a long sentence with em dashes and semicolons;
    // it has to arrive intact and quoted.
    expect(frontmatter).toMatch(
      /^description: "Writes and changes server-side code in this repository/m,
    );
    // Body survived.
    expect(rendered).toContain('# Backend Developer');
    expect(transformer.isPtahOutput(rendered)).toBe(true);
  });

  it('is deterministic, so an unchanged source is a no-op reconcile', () => {
    const source = realBackendDeveloperSource();
    expect(transformer.transform(source)).toBe(transformer.transform(source));
  });

  it('re-transforming its OWN output is idempotent', () => {
    const source = realBackendDeveloperSource();
    const once = transformer.transform(source);
    const twice = transformer.transform({
      agentId: source.agentId,
      content: once,
    });
    expect(twice).toBe(once);
  });

  // -------------------------------------------------------------- ownership

  it('does not claim a hand-written opencode agent', () => {
    expect(
      transformer.isPtahOutput(
        '---\ndescription: mine\nmode: subagent\n---\nMy own agent.',
      ),
    ).toBe(false);
    // `source: ptah` in PROSE is not a signature.
    expect(
      transformer.isPtahOutput(
        '---\ndescription: mine\n---\nThe source: ptah is discussed here.',
      ),
    ).toBe(false);
    expect(transformer.isPtahOutput('no frontmatter at all')).toBe(false);
  });
});
