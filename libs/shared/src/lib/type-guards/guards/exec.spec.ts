import {
  isWorkflowTool,
  isAgentDispatchTool,
  isTaskManagementTool,
  isMonitorTool,
  isSendMessageTool,
  isScheduleWakeupTool,
  isBashToolInput,
  isBashOutputToolInput,
  isTaskToolInput,
  isTaskOutputToolInput,
  isTaskStopToolInput,
  isKillShellToolInput,
  isTodoWriteToolInput,
  isAskUserQuestionToolInput,
  isExitPlanModeToolInput,
  isTaskToolOutput,
  isBashToolOutput,
  isTodoWriteToolOutput,
} from './exec';

describe('exec tool-name guards', () => {
  describe('isTaskManagementTool', () => {
    it.each([
      'TaskCreate',
      'TaskUpdate',
      'TaskList',
      'TaskGet',
      'TaskStop',
      'TaskOutput',
    ])('returns true for %s', (name) => {
      expect(isTaskManagementTool(name)).toBe(true);
    });

    it('does NOT match the Task/Agent subagent-dispatch tool', () => {
      // The bare `Task`/`Agent` dispatch tool is handled by isAgentDispatchTool,
      // not the task-management guard.
      expect(isTaskManagementTool('Task')).toBe(false);
      expect(isTaskManagementTool('Agent')).toBe(false);
      expect(isAgentDispatchTool('Task')).toBe(true);
    });

    it('returns false for unrelated tool names', () => {
      expect(isTaskManagementTool('Bash')).toBe(false);
      expect(isTaskManagementTool('Workflow')).toBe(false);
      expect(isTaskManagementTool('')).toBe(false);
    });
  });

  describe('isMonitorTool', () => {
    it('matches only Monitor', () => {
      expect(isMonitorTool('Monitor')).toBe(true);
      expect(isMonitorTool('monitor')).toBe(false);
      expect(isMonitorTool('Bash')).toBe(false);
    });
  });

  describe('isSendMessageTool', () => {
    it('matches only SendMessage', () => {
      expect(isSendMessageTool('SendMessage')).toBe(true);
      expect(isSendMessageTool('sendMessage')).toBe(false);
      expect(isSendMessageTool('Message')).toBe(false);
    });
  });

  describe('isScheduleWakeupTool', () => {
    it('matches only ScheduleWakeup', () => {
      expect(isScheduleWakeupTool('ScheduleWakeup')).toBe(true);
      expect(isScheduleWakeupTool('Wakeup')).toBe(false);
      expect(isScheduleWakeupTool('CronCreate')).toBe(false);
    });
  });

  describe('guards are mutually exclusive', () => {
    it('a task tool is not also a workflow/monitor/message/wakeup tool', () => {
      const name = 'TaskCreate';
      expect(isTaskManagementTool(name)).toBe(true);
      expect(isWorkflowTool(name)).toBe(false);
      expect(isMonitorTool(name)).toBe(false);
      expect(isSendMessageTool(name)).toBe(false);
      expect(isScheduleWakeupTool(name)).toBe(false);
    });
  });

  // Shape guards: every guard is checked against a valid payload (true path),
  // and against null / non-object / missing-key / wrong-type inputs so each
  // short-circuit arm of the `&&` chains is exercised.
  describe('input shape guards', () => {
    it('isBashToolInput', () => {
      expect(isBashToolInput({ command: 'ls' })).toBe(true);
      expect(isBashToolInput(null)).toBe(false);
      expect(isBashToolInput('ls')).toBe(false);
      expect(isBashToolInput({})).toBe(false);
      expect(isBashToolInput({ command: 42 })).toBe(false);
    });

    it('isBashOutputToolInput', () => {
      expect(isBashOutputToolInput({ bash_id: 'sh_1' })).toBe(true);
      expect(isBashOutputToolInput(null)).toBe(false);
      expect(isBashOutputToolInput(7)).toBe(false);
      expect(isBashOutputToolInput({})).toBe(false);
      expect(isBashOutputToolInput({ bash_id: 1 })).toBe(false);
    });

    it('isTaskToolInput', () => {
      expect(isTaskToolInput({ subagent_type: 'general' })).toBe(true);
      expect(isTaskToolInput(null)).toBe(false);
      expect(isTaskToolInput(true)).toBe(false);
      expect(isTaskToolInput({})).toBe(false);
      expect(isTaskToolInput({ subagent_type: 5 })).toBe(false);
    });

    it('isTaskOutputToolInput', () => {
      expect(isTaskOutputToolInput({ task_id: 't1' })).toBe(true);
      expect(isTaskOutputToolInput(null)).toBe(false);
      expect(isTaskOutputToolInput('t1')).toBe(false);
      expect(isTaskOutputToolInput({})).toBe(false);
      expect(isTaskOutputToolInput({ task_id: 1 })).toBe(false);
    });

    it('isTaskStopToolInput', () => {
      expect(isTaskStopToolInput({ task_id: 't1' })).toBe(true);
      expect(isTaskStopToolInput({ shell_id: 's1' })).toBe(true);
      expect(isTaskStopToolInput(null)).toBe(false);
      expect(isTaskStopToolInput(0)).toBe(false);
      expect(isTaskStopToolInput({})).toBe(false);
    });

    it('isKillShellToolInput', () => {
      expect(isKillShellToolInput({ shell_id: 's1' })).toBe(true);
      expect(isKillShellToolInput(null)).toBe(false);
      expect(isKillShellToolInput('s1')).toBe(false);
      expect(isKillShellToolInput({})).toBe(false);
      expect(isKillShellToolInput({ shell_id: 1 })).toBe(false);
    });

    it('isTodoWriteToolInput', () => {
      expect(isTodoWriteToolInput({ todos: [] })).toBe(true);
      expect(isTodoWriteToolInput(null)).toBe(false);
      expect(isTodoWriteToolInput(1)).toBe(false);
      expect(isTodoWriteToolInput({})).toBe(false);
      expect(isTodoWriteToolInput({ todos: 'nope' })).toBe(false);
    });

    it('isAskUserQuestionToolInput', () => {
      expect(isAskUserQuestionToolInput({ questions: [] })).toBe(true);
      expect(isAskUserQuestionToolInput(null)).toBe(false);
      expect(isAskUserQuestionToolInput('q')).toBe(false);
      expect(isAskUserQuestionToolInput({})).toBe(false);
      expect(isAskUserQuestionToolInput({ questions: {} })).toBe(false);
    });

    it('isExitPlanModeToolInput', () => {
      expect(isExitPlanModeToolInput({ plan: 'do it' })).toBe(true);
      expect(isExitPlanModeToolInput(null)).toBe(false);
      expect(isExitPlanModeToolInput('plan')).toBe(false);
      expect(isExitPlanModeToolInput({})).toBe(false);
      expect(isExitPlanModeToolInput({ plan: 9 })).toBe(false);
    });
  });

  describe('output shape guards', () => {
    it('isTaskToolOutput', () => {
      expect(isTaskToolOutput({ result: 'done' })).toBe(true);
      expect(isTaskToolOutput(null)).toBe(false);
      expect(isTaskToolOutput('done')).toBe(false);
      expect(isTaskToolOutput({})).toBe(false);
      expect(isTaskToolOutput({ result: 1 })).toBe(false);
    });

    it('isBashToolOutput', () => {
      expect(isBashToolOutput({ output: 'x', exitCode: 0 })).toBe(true);
      expect(isBashToolOutput(null)).toBe(false);
      expect(isBashToolOutput('x')).toBe(false);
      expect(isBashToolOutput({ output: 'x' })).toBe(false);
    });

    it('isTodoWriteToolOutput', () => {
      expect(isTodoWriteToolOutput({ message: 'ok', stats: {} })).toBe(true);
      expect(isTodoWriteToolOutput(null)).toBe(false);
      expect(isTodoWriteToolOutput('ok')).toBe(false);
      expect(isTodoWriteToolOutput({ message: 'ok' })).toBe(false);
    });
  });
});
