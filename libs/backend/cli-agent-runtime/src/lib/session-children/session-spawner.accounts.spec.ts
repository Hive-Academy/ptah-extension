import 'reflect-metadata';
import { resolve } from 'node:path';
import { container } from 'tsyringe';
import { SessionChildRegistry } from './session-child.registry';
import { SessionSpawnerService } from './session-spawner.service';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';
import type { ChildChatSessionStartInput } from './child-chat-session-host.port';
import type { ProviderAccountPortRefusal } from '@ptah-extension/auth-providers-tokens';

const PARENT = '11111111-2222-4333-8444-555555555555';
const PARENT_SDK = '22222222-3333-4444-8555-666666666666';
const ROOT = resolve('/repo');

function harness(refusal?: ProviderAccountPortRefusal) {
  const registry = new SessionChildRegistry();
  const releasePolicy = jest.fn();
  const policies = { register: jest.fn().mockReturnValue(releasePolicy) };
  const provisioner = {
    create: jest.fn().mockResolvedValue({ ok: true, worktree: {
      root: ROOT, branch: 'feat/child', worktreePath: resolve(ROOT, '.worktrees/child'), baseSha: 'a'.repeat(40),
    } }),
    rollback: jest.fn().mockResolvedValue([{ step: 'remove-worktree', ok: true }]),
  };
  const host = {
    startChildSession: jest.fn(async (_input: ChildChatSessionStartInput) => refusal
      ? { started: false as const, error: refusal.summary, accountRefusal: refusal }
      : { started: true as const, uiAnnounced: true }),
    startHandoffSession: jest.fn(),
  };
  const scope = container.createChildContainer();
  scope.register(CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST, { useValue: host });
  const register = jest.fn().mockReturnValue(() => undefined);
  const adapter = { isSessionActive: jest.fn().mockReturnValue(true), interruptSession: jest.fn().mockResolvedValue(undefined) };
  const registrar = { retainRoot: jest.fn().mockResolvedValue({ registered: true }), releaseRoot: jest.fn().mockResolvedValue(undefined) };
  const budget = { release: jest.fn() };
  type Args = ConstructorParameters<typeof SessionSpawnerService>;
  const service = new SessionSpawnerService(
    registry, provisioner as unknown as Args[1], {} as Args[2],
    { scopedWorkspaceRoot: () => ROOT } as unknown as Args[3],
    { listTrackedAgents: () => [] } as unknown as Args[4],
    policies as unknown as Args[5],
    { onTurnEnded: register, onTurnFailed: register } as unknown as Args[6],
    { register } as unknown as Args[7], { register } as unknown as Args[8],
    { onPromptLifecycle: register } as unknown as Args[9],
    { find: (id: string) => id === PARENT ? { realSessionId: PARENT_SDK, permissionLevel: 'ask' } : undefined } as unknown as Args[10],
    { get: jest.fn() } as unknown as Args[11], {} as Args[12],
    { getWorkspaceFolders: () => [ROOT], getConfiguration: <T>(_section: string, _key: string, fallback: T) => fallback } as unknown as Args[13],
    { appendLine: jest.fn() } as unknown as Args[14], adapter as unknown as Args[15], scope,
    { getPort: () => 4321 }, registrar, null, budget,
  );
  return { service, host, registry, provisioner, releasePolicy, registrar, adapter, budget };
}

describe('child account refusal transport', () => {
  afterEach(() => jest.useRealTimers());

  it.each(['missing-profile', 'invalid-bound', 'route-changed', 'release-held'] as const)(
    'preserves typed %s through rollback and does not touch the parent', async code => {
      const accountRefusal = { code, summary: 'The child account could not be verified.' };
      const h = harness(accountRefusal);
      const result = await h.service.start({ callerSessionId: PARENT, branch: 'feat/child', task: 'private task' });
      expect(result).toMatchObject({ ok: false, refusal: 'session-start-failed', accountRefusal });
      expect(h.host.startChildSession).toHaveBeenCalledTimes(1);
      expect(h.host.startChildSession.mock.calls[0][0].descriptor.parentSessionId).toBe(PARENT_SDK);
      expect(h.releasePolicy).toHaveBeenCalledTimes(1);
      expect(h.provisioner.rollback).toHaveBeenCalledTimes(1);
      expect(h.adapter.interruptSession).not.toHaveBeenCalled();
      expect(h.budget.release).not.toHaveBeenCalledWith(PARENT);
      expect(h.budget.release).not.toHaveBeenCalledWith(PARENT_SDK);
      expect(h.registry.childrenOf([PARENT])).toHaveLength(0);
      h.service.dispose();
    });

  it('ambient success retains the host payload and child-only teardown', async () => {
    jest.useFakeTimers();
    const h = harness();
    const result = await h.service.start({ callerSessionId: PARENT, branch: 'feat/child', task: 'private task' });
    expect(result.ok).toBe(true);
    const input = h.host.startChildSession.mock.calls[0][0];
    expect(input.descriptor).toMatchObject({ parentTabId: PARENT, parentSessionId: PARENT_SDK });
    expect(input).not.toHaveProperty('accountSelection');
    expect(input).not.toHaveProperty('accountBinding');
    h.service.dispose();
    expect(h.adapter.interruptSession).not.toHaveBeenCalledWith(PARENT);
    expect(h.adapter.interruptSession).not.toHaveBeenCalledWith(PARENT_SDK);
    expect(h.budget.release).not.toHaveBeenCalledWith(PARENT);
    expect(h.budget.release).not.toHaveBeenCalledWith(PARENT_SDK);
  });
});
