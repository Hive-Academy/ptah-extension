import { spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  RpcChild,
  caseDeadlineMs,
  OUTPUT_BOUNDS,
  MARKER_WRITER,
  childEnvironment,
  initializeParams,
  policy,
  approvalPolicyOverride,
  assertThreadApprovalPolicy,
  assertSafeSandbox,
  assertEffectiveApprovalPolicy,
  configSummary,
  commandMatches,
  markerCommand,
  commandPrompt,
  MARKER_INSTRUCTIONS,
  MARKER_MESSAGE_INSTRUCTIONS,
  sanitize,
  markerExists,
  type EvidenceCase,
  type CaseResult,
  type Experiment,
  type Manifest,
  type TurnBudget,
  type UsageBudget,
} from './evidence-harness';
import {
  createPathRedactor,
  recordCommandShape,
} from './evidence-failure-notes';

const record = (value: unknown): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(value);
const id = (value: unknown, key: string): string =>
  z.string().parse(record(record(value)[key])['id']);
const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

export function schemaProbe(manifest: Manifest): Record<string, string> {
  const methods = manifest.methods.requests;
  return Object.fromEntries(
    [
      'thread/read',
      'thread/items/list',
      'thread/turns/list',
      'thread/resume',
      'thread/rollback',
      'thread/revert',
      'thread/rewind',
      'subagent/start',
    ].map((method) => [
      method,
      methods.includes(method)
        ? 'schema present; behavior unverified'
        : 'schema absent',
    ]),
  );
}

interface Context {
  item: EvidenceCase;
  result: CaseResult;
  experiment: Experiment;
  binary: string;
  model: string;
  budget: TurnBudget;
  usage: UsageBudget;
  manifest: Manifest;
  children: Set<RpcChild>;
  authDirectory: string;
}
interface Session {
  rpc: RpcChild;
  thread: string;
  terminal: string;
  turn: string;
  usageTurn: string;
  approvals: number;
  commands: number;
  markerReply: boolean;
  homeVerified: boolean;
  startup: boolean;
  command: string;
  otherCommand: string;
}
const PROFILE_MARKER = 'PTAH_PROFILE_CONFIRMED';
// Local stdio fixture, no filesystem/network APIs and no tool actions.
const PROFILE_MCP = String.raw`
const rl = require('node:readline').createInterface({input: process.stdin});
rl.on('line', line => {
 if (Buffer.byteLength(line) > 65536) { rl.close(); return; }
 const q = JSON.parse(line); if (!('id' in q)) return;
 const result = q.method === 'initialize' ? {protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'profile-probe',version:'1'}} : q.method === 'tools/list' ? {tools:[]} : {};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\n');
});`;

export async function runRoundCase(c: Context): Promise<void> {
  const { item, result, experiment, children } = c;
  const profile = item.id === 'profile-inputs';
  const scope = item.id === 'always-allow-scope';
  const same = item.id === 'same-home-isolation';
  const different = item.id === 'different-home-isolation';
  const resume = item.id === 'resume-history';
  const selected = policy('ask');
  const sessions: Session[] = [];
  const extraHome = join(experiment.root, 'round-second-home');
  const configPath = join(experiment.home, 'config.toml');
  const snapshot = (): string | null =>
    existsSync(configPath) ? readFileSync(configPath).toString('base64') : null;
  const before = snapshot();
  const evidence: Record<string, unknown> = { schema: schemaProbe(c.manifest) };
  result.round = evidence;
  evidence['configPresenceBefore'] = before === null ? 'absent' : 'present';
  let deadlineError: Error | undefined;
  let cleanupError: Error | undefined;
  const deadline = setTimeout(() => {
    deadlineError = new Error('Case deadline exceeded');
    for (const session of sessions) session.rpc.abort();
  }, caseDeadlineMs(item));
  const healthy = (): void => {
    if (deadlineError) throw deadlineError;
    for (const session of sessions) session.rpc.assertHealthy();
  };
  const wait = async (gate: () => boolean): Promise<void> => {
    while (!gate()) {
      healthy();
      await sleep();
    }
    healthy();
  };
  const start = async (
    label: string,
    home: string,
    resumed?: string,
  ): Promise<Session> => {
    const local = { ...experiment, home };
    const commandLabel = same ? 'first' : label;
    const script = join(experiment.root, `${item.id}-${commandLabel}.cjs`);
    const target = join(
      experiment.workspace,
      `${item.id}-${commandLabel}.marker`,
    );
    const other = join(
      experiment.workspace,
      `${item.id}-${commandLabel}-other.marker`,
    );
    if (!(same && label === 'second'))
      writeFileSync(
        script,
        MARKER_WRITER + ';writeMarker(process.argv[2],process.argv[3]);',
        { flag: 'wx', mode: 0o600 },
      );
    const overrides = [
      ...Object.entries(OUTPUT_BOUNDS).map(
        ([key, value]) => `${key}=${JSON.stringify(value)}`,
      ),
      'web_search="disabled"',
      'features.apps=false',
      'sandbox_workspace_write.network_access=false',
      `sandbox_mode=${JSON.stringify(selected.sandbox)}`,
      approvalPolicyOverride(selected.approvalPolicy),
    ];
    if (profile) {
      const fixture = join(experiment.root, 'profile-probe.cjs');
      writeFileSync(fixture, PROFILE_MCP, { flag: 'wx', mode: 0o600 });
      overrides.push(
        `mcp_servers.profile_probe.command=${JSON.stringify(process.execPath)}`,
        `mcp_servers.profile_probe.args=${JSON.stringify([fixture])}`,
      );
    }
    const rpc = new RpcChild(
      spawn(
        c.binary,
        [...overrides.flatMap((value) => ['-c', value]), 'app-server'],
        {
          cwd: experiment.workspace,
          env: childEnvironment(local),
          stdio: 'pipe',
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
        },
      ),
      result,
      createPathRedactor(local, c.authDirectory),
    );
    children.add(rpc);
    const session: Session = {
      rpc,
      thread: '',
      turn: '',
      terminal: '',
      usageTurn: '',
      approvals: 0,
      commands: 0,
      markerReply: false,
      homeVerified: false,
      startup: false,
      command: markerCommand([
        process.execPath,
        script,
        experiment.root,
        target,
      ]),
      otherCommand: markerCommand([
        process.execPath,
        script,
        experiment.root,
        other,
      ]),
    };
    sessions.push(session);
    const noteRejection = (
      params: Record<string, unknown>,
      fields: Record<string, unknown>,
      expectedCommand = session.command,
    ): void => {
      recordCommandShape(result, params, fields, {
        experiment: local,
        expectedCommand,
        markerScript: script,
        authDirectory: c.authDirectory,
        sanitize,
      });
    };
    rpc.onRequest = async (frame, summary) => {
      const params = record(frame.params);
      if (
        params['threadId'] !== session.thread ||
        frame.method !== 'item/commandExecution/requestApproval'
      ) {
        noteRejection(
          params,
          params,
          scope && session.approvals === 1
            ? session.otherCommand
            : session.command,
        );
        rpc.decline(frame.id);
        throw new Error('approval/isolation gate failed');
      }
      const expected =
        scope && session.approvals === 1
          ? session.otherCommand
          : session.command;
      if (
        (!scope && !(same || different)) ||
        !commandMatches(params['command'], expected) ||
        session.approvals >= (scope ? 2 : 1) ||
        (scope && session.approvals === 1 && session.commands !== 2)
      ) {
        noteRejection(
          params,
          params,
          scope && session.approvals === 1
            ? session.otherCommand
            : session.command,
        );
        rpc.decline(frame.id);
        throw new Error('Approval rejected by safety gate');
      }
      if (
        markerExists(
          experiment.root,
          scope && session.approvals === 1 ? other : target,
        )
      ) {
        noteRejection(
          params,
          params,
          scope && session.approvals === 1
            ? session.otherCommand
            : session.command,
        );
        rpc.decline(frame.id);
        throw new Error('Side effect before approval');
      }
      session.approvals++;
      const decision =
        (scope || (same && label === 'first')) && session.approvals === 1
          ? 'acceptForSession'
          : scope
            ? 'decline'
            : 'accept';
      summary.response = decision;
      summary.absentBefore = true;
      rpc.respond(frame.id, { decision });
    };
    rpc.onNotification = (method, raw) => {
      const params = record(raw);
      if (
        params['threadId'] != null &&
        session.thread &&
        params['threadId'] !== session.thread
      ) {
        noteRejection(params, record(params['item'] ?? {}));
        throw new Error('Notification thread mismatch');
      }
      if (
        method === 'mcpServer/startupStatus/updated' &&
        params['name'] === 'profile_probe' &&
        params['status'] === 'ready'
      )
        session.startup = true;
      if (method === 'thread/tokenUsage/updated') {
        const tokens = record(params['tokenUsage']);
        const total = z
          .number()
          .int()
          .nonnegative()
          .parse(record(tokens['total'])['totalTokens']);
        const last = z
          .number()
          .int()
          .nonnegative()
          .parse(record(tokens['last'])['totalTokens']);
        session.usageTurn = z.string().parse(params['turnId']);
        // Thread cumulative totals survive a child restart during resume.
        const usageKey = JSON.stringify([item.id, session.thread]);
        const turnUsage = c.usage.observe(usageKey, total, session.usageTurn);
        (result.usageByTurn ??= {})[
          JSON.stringify([session.thread, session.usageTurn])
        ] = turnUsage;
        (result.usageSamples ??= []).push({ last, total });
        result.usage = { totalTokens: c.usage.consumed };
        evidence[`${label}Usage`] = { last, total };
      }
      if (method === 'turn/completed') {
        session.terminal = z.string().parse(record(params['turn'])['status']);
        session.turn = id(params, 'turn');
      }
      if (method === 'item/completed' || method === 'item/started') {
        const observed = record(params['item']);
        if (observed['type'] === 'agentMessage' && method === 'item/completed')
          session.markerReply ||= observed['text'] === PROFILE_MARKER;
        if (observed['type'] === 'commandExecution') {
          const expected =
            scope && session.commands >= 2
              ? session.otherCommand
              : session.command;
          if (
            !(scope || same || different) ||
            !commandMatches(observed['command'], expected)
          ) {
            noteRejection(params, observed, expected);
            throw new Error('Unexpected command');
          }
          if (method === 'item/completed') {
            if (scope && session.commands === 2) {
              if (
                session.approvals !== 2 ||
                observed['status'] !== 'declined' ||
                markerExists(experiment.root, other)
              )
                throw new Error('approval/isolation gate failed');
              session.commands++;
              return;
            }
            if (
              observed['status'] !== 'completed' ||
              observed['exitCode'] !== 0
            )
              throw new Error('Round command did not complete');
            if (
              !markerExists(
                experiment.root,
                scope && session.commands >= 2 ? other : target,
              )
            )
              throw new Error('Round marker missing');
            session.commands++;
            if (session.commands > (scope ? 3 : 1))
              throw new Error('Unexpected or repeated tool item');
          }
        } else if (
          !['agentMessage', 'userMessage', 'reasoning'].includes(
            String(observed['type']),
          )
        )
          throw new Error('Unexpected or repeated tool item');
      }
    };
    const init = record(
      await rpc.request(
        'initialize',
        initializeParams(selected.approvalPolicy),
      ),
    );
    if (
      typeof init['codexHome'] !== 'string' ||
      realpathSync(init['codexHome']) !== realpathSync(home)
    )
      throw new Error('CODEX_HOME isolation mismatch');
    session.homeVerified = true;
    evidence[`${label}HomeVerified`] = true;
    rpc.notify('initialized');
    const config = record(
      configSummary(await rpc.request('config/read', { includeLayers: false })),
    );
    assertEffectiveApprovalPolicy(
      config['approval_policy'],
      selected.approvalPolicy,
    );
    if (
      config['sandbox_mode'] !== selected.sandbox ||
      Object.entries(OUTPUT_BOUNDS).some(
        ([key, value]) => config[key] !== value,
      )
    )
      throw new Error('Effective config differs from bounded profile');
    const models = record(await rpc.request('model/list', {}));
    if (
      !z
        .array(z.object({ id: z.string(), model: z.string().optional() }))
        .parse(models['data'])
        .some((model) => model.id === c.model || model.model === c.model)
    )
      throw new Error('Selected model not in first model/list page');
    const response = await rpc.request(
      resumed ? 'thread/resume' : 'thread/start',
      {
        ...(resumed
          ? { threadId: resumed, excludeTurns: false }
          : { ephemeral: !resume }),
        model: c.model,
        cwd: experiment.workspace,
        ...selected,
        config: { model_reasoning_effort: profile ? 'medium' : 'low' },
        developerInstructions: profile
          ? `Reply exactly ${PROFILE_MARKER}. Do not use tools.`
          : scope || same
            ? MARKER_MESSAGE_INSTRUCTIONS
            : MARKER_INSTRUCTIONS,
      },
    );
    assertSafeSandbox(response);
    assertThreadApprovalPolicy(response, selected.approvalPolicy);
    session.thread = id(response, 'thread');
    if (resumed) {
      if (session.thread !== resumed)
        throw new Error('Notification thread mismatch');
      const turns = z
        .array(z.object({ items: z.array(z.unknown()) }))
        .parse(record(record(response)['thread'])['turns']);
      if (!turns.some((turn) => turn.items.length > 0))
        throw new Error('Resume history missing');
      evidence['historyItems'] = turns.reduce(
        (sum, turn) => sum + turn.items.length,
        0,
      );
    }
    if (profile) {
      if (record(response)['reasoningEffort'] !== 'medium')
        throw new Error('Effective config differs from bounded profile');
      evidence['reasoningEffort'] = 'medium';
      await wait(() => session.startup);
    }
    return session;
  };
  const turn = async (session: Session, prompt: string): Promise<void> => {
    session.terminal = '';
    session.usageTurn = '';
    const response = await session.rpc.request(
      'turn/start',
      {
        threadId: session.thread,
        model: c.model,
        approvalPolicy: selected.approvalPolicy,
        approvalsReviewer: 'user',
        sandboxPolicy:
          selected.sandbox === 'read-only'
            ? { type: 'readOnly', networkAccess: false }
            : {
                type: 'workspaceWrite',
                writableRoots: [experiment.workspace],
                networkAccess: false,
              },
        input: [{ type: 'text', text: prompt, text_elements: [] }],
      },
      c.budget,
    );
    const turnId = id(response, 'turn');
    await wait(
      () =>
        !!session.terminal &&
        session.turn === turnId &&
        session.usageTurn === turnId,
    );
    if (session.terminal !== 'completed')
      throw new Error('Round turn did not complete');
  };
  try {
    if (different) {
      (experiment.additionalHomes ??= []).push(extraHome);
      mkdirSync(extraHome, { mode: 0o700 });
      copyFileSync(
        join(experiment.home, 'auth.json'),
        join(extraHome, 'auth.json'),
      );
      chmodSync(join(extraHome, 'auth.json'), 0o600);
    }
    const first = await start('first', experiment.home);
    if (same || different) {
      const second = await start(
        'second',
        different ? extraHome : experiment.home,
      );
      if (first.thread === second.thread)
        throw new Error('approval/isolation gate failed');
      await turn(first, commandPrompt(first.command));
      if (same) {
        rmSync(join(experiment.workspace, `${item.id}-first.marker`));
        await turn(second, commandPrompt(second.command));
        evidence['sameCommandPromptsInSecondThread'] = second.approvals === 1;
      }
      if (
        first.approvals !== 1 ||
        first.commands !== 1 ||
        second.approvals !== (same ? 1 : 0) ||
        second.commands !== (same ? 1 : 0)
      )
        throw new Error('approval/isolation gate failed');
      evidence['secondChildPaid'] = same;
    } else if (scope) {
      await turn(first, commandPrompt(first.command));
      if (first.approvals !== 1 || first.commands !== 1)
        throw new Error('approval/isolation gate failed');
      rmSync(join(experiment.workspace, `${item.id}-first.marker`));
      await turn(first, commandPrompt(first.command));
      if (Number(first.approvals) !== 1 || Number(first.commands) !== 2)
        throw new Error('approval/isolation gate failed');
      evidence['exactCommandReuseWithoutApproval'] = true;
      await turn(first, commandPrompt(first.otherCommand));
      if (Number(first.approvals) !== 2 || Number(first.commands) !== 3)
        throw new Error('approval/isolation gate failed');
      if (
        markerExists(
          experiment.root,
          join(experiment.workspace, `${item.id}-first-other.marker`),
        )
      )
        throw new Error('approval/isolation gate failed');
      evidence['differentCommandDeclined'] = true;
    } else if (resume) {
      await turn(first, 'Reply OK without tools.');
      await first.rpc.stop();
      children.delete(first.rpc);
      sessions.splice(sessions.indexOf(first), 1);
      const second = await start('resumed', experiment.home, first.thread);
      await turn(second, 'Reply OK again without tools.');
      if (c.manifest.methods.requests.includes('thread/rollback')) {
        const rolled = record(
          await second.rpc.request('thread/rollback', {
            threadId: second.thread,
            numTurns: 1,
          }),
        );
        const turns = z
          .array(z.unknown())
          .parse(record(rolled['thread'])['turns']);
        if (turns.length !== 1) throw new Error('Rollback history mismatch');
        evidence['rollbackOneTurn'] = true;
      }
    } else if (profile) {
      await turn(first, 'Follow your developer instructions.');
      if (!first.markerReply) throw new Error('Profile marker missing');
      evidence['developerMarker'] = true;
      evidence['mcpStartupReady'] = true;
    } else throw new Error('Unknown round case');
  } catch (error) {
    if (
      error instanceof Error &&
      /gate|mismatch|Unexpected/.test(error.message)
    ) {
      // Gates without a command payload still leave an explicit missing shape.
      recordCommandShape(
        result,
        {},
        {},
        {
          experiment,
          expectedCommand: sessions[0]?.command ?? '',
          markerScript: '',
          authDirectory: c.authDirectory,
          sanitize,
        },
      );
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    const stopped = await Promise.allSettled(
      sessions.map(async (session) => {
        await session.rpc.stop();
        children.delete(session.rpc);
      }),
    );
    if (different) {
      rmSync(extraHome, { recursive: true, force: true });
      evidence['secondHomeDeleted'] = !existsSync(extraHome);
      experiment.additionalHomes = experiment.additionalHomes?.filter(
        (home) => home !== extraHome,
      );
    }
    evidence['configUnchanged'] = before === snapshot();
    if (stopped.some((entry) => entry.status === 'rejected'))
      cleanupError = new Error('child teardown not confirmed');
    if (!evidence['configUnchanged'])
      cleanupError ??= new Error('Shared home config changed');
  }
  if (cleanupError) throw cleanupError;
  result.status = 'observed';
}
