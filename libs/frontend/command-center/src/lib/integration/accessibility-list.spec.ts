import { TestBed } from '@angular/core/testing';
import { createHarness } from './integration-harness';

describe('Command Center accessible page integration', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a canvas and a text work list with usable voice and text controls', async () => {
    const { fixture } = createHarness();
    await fixture.componentInstance.page.open();
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

  it('renders a pending ordinary question as an accessible action', async () => {
    const { fixture, questions, chat, sender } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
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
