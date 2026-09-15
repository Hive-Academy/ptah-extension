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

import {
  ElectronSkillRepropagation,
  SKILL_REPROPAGATION_USER_LAYER_REASON,
} from './skill-repropagation';

const WORKSPACE_ROOT = '/tmp/ws';

interface FakeContainer {
  isRegistered: (token: symbol) => boolean;
  resolve: <T>(token: symbol) => T;
}

function makeContainer(
  warn: jest.Mock,
  propagate: jest.Mock | null,
  debug: jest.Mock = jest.fn(),
): FakeContainer {
  const map = new Map<symbol, unknown>([[LOGGER_TOKEN, { debug, warn }]]);
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

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
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

      // No origin: background work, refreshed under the governed label.
      expect(propagate).toHaveBeenCalledWith(
        WORKSPACE_ROOT,
        `skill-repropagation:${kind}`,
        { userLayerRefreshReason: 'skill-repropagation' },
      );
    },
  );

  // TASK_2026_437 FU-17b: the origin decides the user-layer label.
  it.each([{}, { userInitiated: false }])(
    'refreshes a background re-propagation (origin %p) under the governed skill-repropagation label',
    async (origin) => {
      const propagate = jest.fn().mockResolvedValue(null);
      const container = makeContainer(jest.fn(), propagate);
      const repropagation = new ElectronSkillRepropagation(container as never);

      await repropagation.repropagate(
        'skill',
        'caveman',
        WORKSPACE_ROOT,
        origin,
      );

      expect(propagate).toHaveBeenCalledWith(
        WORKSPACE_ROOT,
        'skill-repropagation:skill',
        { userLayerRefreshReason: SKILL_REPROPAGATION_USER_LAYER_REASON },
      );
    },
  );

  it('names no refresh label for a click, so the refresh keeps the ungoverned default', async () => {
    const propagate = jest.fn().mockResolvedValue(null);
    const container = makeContainer(jest.fn(), propagate);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await repropagation.repropagate('agent', 'caveman', WORKSPACE_ROOT, {
      userInitiated: true,
    });

    expect(propagate).toHaveBeenCalledWith(
      WORKSPACE_ROOT,
      'skill-repropagation:agent',
      {},
    );
  });

  it('a click awaits a thrown propagation, swallows it (non-fatal) and logs one warning', async () => {
    const warn = jest.fn();
    const propagate = jest.fn().mockRejectedValue(new Error('boom'));
    const container = makeContainer(warn, propagate);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await expect(
      repropagation.repropagate('skill', 'caveman', WORKSPACE_ROOT, {
        userInitiated: true,
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a click resolves only after the propagation has finished', async () => {
    let finish: () => void = () => undefined;
    const propagate = jest.fn(
      () =>
        new Promise<null>((resolve) => {
          finish = () => resolve(null);
        }),
    );
    const container = makeContainer(jest.fn(), propagate);
    const repropagation = new ElectronSkillRepropagation(container as never);

    let settled = false;
    const pass = repropagation
      .repropagate('skill', 'caveman', WORKSPACE_ROOT, { userInitiated: true })
      .then(() => {
        settled = true;
      });
    await flushMicrotasks();
    expect(settled).toBe(false);

    finish();
    await pass;
    expect(settled).toBe(true);
  });

  /**
   * b17b logic review, serious 1: the curator's enhancement loop awaits this
   * call per candidate, so a background call must not wait out a held refresh.
   */
  it('a background call resolves while the propagation is still held, and the propagation still runs', async () => {
    let finish: () => void = () => undefined;
    const debug = jest.fn();
    const propagate = jest.fn(
      () =>
        new Promise<null>((resolve) => {
          finish = () => resolve(null);
        }),
    );
    const container = makeContainer(jest.fn(), propagate, debug);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await expect(
      repropagation.repropagate('skill', 'caveman', WORKSPACE_ROOT),
    ).resolves.toBeUndefined();
    expect(propagate).toHaveBeenCalledTimes(1);
    expect(debug).not.toHaveBeenCalled();

    finish();
    await flushMicrotasks();
    expect(debug).toHaveBeenCalledWith(
      '[SkillRepropagation] Re-propagated enhanced clone',
      expect.objectContaining({ slug: 'caveman', userInitiated: false }),
    );
  });

  it('a background call logs a rejected propagation once and never rejects', async () => {
    const warn = jest.fn();
    const propagate = jest.fn().mockRejectedValue(new Error('boom'));
    const container = makeContainer(warn, propagate);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await expect(
      repropagation.repropagate('skill', 'caveman', WORKSPACE_ROOT),
    ).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[SkillRepropagation] Re-propagation failed (non-fatal)',
      expect.objectContaining({ error: 'boom', userInitiated: false }),
    );
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
