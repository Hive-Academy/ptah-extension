import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MODEL_REFRESH_CONTROL, TabManagerService, type TerminalTurnPulse } from '@ptah-extension/chat-state';
import { NotificationService } from '@ptah-extension/core';
import { ChatFailedTurnAttentionService } from './chat-failed-turn-attention.service';

describe('ChatFailedTurnAttentionService', () => {
  it('drains every terminal pulse and projects only safe failed-turn notices', () => {
    const pulses = signal<readonly TerminalTurnPulse[]>([]);
    const takeTerminalTurnPulses = jest.fn(() => {
      const current = pulses();
      if (current.length) pulses.set([]);
      return current;
    });
    TestBed.configureTestingModule({ providers: [
      ChatFailedTurnAttentionService,
      { provide: MODEL_REFRESH_CONTROL, useValue: { refreshModels: jest.fn() } },
      { provide: TabManagerService, useValue: { terminalTurnPulses: pulses, takeTerminalTurnPulses } },
    ] });
    const notices = TestBed.inject(NotificationService);
    TestBed.inject(ChatFailedTurnAttentionService);
    TestBed.flushEffects();
    const base: TerminalTurnPulse = {
      seq: 1, tabId: 'tab', sessionId: 'session', workspacePath: '/workspace',
      revision: 1, phase: 'idle', terminalReason: 'completed',
      lastAssistantMessage: 'secret assistant text', classification: 'success',
      title: 'My session', occurredAt: 1,
    };
    pulses.set([base, { ...base, seq: 3, revision: 3, classification: 'error',
      terminalReason: 'aborted_streaming' }, { ...base, seq: 4, revision: 4,
      classification: 'error', terminalReason: 'aborted_tools' },
    ...(['background_requested', 'hook_stopped', 'stop_hook_prevented', 'tool_deferred', 'max_turns'] as const)
      .map((terminalReason, index) => ({ ...base, seq: 10 + index, revision: 10 + index,
        classification: 'error' as const, terminalReason })),
    { ...base, seq: 2, revision: 2, phase: 'failed',
      classification: 'error', terminalReason: 'model_error', lastAssistantMessage: 'private error' }]);
    TestBed.flushEffects();
    expect(pulses()).toEqual([]);
    expect(takeTerminalTurnPulses).toHaveBeenCalled();
    expect(notices.recentNotices()).toHaveLength(1);
    expect(notices.recentNotices()[0].key).toMatch(/^c:/);
    expect(notices.recentNotices()[0].title).toBe('Session failed: My session');
    expect(JSON.stringify(notices.recentNotices())).not.toMatch(/secret assistant text|private error|Finished/);
  });
});
