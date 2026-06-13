import 'reflect-metadata';

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { HarnessSubagentDefinition } from '@ptah-extension/shared';

import { HarnessAgentFileWriterService } from './harness-agent-file-writer.service';

function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: raw };
  }
  const data: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) {
      data[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, '$1');
    }
  }
  return { data, body: match[2] };
}

function subagent(
  overrides: Partial<HarnessSubagentDefinition> = {},
): HarnessSubagentDefinition {
  return {
    id: 'sentiment-watchdog',
    name: 'Sentiment Watchdog',
    description: 'Watches sentiment in real time',
    role: 'Monitor incoming messages for tone shifts',
    tools: ['Read', 'Grep'],
    executionMode: 'background',
    triggers: ['new message'],
    instructions: 'Flag negative sentiment spikes immediately.',
    ...overrides,
  };
}

describe('HarnessAgentFileWriterService', () => {
  let root: string;
  let service: HarnessAgentFileWriterService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-agents-'));
    service = new HarnessAgentFileWriterService(
      createMockLogger() as unknown as Logger,
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes a gray-matter-parseable .claude/agents/{id}.md with name, description, and tools', async () => {
    const outcome = await service.writeSubagentFiles(root, [subagent()]);

    expect(outcome.warnings).toEqual([]);
    const expectedPath = path.join(
      root,
      '.claude',
      'agents',
      'sentiment-watchdog.md',
    );
    expect(outcome.writtenPaths).toEqual([expectedPath]);

    const raw = await fs.readFile(expectedPath, 'utf-8');
    const parsed = parseFrontmatter(raw);
    expect(parsed.data['name']).toBe('sentiment-watchdog');
    expect(parsed.data['description']).toBe('Watches sentiment in real time');
    expect(parsed.data['tools']).toBe('Read, Grep');
    expect(parsed.body).toContain('# Sentiment Watchdog');
    expect(parsed.body).toContain('Monitor incoming messages');
    expect(parsed.body).toContain(
      'Flag negative sentiment spikes immediately.',
    );
    expect(parsed.body).toContain('background');
    expect(parsed.body).toContain('- new message');
  });

  it('returns an empty outcome with no writes for an empty subagent list', async () => {
    const outcome = await service.writeSubagentFiles(root, []);
    expect(outcome).toEqual({ writtenPaths: [], warnings: [] });
  });

  it('records a per-agent warning when a write fails and continues with the rest', async () => {
    await fs.mkdir(path.join(root, '.claude', 'agents', 'first.md'), {
      recursive: true,
    });

    const outcome = await service.writeSubagentFiles(root, [
      subagent({ id: 'first', name: 'First' }),
      subagent({ id: 'second', name: 'Second' }),
    ]);

    expect(outcome.writtenPaths).toHaveLength(1);
    expect(outcome.writtenPaths[0]).toContain('second.md');
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain('first.md');
  });

  it('produces a discovery-compatible kebab-case name even when id has odd characters', async () => {
    const outcome = await service.writeSubagentFiles(root, [
      subagent({ id: 'Weird Name!!', name: 'Weird Name' }),
    ]);

    const written = outcome.writtenPaths[0];
    expect(path.basename(written)).toBe('weird-name.md');
    const parsed = parseFrontmatter(await fs.readFile(written, 'utf-8'));
    expect(/^[a-z0-9-]+$/.test(parsed.data['name'])).toBe(true);
  });
});
