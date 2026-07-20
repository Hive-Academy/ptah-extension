import {
  isWorkflowTool,
  isAgentDispatchTool,
  isTaskManagementTool,
  isMonitorTool,
  isSendMessageTool,
  isScheduleWakeupTool,
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
});
