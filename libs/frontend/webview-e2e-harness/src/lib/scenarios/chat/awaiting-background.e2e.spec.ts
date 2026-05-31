/**
 * Chat flow E2E specs: awaiting-background tab status (TASK_2026_137 Phase 3).
 *
 * Exercises the headline UX delivered by Phase 3 of the SDK-hook-driven
 * turn-end refactor:
 *   - When the backend emits `session:turnEnded` with non-empty
 *     `backgroundTasks`, the tab-bar pill MUST flip from `streaming` to
 *     `awaiting-background` (rendering the indicator atom and task count).
 *   - In `awaiting-background`, the chat input MUST remain ENABLED so the
 *     user can queue follow-ups or interrupt while subagents run (Claude
 *     CLI parity).
 *   - When the last in-flight subagent reports completion via
 *     `session:subagentEnded` with an empty `backgroundTasks` snapshot,
 *     the tab-bar pill MUST flip from `awaiting-background` to `loaded`.
 *
 * The harness fixture is intentionally decoupled from `@ptah-extension/shared`
 * (see webview-e2e-harness/CLAUDE.md), so this spec mounts a minimal
 * tab-bar + input surface and exercises the postmessage protocol shape
 * documented in `libs/shared/src/lib/types/messages/message-constants.ts`.
 */
import { test, expect } from '../../test-fixtures';

async function mountTabBarSurface(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(() => {
    const root = document.getElementById('ptah-e2e-fixture-root');
    if (!root) {
      throw new Error('fixture root missing');
    }
    root.innerHTML = `
      <div data-testid="tab-bar">
        <div data-testid="tab-pill" data-status="streaming">
          <span data-testid="tab-glyph" data-variant="streaming"></span>
          <span data-testid="tab-task-count" hidden></span>
        </div>
      </div>
      <div data-testid="chat-input-host">
        <textarea data-testid="chat-input" aria-label="Send a message"></textarea>
      </div>
    `;
    const pill = root.querySelector<HTMLDivElement>(
      '[data-testid="tab-pill"]',
    )!;
    const glyph = root.querySelector<HTMLSpanElement>(
      '[data-testid="tab-glyph"]',
    )!;
    const taskCount = root.querySelector<HTMLSpanElement>(
      '[data-testid="tab-task-count"]',
    )!;
    const input = root.querySelector<HTMLTextAreaElement>(
      '[data-testid="chat-input"]',
    )!;

    interface BackgroundTask {
      id: string;
      type: string;
      status: string;
      description: string;
    }
    interface TurnEndedPayload {
      sessionId: string;
      cwd: string;
      backgroundTasks: BackgroundTask[];
      sessionCrons: unknown[];
      terminalReason: string;
      timestamp: number;
    }
    interface SubagentEndedPayload {
      sessionId: string;
      cwd: string;
      agentId: string;
      agentType: string;
      lastAssistantMessage: string | null;
      backgroundTasks: BackgroundTask[];
      timestamp: number;
    }

    const setStatus = (
      status: 'streaming' | 'awaiting-background' | 'loaded',
      tasks: BackgroundTask[],
    ): void => {
      pill.dataset['status'] = status;
      if (status === 'awaiting-background') {
        glyph.dataset['variant'] = 'awaiting-background';
        taskCount.textContent = String(tasks.length);
        taskCount.hidden = false;
        input.disabled = false;
      } else if (status === 'loaded') {
        glyph.dataset['variant'] = 'loaded';
        taskCount.textContent = '';
        taskCount.hidden = true;
        input.disabled = false;
      } else {
        glyph.dataset['variant'] = 'streaming';
        taskCount.textContent = '';
        taskCount.hidden = true;
        input.disabled = false;
      }
    };

    window.addEventListener('message', (ev) => {
      const data = ev.data as { type?: string; payload?: unknown };
      if (!data || typeof data.type !== 'string') {
        return;
      }
      if (data.type === 'session:turnEnded') {
        const p = data.payload as TurnEndedPayload;
        if (p.backgroundTasks.length > 0) {
          setStatus('awaiting-background', p.backgroundTasks);
        } else {
          setStatus('loaded', []);
        }
      } else if (data.type === 'session:subagentEnded') {
        const p = data.payload as SubagentEndedPayload;
        if (p.backgroundTasks.length === 0) {
          setStatus('loaded', []);
        } else {
          setStatus('awaiting-background', p.backgroundTasks);
        }
      }
    });
  });
}

test.describe('chat awaiting-background flow', () => {
  test('streaming -> awaiting-background on turnEnded with backgroundTasks', async ({
    webviewPage,
    bridge,
  }) => {
    await mountTabBarSurface(webviewPage);
    const pill = webviewPage.getByTestId('tab-pill');
    const glyph = webviewPage.getByTestId('tab-glyph');
    const taskCount = webviewPage.getByTestId('tab-task-count');
    const input = webviewPage.getByTestId('chat-input');

    await expect(pill).toHaveAttribute('data-status', 'streaming');

    await bridge.inject({
      type: 'session:turnEnded',
      payload: {
        sessionId: 'sess-1',
        cwd: '/workspace',
        backgroundTasks: [
          {
            id: 'bg-1',
            type: 'subagent',
            status: 'running',
            description: 'mock subagent task',
          },
        ],
        sessionCrons: [],
        terminalReason: 'completed',
        timestamp: Date.now(),
      },
    });

    await expect(pill).toHaveAttribute('data-status', 'awaiting-background');
    await expect(glyph).toHaveAttribute('data-variant', 'awaiting-background');
    await expect(taskCount).toHaveText('1');
    await expect(input).toBeEnabled();
  });

  test('awaiting-background -> loaded on subagentEnded with empty backgroundTasks', async ({
    webviewPage,
    bridge,
  }) => {
    await mountTabBarSurface(webviewPage);
    const pill = webviewPage.getByTestId('tab-pill');
    const glyph = webviewPage.getByTestId('tab-glyph');
    const taskCount = webviewPage.getByTestId('tab-task-count');
    const input = webviewPage.getByTestId('chat-input');

    await bridge.inject({
      type: 'session:turnEnded',
      payload: {
        sessionId: 'sess-1',
        cwd: '/workspace',
        backgroundTasks: [
          {
            id: 'bg-1',
            type: 'subagent',
            status: 'running',
            description: 'mock subagent task',
          },
        ],
        sessionCrons: [],
        terminalReason: 'completed',
        timestamp: Date.now(),
      },
    });
    await expect(pill).toHaveAttribute('data-status', 'awaiting-background');

    await bridge.inject({
      type: 'session:subagentEnded',
      payload: {
        sessionId: 'sess-1',
        cwd: '/workspace',
        agentId: 'bg-1',
        agentType: 'subagent',
        lastAssistantMessage: null,
        backgroundTasks: [],
        timestamp: Date.now(),
      },
    });

    await expect(pill).toHaveAttribute('data-status', 'loaded');
    await expect(glyph).toHaveAttribute('data-variant', 'loaded');
    await expect(taskCount).toBeHidden();
    await expect(input).toBeEnabled();
  });

  test('turnEnded with empty backgroundTasks goes straight to loaded', async ({
    webviewPage,
    bridge,
  }) => {
    await mountTabBarSurface(webviewPage);
    const pill = webviewPage.getByTestId('tab-pill');
    const input = webviewPage.getByTestId('chat-input');

    await bridge.inject({
      type: 'session:turnEnded',
      payload: {
        sessionId: 'sess-1',
        cwd: '/workspace',
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: 'completed',
        timestamp: Date.now(),
      },
    });

    await expect(pill).toHaveAttribute('data-status', 'loaded');
    await expect(input).toBeEnabled();
  });
});
