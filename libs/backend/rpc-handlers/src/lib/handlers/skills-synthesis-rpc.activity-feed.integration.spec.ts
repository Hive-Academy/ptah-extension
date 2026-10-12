/**
 * TASK_2026_586 - the Thoth activity feed on the REAL backend path.
 *
 * Nothing between the producer and the RPC edge is a double:
 *   SkillSynthesisService.pushEvent  (real event ring, real ULID factory)
 *     -> live `skillSynthesis:event` broadcast (captured at the webview manager)
 *     -> SkillSynthesisDiagnosticsService.getSnapshot (real)
 *     -> SkillsSynthesisRpcHandlers `skillSynthesis:diagnostics` (real mapper)
 * Only the SQLite store, the webview transport and the workspace config
 * (in-memory mock provider) are stubbed.
 *
 * It proves the live wire and the snapshot wire are the same object for the
 * same id (R14), that ids are stable across polls, and that the window is
 * newest-first, so the webview can merge the two without duplicates. The
 * webview half (merge, render, grouping) is
 * `skill-activity-feed.live-poll.integration.spec.ts` in skill-synthesis-ui.
 *
 * The second block is the write path of the Settings trigger toggles: each of
 * the eight controls' payload persists unchanged through
 * `skillSynthesis:setTriggers`.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import { decodeTime } from 'ulid';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  SKILL_SYNTHESIS_TOKENS,
  SkillSynthesisDiagnosticsService,
  SkillSynthesisService,
} from '@ptah-extension/skill-synthesis';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type {
  SkillDiagnosticsResult,
  SkillSynthesisEventWire,
  SkillTriggersDto,
} from '@ptah-extension/shared';
import { SkillsSynthesisRpcHandlers } from './skills-synthesis-rpc.handlers';

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const T0 = 1_700_000_000_000;

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };
}

function makeRpcHandler() {
  const methods = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    registerMethod: jest.fn(
      (name: string, fn: (p: unknown) => Promise<unknown>) => {
        methods.set(name, fn);
      },
    ),
    call: async (name: string, params: unknown) => {
      const fn = methods.get(name);
      if (!fn) throw new Error(`No handler registered for ${name}`);
      return fn(params);
    },
  };
}

interface Rig {
  readonly synthesis: SkillSynthesisService;
  readonly rpc: ReturnType<typeof makeRpcHandler>;
  readonly workspace: MockWorkspaceProvider;
  /** Wire events carried by the live `skillSynthesis:event` broadcast. */
  readonly live: SkillSynthesisEventWire[];
  readonly broadcast: jest.Mock;
  readonly diagnostics: (
    eventLimit?: number,
  ) => Promise<SkillDiagnosticsResult>;
  readonly setTriggers: (
    triggers: Partial<SkillTriggersDto>,
  ) => Promise<{ triggers: SkillTriggersDto }>;
  readonly getTriggers: () => Promise<{ triggers: SkillTriggersDto }>;
}

function buildRig(): Rig {
  const logger = makeLogger();
  const rpc = makeRpcHandler();
  const workspace = createMockWorkspaceProvider({
    folders: ['/workspace/project'],
  });
  const store = {
    getStats: jest.fn().mockReturnValue({
      candidates: 0,
      promoted: 0,
      rejected: 0,
      active: 0,
      dormant: 0,
      merged: 0,
      retired: 0,
      invocations: 0,
    }),
  };
  const live: SkillSynthesisEventWire[] = [];
  const broadcast = jest.fn(
    async (_type: string, payload: { event: SkillSynthesisEventWire }) => {
      live.push(payload.event);
    },
  );

  // The REAL event ring. `pushEvent` touches only the logger and the webview
  // manager, so every other constructor collaborator is irrelevant here.
  const none = null as never;
  const synthesis = new SkillSynthesisService(
    logger as never,
    none,
    none,
    workspace,
    store as never,
    none,
    none,
    none,
    null,
    none,
    null,
    null,
    null,
    { broadcastMessage: broadcast } as never,
  );
  const diagnosticsService = new SkillSynthesisDiagnosticsService(
    logger as never,
    synthesis,
    store as never,
    workspace,
  );

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpc);
  child.registerInstance(TOKENS.SENTRY_SERVICE, {
    captureException: jest.fn(),
  });
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
    synthesis,
  );
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE, store);
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_DIAGNOSTICS_SERVICE,
    diagnosticsService,
  );
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE, {
    listRecent: jest.fn().mockReturnValue([]),
  });
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE, {
    todayStageUsage: jest.fn().mockReturnValue([]),
  });
  child.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, workspace);
  child.register(SkillsSynthesisRpcHandlers, {
    useClass: SkillsSynthesisRpcHandlers,
  });
  child.resolve(SkillsSynthesisRpcHandlers).register();

  return {
    synthesis,
    rpc,
    workspace,
    live,
    broadcast,
    diagnostics: (eventLimit) =>
      rpc.call('skillSynthesis:diagnostics', {
        workspaceRoot: '/workspace/project',
        ...(eventLimit === undefined ? {} : { eventLimit }),
      }) as Promise<SkillDiagnosticsResult>,
    setTriggers: (triggers) =>
      rpc.call('skillSynthesis:setTriggers', { triggers }) as Promise<{
        triggers: SkillTriggersDto;
      }>,
    getTriggers: () =>
      rpc.call('skillSynthesis:getTriggers', {}) as Promise<{
        triggers: SkillTriggersDto;
      }>,
  };
}

describe('activity feed on the real backend path: live push == snapshot poll', () => {
  it('serves the same wire object for the same id on the push and in the snapshot, newest first', async () => {
    const rig = buildRig();
    // Same-ms, same-kind pair from different sessions; a reason/candidateId
    // fold; an error; an event stamped older than the one before it.
    rig.synthesis.pushEvent({
      kind: 'analyze-run',
      timestamp: T0,
      sessionId: 's-a',
      stats: { turns: 6 },
    });
    rig.synthesis.pushEvent({
      kind: 'ineligible',
      timestamp: T0,
      sessionId: 's-b',
      reason: 'prefilterTooThin',
      candidateId: 'cand_1',
      stats: { turns: 2 },
    });
    rig.synthesis.pushEvent({
      kind: 'ineligible',
      timestamp: T0,
      sessionId: 's-c',
      reason: 'prefilterRejected',
    });
    rig.synthesis.pushEvent({
      kind: 'error',
      timestamp: T0 - 5000,
      sessionId: 's-a',
      error: 'boom',
    });
    rig.synthesis.pushEvent({ kind: 'curator-pass', timestamp: T0 + 10 });

    expect(rig.live).toHaveLength(5);
    const snapshot = await rig.diagnostics(50);

    // Newest recorded first; the push order reversed, object for object.
    expect(snapshot.recentEvents).toEqual([...rig.live].reverse());
    // The folded payload is identical on both paths.
    const folded = snapshot.recentEvents.find((e) => e.sessionId === 's-b');
    expect(folded?.stats).toEqual({
      turns: 2,
      candidateId: 'cand_1',
      reason: 'prefilterTooThin',
    });

    const ids = snapshot.recentEvents.map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(id).toMatch(ULID_SHAPE);
    // Strictly descending ids along the window: the sort key the webview uses
    // inside one millisecond.
    for (let i = 1; i < ids.length; i++) expect(ids[i - 1] > ids[i]).toBe(true);
  });

  it('gives same-millisecond same-kind events distinct ids that encode that millisecond', async () => {
    const rig = buildRig();
    for (const sessionId of ['s-1', 's-2', 's-3']) {
      rig.synthesis.pushEvent({
        kind: 'ineligible',
        timestamp: T0,
        sessionId,
      });
    }
    const { recentEvents } = await rig.diagnostics(50);

    expect(recentEvents.map((e) => e.sessionId)).toEqual(['s-3', 's-2', 's-1']);
    expect(new Set(recentEvents.map((e) => e.id)).size).toBe(3);
    for (const e of recentEvents) expect(decodeTime(e.id)).toBe(T0);
    // The old `timestamp + '-' + kind` row key would have been one value.
    expect(
      new Set(recentEvents.map((e) => `${e.timestamp}-${e.kind}`)).size,
    ).toBe(1);
  });

  it('keeps every id stable across polls: later pushes only add ids at the front', async () => {
    const rig = buildRig();
    for (let i = 0; i < 4; i++) {
      rig.synthesis.pushEvent({
        kind: 'analyze-run',
        timestamp: T0 + i * 1000,
        sessionId: 's-1',
      });
    }
    const first = await rig.diagnostics(50);
    const second = await rig.diagnostics(50);
    expect(second.recentEvents.map((e) => e.id)).toEqual(
      first.recentEvents.map((e) => e.id),
    );

    rig.synthesis.pushEvent({
      kind: 'analyze-run',
      timestamp: T0 + 4000,
      sessionId: 's-1',
    });
    rig.synthesis.pushEvent({
      kind: 'analyze-run',
      timestamp: T0 + 5000,
      sessionId: 's-1',
    });
    const third = await rig.diagnostics(50);

    expect(third.recentEvents).toHaveLength(6);
    expect(third.recentEvents.slice(2)).toEqual(first.recentEvents);
    expect(third.recentEvents.slice(0, 2).map((e) => e.id)).toEqual(
      [...rig.live.slice(-2)].reverse().map((e) => e.id),
    );
  });

  it('honours eventLimit with the NEWEST events, and the ring cap evicts the oldest', async () => {
    const rig = buildRig();
    for (let i = 0; i < 205; i++) {
      rig.synthesis.pushEvent({
        kind: 'analyze-run',
        timestamp: T0 + i,
        sessionId: `s-${i}`,
      });
    }
    const liveIds = rig.live.map((e) => e.id);

    const three = await rig.diagnostics(3);
    expect(three.recentEvents.map((e) => e.sessionId)).toEqual([
      's-204',
      's-203',
      's-202',
    ]);

    const all = await rig.diagnostics(200);
    expect(all.recentEvents).toHaveLength(200);
    expect(all.recentEvents.map((e) => e.id)).toEqual(
      liveIds.slice(-200).reverse(),
    );
    // The five evicted events were pushed live but are gone from the poll.
    const polled = new Set(all.recentEvents.map((e) => e.id));
    expect(liveIds.slice(0, 5).some((id) => polled.has(id))).toBe(false);
  });

  it('returns the 50-event window the webview asks for, newest first, with the latest at index 0', async () => {
    const rig = buildRig();
    for (let i = 0; i < 60; i++) {
      rig.synthesis.pushEvent({
        kind: i % 2 === 0 ? 'analyze-run' : 'ineligible',
        timestamp: T0 + i * 1000,
        sessionId: `s-${i}`,
      });
    }
    const { recentEvents } = await rig.diagnostics(50);

    expect(recentEvents).toHaveLength(50);
    expect(recentEvents[0].sessionId).toBe('s-59');
    expect(recentEvents.at(-1)?.sessionId).toBe('s-10');
    // The status card and Sessions hint read index 0 as "latest".
    expect(recentEvents[0].timestamp).toBeGreaterThan(
      recentEvents[1].timestamp,
    );
  });

  it('a failing broadcast never loses the event from the snapshot', async () => {
    const rig = buildRig();
    rig.broadcast.mockImplementationOnce(() => {
      throw new Error('webview gone');
    });
    rig.synthesis.pushEvent({
      kind: 'analyze-run',
      timestamp: T0,
      sessionId: 's-1',
    });
    const { recentEvents } = await rig.diagnostics(50);
    expect(recentEvents.map((e) => e.sessionId)).toEqual(['s-1']);
    expect(recentEvents[0].id).toMatch(ULID_SHAPE);
  });
});

/**
 * One entry per control behaviour of the Settings triggers card; `payload` is
 * what the base accordion (and the card) hand to `skillSynthesis:setTriggers`,
 * `writes` the flat keys the backend must persist for it.
 */
const P = 'skillSynthesis.triggers.';
const TRIGGER_WRITES: ReadonlyArray<{
  readonly control: string;
  readonly payload: Partial<SkillTriggersDto>;
  readonly writes: ReadonlyArray<[string, unknown]>;
  readonly readBack: Partial<SkillTriggersDto>;
}> = [
  {
    control: 'idleMs on',
    payload: { idleMs: 600_000 },
    writes: [[`${P}idleMs`, 600_000]],
    readBack: { idleMs: 600_000 },
  },
  {
    control: 'idleMs off',
    payload: { idleMs: 0 },
    writes: [[`${P}idleMs`, 0]],
    readBack: { idleMs: 0 },
  },
  {
    control: 'idleMs typed',
    payload: { idleMs: 120_000 },
    writes: [[`${P}idleMs`, 120_000]],
    readBack: { idleMs: 120_000 },
  },
  {
    control: 'bootScan',
    payload: { bootScan: false },
    writes: [[`${P}bootScan`, false]],
    readBack: { bootScan: false },
  },
  {
    control: 'subagentStop',
    payload: { subagentStop: { enabled: false } },
    writes: [[`${P}subagentStop.enabled`, false]],
    readBack: { subagentStop: { enabled: false } },
  },
  {
    control: 'turnComplete',
    payload: { turnComplete: { enabled: false } },
    writes: [[`${P}turnComplete.enabled`, false]],
    readBack: { turnComplete: { enabled: false } },
  },
  {
    control: 'postToolUse (minEditCount kept)',
    payload: { postToolUse: { enabled: false, minEditCount: 3 } },
    writes: [
      [`${P}postToolUse.enabled`, false],
      [`${P}postToolUse.minEditCount`, 3],
    ],
    readBack: { postToolUse: { enabled: false, minEditCount: 3 } },
  },
  {
    control: 'postToolUse on with minEditCount 1',
    payload: { postToolUse: { enabled: true, minEditCount: 1 } },
    writes: [
      [`${P}postToolUse.enabled`, true],
      [`${P}postToolUse.minEditCount`, 1],
    ],
    readBack: { postToolUse: { enabled: true, minEditCount: 1 } },
  },
  {
    control: 'postToolUseMinEditCount (upper bound 20)',
    payload: { postToolUse: { enabled: true, minEditCount: 20 } },
    writes: [
      [`${P}postToolUse.enabled`, true],
      [`${P}postToolUse.minEditCount`, 20],
    ],
    readBack: { postToolUse: { enabled: true, minEditCount: 20 } },
  },
  {
    control: 'maxAnalyzesPerHour on',
    payload: { maxAnalyzesPerHour: 60 },
    writes: [[`${P}maxAnalyzesPerHour`, 60]],
    readBack: { maxAnalyzesPerHour: 60 },
  },
  {
    control: 'maxAnalyzesPerHour off',
    payload: { maxAnalyzesPerHour: 0 },
    writes: [[`${P}maxAnalyzesPerHour`, 0]],
    readBack: { maxAnalyzesPerHour: 0 },
  },
  {
    control: 'maxAnalyzesPerHour (upper bound 1000)',
    payload: { maxAnalyzesPerHour: 1000 },
    writes: [[`${P}maxAnalyzesPerHour`, 1000]],
    readBack: { maxAnalyzesPerHour: 1000 },
  },
];

describe('Settings trigger toggles: setTriggers write path', () => {
  it.each(TRIGGER_WRITES)(
    '$control persists unchanged and reads back',
    async ({ payload, writes, readBack }) => {
      const rig = buildRig();
      const setSpy = jest.spyOn(rig.workspace, 'setConfiguration');

      const result = await rig.setTriggers(payload);

      expect(setSpy.mock.calls).toEqual(
        writes.map(([key, value]) => ['ptah', key, value]),
      );
      expect(result.triggers).toMatchObject(readBack);
      // A fresh read (the next diagnostics poll / getTriggers) agrees.
      expect((await rig.getTriggers()).triggers).toMatchObject(readBack);
      expect((await rig.diagnostics(10)).triggers).toMatchObject(readBack);
    },
  );

  it('applying every control in turn leaves each value as last written and clobbers none', async () => {
    const rig = buildRig();
    await rig.setTriggers({ idleMs: 120_000 });
    await rig.setTriggers({ bootScan: false });
    await rig.setTriggers({ subagentStop: { enabled: false } });
    await rig.setTriggers({ turnComplete: { enabled: false } });
    await rig.setTriggers({ postToolUse: { enabled: false, minEditCount: 3 } });
    await rig.setTriggers({ postToolUse: { enabled: false, minEditCount: 9 } });
    await rig.setTriggers({ maxAnalyzesPerHour: 100 });

    expect((await rig.getTriggers()).triggers).toEqual({
      idleMs: 120_000,
      bootScan: false,
      subagentStop: { enabled: false },
      turnComplete: { enabled: false },
      postToolUse: { enabled: false, minEditCount: 9 },
      maxAnalyzesPerHour: 100,
    });
  });

  it('rejects the values the card cannot validate itself, writing nothing', async () => {
    const rig = buildRig();
    const setSpy = jest.spyOn(rig.workspace, 'setConfiguration');
    const invalid: Array<Partial<SkillTriggersDto>> = [
      { idleMs: 4999 },
      { postToolUse: { enabled: true, minEditCount: 0 } },
      { postToolUse: { enabled: true, minEditCount: 21 } },
      { maxAnalyzesPerHour: 1001 },
      { maxAnalyzesPerHour: -1 },
    ];
    for (const triggers of invalid) {
      await expect(rig.setTriggers(triggers)).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });
    }
    expect(setSpy).not.toHaveBeenCalled();
    // The bounds at the edge are accepted.
    await expect(rig.setTriggers({ idleMs: 5000 })).resolves.toMatchObject({
      triggers: { idleMs: 5000 },
    });
  });
});
