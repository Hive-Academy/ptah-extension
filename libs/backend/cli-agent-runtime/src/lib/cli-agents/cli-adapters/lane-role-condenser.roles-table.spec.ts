/**
 * Renders every role defined in this repository's `.claude/agents/*.md` for
 * the Codex and opencode lanes and proves each block is within the lane cap
 * (TASK_2026_597, R3.6). The printed table is the R3.6 before/after record:
 * "source" is the role body as the resolver returns it (frontmatter stripped),
 * "codex" and "opencode" are the rendered block lengths, header and pointer
 * included.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { stripFrontmatter } from '@ptah-extension/harness-sync';
import type { AgentRoleDefinition } from '@ptah-extension/shared';
import { renderRoleBlock } from './cli-adapter.utils';
import { LANE_ROLE_MAX_CHARS } from './lane-role-condenser';

function findAgentsDir(from: string): string {
  let current = from;
  for (;;) {
    const candidate = join(current, '.claude', 'agents');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`No .claude/agents directory above ${from}`);
    }
    current = parent;
  }
}

const agentsDir = findAgentsDir(__dirname);
const roles: AgentRoleDefinition[] = readdirSync(agentsDir)
  .filter((file) => file.endsWith('.md'))
  .sort()
  .map((file) => {
    const sourcePath = join(agentsDir, file);
    const body = stripFrontmatter(readFileSync(sourcePath, 'utf8'));
    return {
      name: file.slice(0, -'.md'.length),
      body,
      sourcePath,
      bytes: Buffer.byteLength(body, 'utf8'),
    };
  });

describe('every repository role fits the lane cap', () => {
  it('finds the repository roles', () => {
    expect(roles.length).toBeGreaterThan(0);
  });

  it.each(roles.map((role) => [role.name, role] as const))(
    '%s renders within 10,000 chars for codex and opencode',
    (_name, role) => {
      for (const cli of ['codex', 'opencode'] as const) {
        const rendered = renderRoleBlock(role, cli);
        expect(rendered.length).toBeLessThanOrEqual(LANE_ROLE_MAX_CHARS);
        expect(rendered.startsWith(`## Role: ${role.name}\n\n`)).toBe(true);
        if (rendered.includes('This role was condensed')) {
          expect(rendered).toContain(`\`${role.sourcePath}\``);
        }
      }
    },
  );

  it('records the before/after table', () => {
    const rows = roles.map((role) => {
      const codex = renderRoleBlock(role, 'codex');
      const opencode = renderRoleBlock(role, 'opencode');
      return {
        role: role.name,
        source: role.body.length,
        codex: codex.length,
        opencode: opencode.length,
        condensed: codex.includes('This role was condensed') ? 'yes' : 'no',
      };
    });
    const table = [
      '| role | source chars | codex chars | opencode chars | condensed |',
      '| --- | ---: | ---: | ---: | --- |',
      ...rows.map(
        (row) =>
          `| ${row.role} | ${row.source} | ${row.codex} | ${row.opencode} | ${row.condensed} |`,
      ),
    ].join('\n');
    // The R3.6 record: printed once so a run log carries it verbatim.
    console.log(`Lane role cap (R3.6):\n${table}`);

    expect(rows.every((row) => row.codex <= LANE_ROLE_MAX_CHARS)).toBe(true);
    expect(rows.every((row) => row.opencode <= LANE_ROLE_MAX_CHARS)).toBe(true);
  });
});
