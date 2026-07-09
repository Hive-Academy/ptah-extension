import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { MultiCliAgentWriterService } from './multi-cli-agent-writer.service';
import { CursorAgentTransformer } from './cursor-agent-transformer';
import { CopilotAgentTransformer } from './copilot-agent-transformer';
import { CodexSubagentTransformer } from './codex-agent-transformer';
import type { GeneratedAgent } from '../../types/core.types';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof MultiCliAgentWriterService>[0];

function agent(id: string, body = 'Agent body'): GeneratedAgent {
  return {
    sourceTemplateId: id,
    sourceTemplateVersion: 'unknown',
    content: `---\nname: ${id}\ndescription: ${id} agent\n---\n${body}`,
    variables: { description: `${id} agent` },
    customizations: [],
    generatedAt: new Date(),
    filePath: `/abs/.claude/agents/${id}.md`,
  } as unknown as GeneratedAgent;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('Workspace agent transformers (decision #4)', () => {
  it('Cursor agents target {ws}/.cursor/agents/{slug}.md (bare-name)', () => {
    const ws = '/work/space';
    const cursor = new CursorAgentTransformer().transform(
      agent('backend-developer'),
      ws,
    );
    expect(cursor.filePath).toBe(
      join(ws, '.cursor', 'agents', 'backend-developer.md'),
    );
    expect(cursor.filePath).not.toContain('ptah-');
  });

  it('Copilot agent targets {ws}/.github/agents/{slug}.agent.md', () => {
    const result = new CopilotAgentTransformer().transform(
      agent('senior-tester'),
      '/work/space',
    );
    expect(result.filePath).toBe(
      join('/work/space', '.github', 'agents', 'senior-tester.agent.md'),
    );
  });

  it('Codex subagent transform targets {ws}/.codex/agents/{slug}.toml', () => {
    const result = new CodexSubagentTransformer().transform(
      agent('x'),
      '/work/space',
    );
    expect(result.filePath).toBe(
      join('/work/space', '.codex', 'agents', 'x.toml'),
    );
  });

  it('Codex subagent TOML carries name/description and the body as developer_instructions', () => {
    const result = new CodexSubagentTransformer().transform(
      agent('backend-developer', 'Implement the feature.'),
      '/work/space',
    );
    expect(result.content).toContain('name = "backend-developer"');
    expect(result.content).toContain('description = "backend-developer agent"');
    expect(result.content).toContain('developer_instructions = """');
    expect(result.content).toContain('Implement the feature.');
    // Body only — no leftover YAML frontmatter delimiters.
    expect(result.content).not.toContain('\n---\n');
  });

  it('Codex reviewer agents run in the read-only sandbox', () => {
    const reviewer = new CodexSubagentTransformer().transform(
      agent('code-logic-reviewer'),
      '/work/space',
    );
    expect(reviewer.content).toContain('sandbox_mode = "read-only"');

    const worker = new CodexSubagentTransformer().transform(
      agent('backend-developer'),
      '/work/space',
    );
    expect(worker.content).not.toContain('sandbox_mode');
  });

  it('agent name is the BARE agentId (no ptah- prefix) for all CLIs', () => {
    const ws = '/work/space';
    const id = 'backend-developer';
    expect(
      new CursorAgentTransformer().transform(agent(id), ws).content,
    ).toContain(`name: ${id}`);
    expect(
      new CopilotAgentTransformer().transform(agent(id), ws).content,
    ).toContain(`name: ${id}`);
    expect(
      new CodexSubagentTransformer().transform(agent(id), ws).content,
    ).toContain(`name = "${id}"`);

    for (const t of [
      new CursorAgentTransformer(),
      new CopilotAgentTransformer(),
      new CodexSubagentTransformer(),
    ]) {
      expect(t.transform(agent(id), ws).content).not.toContain('ptah-');
    }
  });
});

describe('MultiCliAgentWriterService.writeForClis (workspace)', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    for (const d of cleanups.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  async function workspace(): Promise<string> {
    const ws = await mkdtemp(join(tmpdir(), 'ptah-agent-ws-'));
    cleanups.push(ws);
    return ws;
  }

  it('writes Cursor + Copilot + Codex agents to workspace dirs', async () => {
    const ws = await workspace();
    const svc = new MultiCliAgentWriterService(logger);

    const results = await svc.writeForClis(
      [agent('backend-developer')],
      ['cursor', 'copilot', 'codex'],
      ws,
    );

    expect(results.every((r) => r.agentsFailed === 0)).toBe(true);
    expect(
      await exists(join(ws, '.cursor', 'agents', 'backend-developer.md')),
    ).toBe(true);
    expect(
      await exists(join(ws, '.github', 'agents', 'backend-developer.agent.md')),
    ).toBe(true);
    expect(
      await exists(join(ws, '.codex', 'agents', 'backend-developer.toml')),
    ).toBe(true);
  });

  it('Codex writes per-file subagent TOML and re-runs overwrite in place', async () => {
    const ws = await workspace();
    const svc = new MultiCliAgentWriterService(logger);
    const tomlPath = join(ws, '.codex', 'agents', 'a.toml');

    await svc.writeForClis([agent('a', 'first body')], ['codex'], ws);
    const afterFirst = await readFile(tomlPath, 'utf8');
    expect(afterFirst).toContain('name = "a"');
    expect(afterFirst).toContain('first body');

    // Re-run overwrites the same file (no duplication, latest body wins).
    await svc.writeForClis([agent('a', 'second body')], ['codex'], ws);
    const afterSecond = await readFile(tomlPath, 'utf8');
    expect(afterSecond).toContain('second body');
    expect(afterSecond).not.toContain('first body');
  });

  it('Copilot home reap only deletes ptah-/ptahsynth- prefixed home files', async () => {
    const ws = await workspace();
    const homeAgents = join(homedir(), '.copilot', 'agents');
    await mkdir(homeAgents, { recursive: true });
    const userFile = join(homeAgents, `user-keep-${Date.now()}.md`);
    const ptahFile = join(homeAgents, `ptah-reap-${Date.now()}.md`);
    await writeFile(userFile, 'keep', 'utf8');
    await writeFile(ptahFile, 'reap', 'utf8');

    try {
      const svc = new MultiCliAgentWriterService(logger);
      await svc.writeForClis([agent('z')], ['copilot'], ws);

      expect(await exists(userFile)).toBe(true);
      expect(await exists(ptahFile)).toBe(false);
    } finally {
      await rm(userFile, { force: true }).catch(() => undefined);
      await rm(ptahFile, { force: true }).catch(() => undefined);
    }
  });
});
