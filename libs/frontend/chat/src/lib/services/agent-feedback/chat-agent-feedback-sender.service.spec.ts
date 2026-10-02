import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ChatStore } from '../chat.store';
import { ChatAgentFeedbackSender } from './chat-agent-feedback-sender.service';

describe('ChatAgentFeedbackSender', () => {
  const activeTab = { id: 'tab-a', claudeSessionId: 'session-a' };
  const otherTab = { id: 'tab-b', claudeSessionId: 'session-b' };
  const backgroundTab = { id: 'tab-bg', claudeSessionId: 'session-bg' };

  const sendOrQueueMessage = jest.fn();
  const switchTab = jest.fn();
  const findBySession = jest.fn();
  let activeTabId: string | null;
  let sender: ChatAgentFeedbackSender;

  beforeEach(() => {
    activeTabId = activeTab.id;
    sendOrQueueMessage.mockReset().mockResolvedValue({ success: true });
    switchTab.mockReset();
    findBySession.mockReset().mockImplementation((sessionId: string) => {
      if (sessionId === otherTab.claudeSessionId) {
        return { tab: otherTab, workspacePath: '/ws/active' };
      }
      if (sessionId === backgroundTab.claudeSessionId) {
        return { tab: backgroundTab, workspacePath: '/ws/background' };
      }
      if (sessionId === activeTab.claudeSessionId) {
        return { tab: activeTab, workspacePath: '/ws/active' };
      }
      return null;
    });
    TestBed.configureTestingModule({
      providers: [
        ChatAgentFeedbackSender,
        { provide: ChatStore, useValue: { sendOrQueueMessage } },
        {
          provide: TabManagerService,
          useValue: {
            activeTabId: () => activeTabId,
            tabs: () => [activeTab, otherTab],
            findTabBySessionIdAcrossWorkspaces: findBySession,
            switchTab,
          },
        },
      ],
    });
    sender = TestBed.inject(ChatAgentFeedbackSender);
  });

  it('sends to the active tab for the active target', async () => {
    await expect(sender.send('active', 'fix line 3')).resolves.toEqual({
      sent: true,
    });
    expect(sendOrQueueMessage).toHaveBeenCalledWith('fix line 3', {
      tabId: 'tab-a',
    });
    expect(switchTab).not.toHaveBeenCalled();
  });

  it('fails without sending when no tab is active', async () => {
    activeTabId = null;
    const result = await sender.send('active', 'fix line 3');
    expect(result.sent).toBe(false);
    expect(result.error).toBeTruthy();
    expect(sendOrQueueMessage).not.toHaveBeenCalled();
  });

  it('switches to the session tab in the active workspace before sending', async () => {
    switchTab.mockImplementation(() => {
      expect(sendOrQueueMessage).not.toHaveBeenCalled();
    });
    await expect(
      sender.send({ sessionId: 'session-b' }, 'feedback'),
    ).resolves.toEqual({ sent: true });
    expect(switchTab).toHaveBeenCalledWith('tab-b');
    expect(sendOrQueueMessage).toHaveBeenCalledWith('feedback', {
      tabId: 'tab-b',
    });
  });

  it('does not switch when the session tab is already active', async () => {
    await sender.send({ sessionId: 'session-a' }, 'feedback');
    expect(switchTab).not.toHaveBeenCalled();
    expect(sendOrQueueMessage).toHaveBeenCalledWith('feedback', {
      tabId: 'tab-a',
    });
  });

  it('sends to a background-workspace tab in place without switching', async () => {
    await expect(
      sender.send({ sessionId: 'session-bg' }, 'feedback'),
    ).resolves.toEqual({ sent: true });
    expect(switchTab).not.toHaveBeenCalled();
    expect(sendOrQueueMessage).toHaveBeenCalledWith('feedback', {
      tabId: 'tab-bg',
    });
  });

  it('fails when the session has no open tab', async () => {
    const result = await sender.send({ sessionId: 'missing' }, 'feedback');
    expect(result).toEqual({
      sent: false,
      error: 'That session is not open in a chat tab.',
    });
    expect(sendOrQueueMessage).not.toHaveBeenCalled();
  });

  it('fails on blank text without sending', async () => {
    const result = await sender.send('active', '   ');
    expect(result.sent).toBe(false);
    expect(sendOrQueueMessage).not.toHaveBeenCalled();
  });

  it('maps a rejected send outcome to sent:false with its error', async () => {
    sendOrQueueMessage.mockResolvedValue({
      success: false,
      error: 'AUTH_REQUIRED',
    });
    await expect(sender.send('active', 'feedback')).resolves.toEqual({
      sent: false,
      error: 'AUTH_REQUIRED',
    });
  });

  it('resolves sent:false instead of rejecting when the send throws', async () => {
    sendOrQueueMessage.mockRejectedValue(new Error('transport down'));
    await expect(sender.send('active', 'feedback')).resolves.toEqual({
      sent: false,
      error: 'transport down',
    });
  });

  it('resolves sent:false with a fallback message for a non-Error throw', async () => {
    sendOrQueueMessage.mockRejectedValue('boom');
    const result = await sender.send('active', 'feedback');
    expect(result.sent).toBe(false);
    expect(result.error).toBe('The message could not be sent.');
  });
});
