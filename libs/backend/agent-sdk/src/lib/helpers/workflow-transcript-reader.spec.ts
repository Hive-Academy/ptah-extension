import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findWorkflowAgentTranscript,
  readWorkflowAgentTranscript,
} from './workflow-transcript-reader';

/**
 * Pins the on-disk layout the SDK uses for agents spawned by a `Workflow`
 * run — one level deeper than `getSubagentMessages` reads:
 *
 *   ~/.claude/projects/<dir>/<sessionId>/subagents/workflows/<runId>/agent-<id>.jsonl
 */
describe('workflow-transcript-reader', () => {
  const SESSION = '2a8a5156-2321-42d9-a84d-f1e30533c023';
  const AGENT = 'a01fea2eb1b977576';
  let home: string;
  let runDir: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-wf-transcript-'));
    runDir = path.join(
      home,
      '.claude',
      'projects',
      'D--projects-ptah-extension',
      SESSION,
      'subagents',
      'workflows',
      'wf_e32ce737-144',
    );
    await fs.mkdir(runDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  describe('findWorkflowAgentTranscript', () => {
    it('finds the agent file under a workflow run of the session', async () => {
      const file = path.join(runDir, `agent-${AGENT}.jsonl`);
      await fs.writeFile(file, '');

      await expect(
        findWorkflowAgentTranscript(SESSION, AGENT, home),
      ).resolves.toBe(file);
    });

    it('returns null when the session has no run holding that agent', async () => {
      await fs.writeFile(path.join(runDir, 'agent-other.jsonl'), '');

      await expect(
        findWorkflowAgentTranscript(SESSION, AGENT, home),
      ).resolves.toBeNull();
    });

    it('returns null when there is no projects directory at all', async () => {
      await expect(
        findWorkflowAgentTranscript(SESSION, AGENT, path.join(home, 'nope')),
      ).resolves.toBeNull();
    });

    it('refuses ids that are not plain path segments', async () => {
      await fs.writeFile(path.join(runDir, `agent-${AGENT}.jsonl`), '');

      await expect(
        findWorkflowAgentTranscript('../' + SESSION, AGENT, home),
      ).resolves.toBeNull();
      await expect(
        findWorkflowAgentTranscript(SESSION, '../../x', home),
      ).resolves.toBeNull();
    });
  });

  describe('readWorkflowAgentTranscript', () => {
    it('parses user/assistant/system lines in order and drops the rest', async () => {
      const file = path.join(runDir, `agent-${AGENT}.jsonl`);
      await fs.writeFile(
        file,
        [
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'do the thing' },
            timestamp: '2026-08-19T19:10:00.000Z',
          }),
          JSON.stringify({ type: 'progress', data: {} }),
          JSON.stringify({
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'done' }],
            },
          }),
          'not json at all',
          '{"type":"assistant","message":{"role":"assistant","content":"partial',
        ].join('\n'),
      );

      const lines = await readWorkflowAgentTranscript(file);

      expect(lines).toEqual([
        {
          type: 'user',
          message: { role: 'user', content: 'do the thing' },
          timestamp: '2026-08-19T19:10:00.000Z',
        },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'done' }],
          },
        },
      ]);
    });

    it('applies offset and limit after filtering', async () => {
      const file = path.join(runDir, `agent-${AGENT}.jsonl`);
      const line = (i: number) =>
        JSON.stringify({ type: 'user', message: { content: `m${i}` } });
      await fs.writeFile(file, [1, 2, 3, 4].map(line).join('\n'));

      const page = await readWorkflowAgentTranscript(file, {
        offset: 1,
        limit: 2,
      });

      expect(
        page.map((l) => (l.message as { content: string }).content),
      ).toEqual(['m2', 'm3']);
    });
  });
});
