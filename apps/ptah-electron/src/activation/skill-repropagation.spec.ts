import 'reflect-metadata';

const LOGGER_TOKEN = Symbol.for('Logger');
const PROPAGATION_TOKEN = Symbol.for('HarnessSyncPropagation');

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
  },
}));

jest.mock('@ptah-extension/skill-synthesis', () => ({}));

jest.mock('@ptah-extension/harness-sync', () => ({
  HARNESS_SYNC_TOKENS: {
    PROPAGATION: Symbol.for('HarnessSyncPropagation'),
  },
}));

import { ElectronSkillRepropagation } from './skill-repropagation';

const WORKSPACE_ROOT = '/tmp/ws';

interface FakeContainer {
  isRegistered: (token: symbol) => boolean;
  resolve: <T>(token: symbol) => T;
}

function makeContainer(
  warn: jest.Mock,
  propagate: jest.Mock | null,
): FakeContainer {
  const map = new Map<symbol, unknown>([
    [LOGGER_TOKEN, { debug: jest.fn(), warn }],
  ]);
  if (propagate !== null) map.set(PROPAGATION_TOKEN, { propagate });
  return {
    isRegistered: (token: symbol) => map.has(token),
    resolve: <T>(token: symbol): T => {
      if (!map.has(token)) {
        throw new Error(`unregistered token: ${String(token)}`);
      }
      return map.get(token) as T;
    },
  };
}

describe('ElectronSkillRepropagation', () => {
  // One road for all three kinds since TASK_2026_278 Batch 2. Before it, a
  // skill enhancement that added or renamed a directory reached codex, copilot
  // and cursor immediately and stayed invisible to Claude — the primary
  // consumer — until the next activation, because the two fan-outs were
  // separate code paths with separate triggers.
  //
  // Batch 3 moved the call from a bare reconcile onto propagation, which
  // refreshes the user layer FIRST. `'agent'` is the case that proves it
  // matters: `{ws}/.claude/agents` is a SOURCE the mirror reads FROM, so an
  // enhanced agent file changed nothing the reconciler could see and the old
  // pass propagated pre-enhancement content while reporting success.
  it.each(['skill', 'command', 'agent'] as const)(
    "kind '%s' propagates through the user layer to every harness target",
    async (kind) => {
      const propagate = jest.fn().mockResolvedValue(null);
      const container = makeContainer(jest.fn(), propagate);
      const repropagation = new ElectronSkillRepropagation(container as never);

      await repropagation.repropagate(kind, 'caveman', WORKSPACE_ROOT);

      expect(propagate).toHaveBeenCalledWith(
        WORKSPACE_ROOT,
        `skill-repropagation:${kind}`,
      );
    },
  );

  it('swallows a thrown propagation (non-fatal) and logs a warning', async () => {
    const warn = jest.fn();
    const propagate = jest.fn().mockRejectedValue(new Error('boom'));
    const container = makeContainer(warn, propagate);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await expect(
      repropagation.repropagate('skill', 'caveman', WORKSPACE_ROOT),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the host registered no propagation service', async () => {
    // A minimal container (a test host, an embedded consumer) must not turn a
    // committed promotion into a thrown error.
    const warn = jest.fn();
    const container = makeContainer(warn, null);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await expect(
      repropagation.repropagate('skill', 'caveman', WORKSPACE_ROOT),
    ).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
