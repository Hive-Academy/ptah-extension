import 'reflect-metadata';
import { SkillTriggerService } from './skill-trigger.service';
import type { PostToolUsePayload, SubagentStopPayload, StopPayload, UserPromptExpansionPayload } from '@ptah-extension/agent-sdk';

function harness(enabled = true) {
  const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  const recorder = { recordSkillEvent: jest.fn() };
  const harvester = { harvest: jest.fn().mockResolvedValue(undefined) };
  const extractor = { extract: jest.fn() };
  const callbacks: {
    subagent?: (payload: SubagentStopPayload) => void;
    tool?: (payload: PostToolUsePayload) => void;
    expansion?: (payload: UserPromptExpansionPayload) => void;
    stop?: (payload: StopPayload) => void;
  } = {};
  const register = <T>(save: (callback: T) => void) => ({
    register: (callback: T) => { save(callback); return jest.fn(); },
  });
  const service = new SkillTriggerService(
    logger as never,
    { getConfiguration: (_section: string, key: string) =>
      key === 'skills.telemetry.enabled' ? enabled : undefined } as never,
    {} as never,
    register<(payload: SubagentStopPayload) => void>((cb) => { callbacks.subagent = cb; }) as never,
    register<(payload: PostToolUsePayload) => void>((cb) => { callbacks.tool = cb; }) as never,
    register<(payload: UserPromptExpansionPayload) => void>((cb) => { callbacks.expansion = cb; }) as never,
    recorder as never,
    register<(payload: StopPayload) => void>((cb) => { callbacks.stop = cb; }) as never,
    harvester as never,
    extractor as never,
  );
  service.start();
  return { service, callbacks, recorder, harvester };
}

describe('SkillTriggerService retained hooks', () => {
  it('records Skill tool invocation telemetry', async () => {
    const h = harness();
    h.callbacks.tool?.({
      toolName: 'Skill', toolInput: { command: '/review' },
      sessionId: 'session', workspaceRoot: '/ws', success: true, timestamp: 100,
    } as never);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.recorder.recordSkillEvent).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'review', source: 'tool-use', isError: false }),
    );
    h.service.stop();
  });

  it('records subagent completion with run identity', async () => {
    const h = harness();
    h.callbacks.subagent?.({
      agentType: 'reviewer', subagentSessionId: 'sub', parentSessionId: 'parent',
      agentId: 'run', workspaceRoot: '/ws', timestamp: 100,
      transcriptPath: '/t/sub.jsonl',
    } as never);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.recorder.recordSkillEvent).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'reviewer', runId: 'run', source: 'subagent' }),
    );
    h.service.stop();
  });

  it('skips subagent completion when stop metadata is absent', async () => {
    const h = harness();
    h.callbacks.subagent?.({
      agentType: 'reviewer', subagentSessionId: null, parentSessionId: null,
      agentId: 'run', workspaceRoot: '/ws', timestamp: 100, transcriptPath: null,
    });
    h.callbacks.subagent?.({
      agentType: 'reviewer', subagentSessionId: 'sub', parentSessionId: null,
      agentId: 'run', workspaceRoot: '/ws', timestamp: 100, transcriptPath: null,
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.recorder.recordSkillEvent).not.toHaveBeenCalled();
    h.service.stop();
  });

  it('skips subagent completion when workspaceRoot is null', async () => {
    const h = harness();
    h.callbacks.subagent?.({
      agentType: 'reviewer', subagentSessionId: 'sub', parentSessionId: 'parent',
      agentId: 'run', workspaceRoot: null, timestamp: 100, transcriptPath: '/t/sub.jsonl',
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.recorder.recordSkillEvent).not.toHaveBeenCalled();
    h.service.stop();
  });

  it('respects the current telemetry setting', async () => {
    const h = harness(false);
    h.callbacks.expansion?.({
      skillSlug: 'review', sessionId: 'session', workspaceRoot: '/ws',
      timestamp: 100, expansionType: 'slash_command',
    } as never);
    await Promise.resolve();
    expect(h.recorder.recordSkillEvent).not.toHaveBeenCalled();
    h.service.stop();
  });

  it('harvests specs after Stop', async () => {
    jest.useFakeTimers();
    const h = harness();
    h.callbacks.stop?.({ workspaceRoot: '/ws', sessionId: 'session' } as never);
    jest.advanceTimersByTime(90_000);
    await Promise.resolve();
    expect(h.harvester.harvest).toHaveBeenCalledWith('/ws');
    h.service.stop();
    jest.useRealTimers();
  });
});