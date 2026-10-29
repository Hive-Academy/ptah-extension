import { TestBed } from '@angular/core/testing';
import { createHarness } from './integration-harness.testing';

describe('Command Center accessible page integration', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a canvas and a text work list with usable voice and text controls', async () => {
    const { fixture } = createHarness();
    await fixture.componentInstance.page.open();
    fixture.componentInstance.page.coordinator.chooseCurrentTab();
    // The work list lives behind the rail's Work tab.
    fixture.componentInstance.activeTab.set('work');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('canvas')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-command-work-list'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-command-voice-hud button'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        'ptah-command-session-controls input',
      ),
    ).not.toBeNull();
    fixture.destroy();
  });

  it('exposes every voice control as a named, enabled native button and routes each one', async () => {
    const { fixture } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    const start = jest.spyOn(page.voice, 'start').mockResolvedValue(true);
    const mute = jest.spyOn(page.voice, 'mute').mockResolvedValue(undefined);
    const stop = jest.spyOn(page.voice, 'stop').mockResolvedValue(undefined);
    const interrupt = jest.spyOn(page.voice, 'interruptSpeech');
    const buttons = (): HTMLButtonElement[] =>
      Array.from(
        fixture.nativeElement.querySelectorAll('ptah-command-voice-hud button'),
      );
    const named = (name: string): HTMLButtonElement | undefined =>
      buttons().find(
        (button) =>
          (button.getAttribute('aria-label') ?? button.textContent?.trim()) ===
          name,
      );
    const expectReachable = (button: HTMLButtonElement | undefined) => {
      expect(button).toBeDefined();
      expect(button?.disabled).toBe(false);
      expect(button?.getAttribute('tabindex')).not.toBe('-1');
    };

    page.store.setVoiceState('idle');
    fixture.detectChanges();
    expectReachable(named('Start voice'));
    named('Start voice')?.click();
    expect(start).toHaveBeenCalledTimes(1);

    page.store.setVoiceState('listening');
    fixture.detectChanges();
    expect(named('Stop listening')?.getAttribute('aria-pressed')).toBe('true');
    expectReachable(named('Mute'));
    expectReachable(named('Stop'));
    named('Mute')?.click();
    named('Stop')?.click();
    expect(mute).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);

    page.store.setVoiceState('speaking');
    fixture.detectChanges();
    expectReachable(named('Interrupt speech'));
    named('Interrupt speech')?.click();
    expect(interrupt).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('sends a typed command from the labelled text field using form submit', async () => {
    const { fixture, sender } = createHarness();
    await fixture.componentInstance.page.open();
    fixture.componentInstance.page.coordinator.chooseCurrentTab();
    fixture.detectChanges();
    const field: HTMLInputElement = fixture.nativeElement.querySelector(
      'ptah-command-session-controls input',
    );
    expect(
      fixture.nativeElement.querySelector('label[for="command-text"]')
        ?.textContent,
    ).toContain('Text command');
    field.value = 'Check the release plan';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('ptah-command-session-controls form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0]?.[0]).toBe('Check the release plan');
    fixture.destroy();
  });

  it('moves between work rows with the arrow keys, selects one with Enter and announces a state change as text', async () => {
    const { fixture, projectionInput } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    // The work list lives behind the rail's Work tab.
    fixture.componentInstance.activeTab.set('work');
    const rootSessionId = page.store.sessionId() ?? '';
    const children = (betaState: 'running' | 'completed') =>
      ['Alpha', 'Beta'].map((name) => ({
        tabId: `tab-${name}`,
        sessionId: `session-${name}`,
        parentSessionId: rootSessionId,
        state: name === 'Beta' ? betaState : ('running' as const),
        name,
      }));
    projectionInput.update((input) => ({
      ...input,
      children: children('running'),
    }));
    fixture.detectChanges();
    const rows = (): HTMLButtonElement[] =>
      Array.from(
        fixture.nativeElement.querySelectorAll(
          'ptah-command-work-list ul button',
        ),
      );
    expect(rows().map((row) => row.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
    ]);
    const key = (name: string) =>
      new KeyboardEvent('keydown', {
        key: name,
        bubbles: true,
        cancelable: true,
      });
    rows()[0]?.dispatchEvent(key('ArrowDown'));
    fixture.detectChanges();
    expect(document.activeElement).toBe(rows()[1]);
    expect(rows().map((row) => row.getAttribute('tabindex'))).toEqual([
      '-1',
      '0',
    ]);
    rows()[1]?.dispatchEvent(key('Enter'));
    fixture.detectChanges();
    expect(page.store.selectedId()).toBe('child:session-Beta');
    expect(
      fixture.nativeElement.querySelector('[aria-label="Selected work"]')
        ?.textContent,
    ).toContain('Beta');

    projectionInput.update((input) => ({
      ...input,
      children: children('completed'),
    }));
    fixture.detectChanges();
    fixture.detectChanges();
    const live = fixture.nativeElement.querySelector(
      'ptah-command-work-list [aria-live="polite"]',
    );
    expect(live?.textContent).toContain('Beta: completed');
    expect(rows()[1]?.textContent).toContain('completed');
    fixture.destroy();
  });

  it('renders a pending ordinary question as an accessible action', async () => {
    const { fixture, questions, chat, sender } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    questions.set([
      {
        id: 'q1',
        tabId: page.store.markedTabId() ?? '',
        questions: [
          {
            question: 'Which branch?',
            header: 'Branch',
            options: [],
            multiSelect: false,
          },
        ],
      },
    ]);
    TestBed.tick();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('#pending-title')?.textContent,
    ).toContain('Branch');
    expect(
      fixture.nativeElement.querySelector('#pending-answer'),
    ).not.toBeNull();
    expect(page.answerOrdinaryQuestion('q1', 'main')).toBe(true);
    expect(chat.handleQuestionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'q1' }),
      page.store.markedTabId(),
    );
    expect(sender.send).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
