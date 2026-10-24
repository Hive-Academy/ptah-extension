import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCase,
  TurnBudget,
  UsageBudget,
  policy,
  OUTPUT_BOUNDS,
  markerCommand,
  type CaseResult,
  type Experiment,
  type Manifest,
} from './evidence-harness';
import { schemaProbe } from './evidence-cases-round';

const manifest: Manifest = {
  pinnedVersion: '0.155.1',
  binaryPath: 'unused',
  binarySha256: 'unused',
  schemaSha256: 'unused',
  platform: process.platform,
  arch: process.arch,
  methods: {
    requests: [
      'thread/start',
      'thread/resume',
      'thread/read',
      'thread/rollback',
    ],
    serverRequests: [],
    clientNotifications: [],
    serverNotifications: [],
  },
};
type Fault =
  | 'none'
  | 'home'
  | 'cross-event'
  | 'cross-approval'
  | 'config-write'
  | 'marker'
  | 'history'
  | 'repeat-approval'
  | 'wrong-command'
  | 'usage'
  | 'rollback'
  | 'profile-effort'
  | 'grant-leak'
  | 'config-present'
  | 'existing-config-write';
async function exercise(caseId: string, fault: Fault = 'none') {
  const root = mkdtempSync(join(tmpdir(), 'ptah-round-spec-'));
  const experiment: Experiment = {
    root,
    home: join(root, 'home'),
    workspace: join(root, 'workspace'),
    scratch: join(root, 'scratch'),
  };
  for (const path of [
    experiment.home,
    experiment.workspace,
    experiment.scratch,
  ])
    mkdirSync(path);
  writeFileSync(join(experiment.home, 'auth.json'), 'fake-auth');
  if (fault === 'config-present' || fault === 'existing-config-write')
    writeFileSync(join(experiment.home, 'config.toml'), '# fixture');
  const result: CaseResult = {
    id: caseId,
    status: 'not run',
    turns: 0,
    events: [],
    approvals: [],
    notes: [],
  };
  const sent: Record<string, unknown>[] = [];
  let childCount = 0;
  const spawnModule =
    jest.requireActual<typeof import('node:child_process')>(
      'node:child_process',
    );
  const spy = jest
    .spyOn(spawnModule, 'spawn')
    .mockImplementation((_binary, _args, options) => {
      const index = childCount++;
      const label =
        index === 0
          ? 'first'
          : caseId === 'resume-history'
            ? 'resumed'
            : 'second';
      const thread =
        caseId === 'resume-history' ? 'history-thread' : `thread-${index}`;
      const home = String(options?.env?.['CODEX_HOME']);
      expect(readFileSync(join(home, 'auth.json'), 'utf8')).toBe('fake-auth');
      const child = Object.assign(new ChildProcess(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: 0,
        pid: undefined,
      });
      child.stdin.on('finish', () => child.emit('close', 0));
      const send = (frame: object) =>
        child.stdout.write(JSON.stringify(frame) + '\n');
      const notify = (method: string, params: object) =>
        send({ method, params });
      let turns = 0;
      let requestId = 100;
      const approvals = new Map<number, () => void>();
      const commandLabel = caseId === 'same-home-isolation' ? 'first' : label;
      const target = (other: boolean) =>
        join(
          experiment.workspace,
          `${caseId}-${commandLabel}${other ? '-other' : ''}.marker`,
        );
      const command = (other: boolean) =>
        markerCommand([
          process.execPath,
          join(root, `${caseId}-${commandLabel}.cjs`),
          root,
          target(other),
        ]);
      const approve = async (other: boolean, turnId: string) => {
        const id = ++requestId;
        await new Promise<void>((resolve) => {
          approvals.set(id, resolve);
          send({
            id,
            method: 'item/commandExecution/requestApproval',
            params: {
              threadId: fault === 'cross-approval' ? 'foreign' : thread,
              turnId,
              itemId: `cmd-${id}`,
              command:
                fault === 'wrong-command' ? 'bad command' : command(other),
              cwd: experiment.workspace,
            },
          });
        });
      };
      child.stdin.on('data', (chunk: Buffer) => {
        const q = JSON.parse(chunk.toString()) as {
          id: number;
          method?: string;
          params: Record<string, unknown>;
          result?: { decision: string };
        };
        sent.push(q);
        if (!q.method) {
          approvals.get(q.id)?.();
          return;
        }
        let response: unknown = {};
        if (q.method === 'initialize')
          response = { codexHome: fault === 'home' ? root : home };
        if (q.method === 'model/list') response = { data: [{ id: 'model' }] };
        if (q.method === 'config/read')
          response = {
            config: {
              ...OUTPUT_BOUNDS,
              sandbox_mode: 'read-only',
              approval_policy: policy('ask').approvalPolicy,
              sandbox_workspace_write: { network_access: false },
            },
          };
        if (q.method === 'thread/start' || q.method === 'thread/resume') {
          response = {
            ...policy('ask'),
            reasoningEffort:
              fault === 'profile-effort'
                ? 'low'
                : caseId === 'profile-inputs'
                  ? 'medium'
                  : 'low',
            thread: {
              id: thread,
              turns:
                fault === 'history'
                  ? []
                  : [{ items: [{ type: 'agentMessage', text: 'OK' }] }],
            },
          };
          if (caseId === 'profile-inputs')
            notify('mcpServer/startupStatus/updated', {
              name: 'profile_probe',
              status: 'ready',
              threadId: null,
            });
        }
        if (q.method === 'thread/rollback')
          response = {
            thread: {
              id: thread,
              turns: fault === 'rollback' ? [] : [{ items: [] }],
            },
          };
        if (q.method === 'turn/start') {
          turns++;
          const turnId = `turn-${index}-${turns}`;
          response = { turn: { id: turnId } };
          setImmediate(() => {
            void (async () => {
              if (fault === 'cross-event') {
                notify('item/started', {
                  threadId: 'foreign',
                  item: { type: 'reasoning' },
                });
                return;
              }
              if (fault === 'config-write' || fault === 'existing-config-write')
                writeFileSync(join(experiment.home, 'config.toml'), 'changed');
              if (
                caseId.includes('isolation') ||
                caseId === 'always-allow-scope'
              ) {
                for (const other of turns === 2 ? [false, true] : [false]) {
                  if (
                    (turns === 1 || other || fault === 'repeat-approval') &&
                    !(fault === 'grant-leak' && index === 1)
                  )
                    await approve(other, turnId);
                  writeFileSync(target(other), 'marker');
                  notify('item/completed', {
                    threadId: thread,
                    turnId,
                    item: {
                      type: 'commandExecution',
                      command: command(other),
                      status: 'completed',
                      exitCode: 0,
                    },
                  });
                }
              }
              notify('item/completed', {
                threadId: thread,
                turnId,
                item: {
                  type: 'agentMessage',
                  text:
                    fault === 'marker'
                      ? 'wrong'
                      : caseId === 'profile-inputs'
                        ? 'PTAH_PROFILE_CONFIRMED'
                        : 'OK',
                },
              });
              notify('thread/tokenUsage/updated', {
                threadId: thread,
                turnId,
                tokenUsage: {
                  last: { totalTokens: 100 },
                  total: {
                    totalTokens: fault === 'usage' ? 30001 : turns * 100,
                  },
                },
              });
              notify('turn/completed', {
                threadId: thread,
                turn: { id: turnId, status: 'completed' },
              });
            })();
          });
        }
        if (q.method !== 'initialized') send({ id: q.id, result: response });
      });
      return child;
    });
  let error: unknown;
  const budget = new TurnBudget(10);
  const usage = new UsageBudget();
  try {
    await runCase(
      {
        id: caseId,
        kind: 'round',
        turnCost: 2,
        observations: [6],
        purpose: 'fake',
      },
      result,
      experiment,
      'unused',
      'model',
      budget,
      usage,
      manifest,
      '',
      false,
      new Set(),
      root,
    );
  } catch (caught) {
    error = caught;
  } finally {
    spy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
  return {
    result,
    error,
    sent,
    childCount,
    turns: budget.consumed,
    usage: usage.consumed,
    cleaned: !existsSync(root),
  };
}

describe('round 7a harness fake children (no binary)', () => {
  it.each([
    ['different-home-isolation', 1, 2],
    ['same-home-isolation', 2, 2],
    ['profile-inputs', 1, 1],
    ['resume-history', 2, 2],
    ['always-allow-scope', 2, 1],
  ])('%s observes gates and cleanup', async (id, turns, count) => {
    const run = await exercise(String(id));
    expect(run.error).toBeUndefined();
    expect(run.result.status).toBe('observed');
    expect(run.turns).toBe(turns);
    expect(run.childCount).toBe(count);
    expect(run.result.round?.['configUnchanged']).toBe(true);
    expect(run.cleaned).toBe(true);
    if (id === 'always-allow-scope')
      expect(
        run.sent
          .filter((frame) => 'result' in frame)
          .map((frame) => frame['result']),
      ).toEqual([{ decision: 'acceptForSession' }, { decision: 'accept' }]);
    if (id === 'different-home-isolation')
      expect(run.result.round?.['secondHomeDeleted']).toBe(true);
    if (id === 'same-home-isolation') {
      expect(run.usage).toBe(200);
      expect(run.result.round?.['sameCommandPromptsInSecondThread']).toBe(true);
      expect(
        run.sent
          .filter((frame) => 'result' in frame)
          .map((frame) => frame['result']),
      ).toEqual([{ decision: 'acceptForSession' }, { decision: 'accept' }]);
    }
    if (id === 'resume-history') expect(run.usage).toBe(200);
    if (id === 'profile-inputs') {
      expect(
        run.sent.find((frame) => frame['method'] === 'thread/start')?.[
          'params'
        ],
      ).toMatchObject({ config: { model_reasoning_effort: 'medium' } });
      expect(run.result.round?.['reasoningEffort']).toBe('medium');
    }
    expect(run.result.round?.['configPresenceBefore']).toBe('absent');
    if (id === 'resume-history')
      expect(run.result.round?.['rollbackOneTurn']).toBe(true);
  });
  it.each<[string, Fault, string]>([
    ['different-home-isolation', 'home', 'CODEX_HOME isolation mismatch'],
    ['same-home-isolation', 'cross-event', 'Notification thread mismatch'],
    ['same-home-isolation', 'cross-approval', 'approval/isolation gate failed'],
    ['same-home-isolation', 'config-write', 'Shared home config changed'],
    [
      'same-home-isolation',
      'existing-config-write',
      'Shared home config changed',
    ],
    ['same-home-isolation', 'grant-leak', 'approval/isolation gate failed'],
    ['profile-inputs', 'marker', 'Profile marker missing'],
    [
      'profile-inputs',
      'profile-effort',
      'Effective config differs from bounded profile',
    ],
    ['resume-history', 'history', 'Resume history missing'],
    ['resume-history', 'rollback', 'Rollback history mismatch'],
    ['always-allow-scope', 'repeat-approval', 'approval/isolation gate failed'],
    ['always-allow-scope', 'wrong-command', 'approval/isolation gate failed'],
    ['profile-inputs', 'usage', 'Per-turn usage bound reached'],
  ])('%s stops at %s and cleans', async (id, fault, message) => {
    const run = await exercise(id, fault);
    expect(run.error).toEqual(new Error(message));
    expect(run.cleaned).toBe(true);
  });
  it('checks existing config bytes', async () => {
    const run = await exercise('same-home-isolation', 'config-present');
    expect(run.error).toBeUndefined();
    expect(run.result.round).toMatchObject({
      configPresenceBefore: 'present',
      configUnchanged: true,
    });
  });
  it('reports manifest presence without inventing absent subagent or rewind requests', () => {
    expect(schemaProbe(manifest)).toMatchObject({
      'thread/resume': 'schema present; behavior unverified',
      'thread/rollback': 'schema present; behavior unverified',
      'thread/rewind': 'schema absent',
      'subagent/start': 'schema absent',
    });
  });
});
