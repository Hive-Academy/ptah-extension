import { TestBed } from '@angular/core/testing';
import { createHarness } from './integration-harness';

describe('Command Center Tribunal confirmation integration', () => {
  afterEach(() => TestBed.resetTestingModule());

  function proposal(nonce: string, options = ['Decline', 'Confirm']): string {
    return `<TRIBUNAL_ROSTER_PROPOSAL>${JSON.stringify({
      proposalId: 'p1',
      nonce,
      rootSessionId: '11111111-1111-4111-8111-111111111111',
      move: 'relay',
      options,
      objective: 'Review',
      rounds: 1,
      lanes: [
        {
          laneId: 'codex#1',
          family: 'codex',
          displayName: 'Codex 1',
          cli: 'codex',
          role: 'plan',
        },
        {
          laneId: 'codex#2',
          family: 'codex',
          displayName: 'Codex 2',
          cli: 'codex',
          role: 'architect',
        },
        {
          laneId: 'codex#3',
          family: 'codex',
          displayName: 'Codex 3',
          cli: 'codex',
          role: 'implement',
        },
        {
          laneId: 'copilot#1',
          family: 'copilot',
          displayName: 'Copilot',
          cli: 'copilot',
          role: 'review',
        },
      ],
    })}</TRIBUNAL_ROSTER_PROPOSAL>`;
  }

  it('rejects wrong nonce and non-Decline-first proposals', async () => {
    const { fixture, questions, transport, sender } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    await page.sendCommand('Relay review');
    questions.set([
      {
        id: 'wrong',
        tabId: page.store.markedTabId() ?? '',
        questions: [
          {
            question: proposal('wrong'),
            header: 'Tribunal',
            options: [],
            multiSelect: false,
          },
        ],
      },
    ]);
    TestBed.tick();
    expect(page.pendingProposal()).toBeNull();
    const nonce =
      /"nonce":"([^"]+)"/.exec(sender.send.mock.calls.at(-1)?.[0] ?? '')?.[1] ??
      '';
    questions.set([
      {
        id: 'bad-order',
        tabId: page.store.markedTabId() ?? '',
        questions: [
          {
            question: proposal(nonce, ['Confirm', 'Decline']),
            header: 'Tribunal',
            options: [],
            multiSelect: false,
          },
        ],
      },
    ]);
    TestBed.tick();
    expect(page.pendingProposal()).toBeNull();
    expect(
      transport.answer.mock.calls.every((call) => call[2] === 'Decline'),
    ).toBe(true);
    fixture.destroy();
  });

  it('launches once only after a card click, with task and manifest registered first', async () => {
    jest.useFakeTimers();
    try {
      const { fixture, questions, transport, sender } = createHarness();
      const page = fixture.componentInstance.page;
      await page.open();
      await page.sendCommand('Relay review');
      const nonce =
        /"nonce":"([^"]+)"/.exec(
          sender.send.mock.calls.at(-1)?.[0] ?? '',
        )?.[1] ?? '';
      questions.set([
        {
          id: 'q1',
          tabId: page.store.markedTabId() ?? '',
          questions: [
            {
              question: proposal(nonce),
              header: 'Tribunal',
              options: [],
              multiSelect: false,
            },
          ],
        },
      ]);
      TestBed.tick();
      fixture.detectChanges();
      expect(page.pendingProposal()?.proposalId).toBe('p1');
      const order: string[] = [];
      transport.answer.mockImplementation(() => {
        order.push('answer');
        return true;
      });
      transport.createTask.mockImplementation(async () => {
        order.push('task');
        return 'task-1';
      });
      transport.writeManifest.mockImplementation(() => {
        order.push('manifest');
        return true;
      });
      transport.sendLaunchTurn.mockImplementation(async () => {
        order.push('launch');
        return true;
      });
      const button = Array.from(
        fixture.nativeElement.querySelectorAll(
          'button',
        ) as NodeListOf<HTMLButtonElement>,
      ).find((item) => item.textContent?.includes('Confirm Tribunal'));
      expect(button).toBeDefined();
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
      await page.confirmProposal('p1');
      expect(order).toEqual(['answer', 'task', 'manifest', 'launch']);
      expect(transport.answer.mock.calls[0]?.[2]).not.toMatch(
        /confirm|yes|approve/i,
      );
      expect(transport.sendLaunchTurn).toHaveBeenCalledTimes(1);
      expect(
        sender.send.mock.calls.some((call) => /^Confirm$/i.test(call[0])),
      ).toBe(false);
      fixture.destroy();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('never treats a spoken yes as card confirmation and declines on exit', async () => {
    jest.useFakeTimers();
    try {
      const { fixture, questions, transport, sender } = createHarness();
      const page = fixture.componentInstance.page;
      await page.open();
      await page.sendCommand('Relay review');
      const nonce =
        /"nonce":"([^"]+)"/.exec(
          sender.send.mock.calls.at(-1)?.[0] ?? '',
        )?.[1] ?? '';
      questions.set([
        {
          id: 'q1',
          tabId: page.store.markedTabId() ?? '',
          questions: [
            {
              question: proposal(nonce),
              header: 'Tribunal',
              options: [],
              multiSelect: false,
            },
          ],
        },
      ]);
      TestBed.tick();
      await page.sendCommand('yes');
      expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
      await page.exit();
      expect(transport.answer).toHaveBeenCalledWith(
        'q1',
        expect.any(String),
        'Decline',
      );
      fixture.destroy();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('declines an unanswered proposal on timeout and clears its card', async () => {
    jest.useFakeTimers();
    try {
      const { fixture, questions, transport, sender } = createHarness();
      const page = fixture.componentInstance.page;
      await page.open();
      await page.sendCommand('Relay review');
      const nonce =
        /"nonce":"([^"]+)"/.exec(
          sender.send.mock.calls.at(-1)?.[0] ?? '',
        )?.[1] ?? '';
      questions.set([
        {
          id: 'q1',
          tabId: page.store.markedTabId() ?? '',
          questions: [
            {
              question: proposal(nonce),
              header: 'Tribunal',
              options: [],
              multiSelect: false,
            },
          ],
        },
      ]);
      TestBed.tick();
      expect(page.pendingProposal()?.proposalId).toBe('p1');
      page.timeoutProposal('p1');
      expect(transport.answer).toHaveBeenCalledWith(
        'q1',
        expect.any(String),
        'Decline',
      );
      expect(page.pendingProposal()).toBeNull();
      fixture.destroy();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
