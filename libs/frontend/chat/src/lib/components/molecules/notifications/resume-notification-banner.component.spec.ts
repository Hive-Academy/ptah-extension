import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SubagentRecord } from '@ptah-extension/shared';
import { ResumeNotificationBannerComponent } from './resume-notification-banner.component';

const agent = (toolCallId: string): SubagentRecord =>
  ({
    toolCallId,
    agentId: `agent-${toolCallId}`,
    agentType: 'Explore',
    parentSessionId: 'sess-a',
  }) as SubagentRecord;

describe('ResumeNotificationBannerComponent', () => {
  let fixture: ComponentFixture<ResumeNotificationBannerComponent>;

  function render(agents: SubagentRecord[]): HTMLElement {
    TestBed.configureTestingModule({
      imports: [ResumeNotificationBannerComponent],
    });
    fixture = TestBed.createComponent(ResumeNotificationBannerComponent);
    fixture.componentRef.setInput('resumableSubagents', agents);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const dismissButton = (host: HTMLElement): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss interrupted agents notification"]',
    );

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing when there are no interrupted agents', () => {
    const host = render([]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('emits every listed agent on dismiss and keeps no hidden state of its own', () => {
    const agents = [agent('tc-1'), agent('tc-2')];
    const host = render(agents);
    const emitted = jest.fn();
    fixture.componentInstance.dismissRequested.subscribe(emitted);

    dismissButton(host)?.click();
    fixture.detectChanges();

    expect(emitted).toHaveBeenCalledWith(agents);
    // Still visible until the parent removes the agents from its list.
    expect(host.querySelector('[role="alert"]')).not.toBeNull();

    fixture.componentRef.setInput('resumableSubagents', []);
    fixture.detectChanges();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('emits a copy, not the input array itself', () => {
    const agents = [agent('tc-1')];
    const host = render(agents);
    const emitted = jest.fn();
    fixture.componentInstance.dismissRequested.subscribe(emitted);

    dismissButton(host)?.click();

    expect(emitted.mock.calls[0][0]).not.toBe(agents);
  });

  it('emits resume for a single agent and resume-all for the list', () => {
    const agents = [agent('tc-1'), agent('tc-2')];
    const host = render(agents);
    const resume = jest.fn();
    const resumeAll = jest.fn();
    fixture.componentInstance.resumeRequested.subscribe(resume);
    fixture.componentInstance.resumeAllRequested.subscribe(resumeAll);

    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Resume Explore agent agent-tc-2"]',
      )
      ?.click();
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Resume all interrupted agents"]',
      )
      ?.click();

    expect(resume).toHaveBeenCalledWith(agents[1]);
    expect(resumeAll).toHaveBeenCalledWith(agents);
  });
});
