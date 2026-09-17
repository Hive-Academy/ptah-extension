import { NoActivityWatchdog } from './no-activity-watchdog';
import type {
  HookInput,
  SDKMessage,
} from '../types/sdk-types/claude-sdk.types';

const WINDOW = 180_000;
describe('query operation ownership', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function harness() {
    const timeout = jest.fn();
    const overdue = jest.fn();
    const wd = new NoActivityWatchdog(WINDOW, timeout, overdue);
    const hooks = wd.lifecycleHooks();
    wd.start();
    const hook = async (input: HookInput) => {
      await hooks[input.hook_event_name]?.[0].hooks[0](input, undefined, {
        signal: new AbortController().signal,
      });
    };
    return { wd, timeout, overdue, hook };
  }
  const base = { session_id: 's', cwd: '/ws', transcript_path: '/ws/session' };
  const tool = {
    ...base,
    hook_event_name: 'PreToolUse' as const,
    tool_name: 'Agent',
    tool_use_id: 't',
    tool_input: {},
  };

  it.each(['manual', 'auto'] as const)(
    '%s compaction survives long silence and ends on explicit terminal',
    async (trigger) => {
      const { wd, hook, timeout, overdue } = harness();
      await hook({
        ...base,
        hook_event_name: 'PreCompact',
        trigger,
        custom_instructions: null,
      });
      await hook({
        ...base,
        hook_event_name: 'PreCompact',
        trigger,
        custom_instructions: null,
      });
      jest.advanceTimersByTime(WINDOW * 20);
      expect(timeout).not.toHaveBeenCalled();
      expect(overdue).toHaveBeenCalledWith(['compaction']);
      wd.observe({
        type: 'system',
        subtype: 'status',
        status: null,
        compact_result: 'failed',
        uuid: '00000000-0000-0000-0000-000000000000',
        session_id: 's',
      });
      jest.advanceTimersByTime(WINDOW);
      expect(timeout).toHaveBeenCalledTimes(1);
    },
  );

  it('silent foreground Agent/tool survives; missing SubagentStop cannot leak past tool result', async () => {
    const { wd, hook, timeout } = harness();
    await hook(tool);
    await hook(tool);
    jest.advanceTimersByTime(WINDOW * 20);
    expect(timeout).not.toHaveBeenCalled();
    await hook({ ...tool, hook_event_name: 'PostToolUse', tool_response: {} });
    jest.advanceTimersByTime(WINDOW);
    expect(timeout).toHaveBeenCalledTimes(1);
    wd.stop();
  });

  it('background acknowledgement ends root wait; child progress cannot mask stalled parent', async () => {
    const { wd, hook, timeout } = harness();
    await hook(tool);
    await hook({
      ...tool,
      hook_event_name: 'PostToolUse',
      tool_response: { background: true },
    });
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(WINDOW / 3);
      wd.observe({
        type: 'system',
        subtype: 'task_progress',
        task_id: 'child',
        tool_use_id: 't',
      } as SDKMessage);
    }
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it('nested tool hooks do not protect root, even with empty agent_type', async () => {
    const { hook, timeout } = harness();
    await hook({ ...tool, agent_id: 'child', agent_type: '' });
    jest.advanceTimersByTime(WINDOW);
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it('interrupt clears lost terminal hooks for ordinary next turn; idle remains protected', async () => {
    const { wd, hook, timeout } = harness();
    await hook(tool);
    wd.endTurn();
    wd.hold();
    jest.advanceTimersByTime(WINDOW * 4);
    expect(timeout).not.toHaveBeenCalled();
    wd.release();
    jest.advanceTimersByTime(WINDOW);
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it('cancel permanently clears operations/holds/timer and rejects late hooks', async () => {
    const { wd, hook, timeout, overdue } = harness();
    await hook(tool);
    wd.hold();
    wd.stop();
    await hook(tool);
    wd.release();
    wd.start();
    jest.advanceTimersByTime(WINDOW * 20);
    expect(wd.isHeld).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    expect(timeout).not.toHaveBeenCalled();
    expect(overdue).not.toHaveBeenCalled();
  });

  it('unaccounted startup silence still invokes bounded recovery once', () => {
    const { timeout } = harness();
    jest.advanceTimersByTime(WINDOW * 20);
    expect(timeout).toHaveBeenCalledTimes(1);
  });
});
