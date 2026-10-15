import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import { SetupHubComponent } from './setup-hub.component';
import { HarnessWorkflowRequestService } from '../services/harness-workflow-request.service';

describe('SetupHubComponent entry handoff', () => {
  let fixture: ComponentFixture<SetupHubComponent>;
  const runningMode = signal<string | null>(null);
  const resumableMode = signal<string | null>(null);
  let requests: {
    requestAndNavigate: jest.Mock;
    hasRunningMode: jest.Mock;
    hasResumableMode: jest.Mock;
    dismissHubWarning: jest.Mock;
    dismissHubError: jest.Mock;
    hubWarning: ReturnType<typeof signal<string | null>>;
    hubError: ReturnType<typeof signal<string | null>>;
  };

  function element(id: string): HTMLElement {
    const found = fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
    if (!found) throw new Error(`Missing ${id}`);
    return found;
  }

  function click(id: string): void {
    element(id).click();
    fixture.detectChanges();
  }

  function fillWhat(value: string): void {
    const textarea = element('intake-what') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    runningMode.set(null);
    resumableMode.set(null);
    requests = {
      requestAndNavigate: jest.fn().mockResolvedValue('landed'),
      hasRunningMode: jest.fn((mode: string) => runningMode() === mode),
      hasResumableMode: jest.fn((mode: string) => resumableMode() === mode),
      dismissHubWarning: jest.fn(),
      dismissHubError: jest.fn(),
      hubWarning: signal<string | null>(null),
      hubError: signal<string | null>(null),
    };
    TestBed.configureTestingModule({
      imports: [SetupHubComponent],
      providers: [
        { provide: HarnessWorkflowRequestService, useValue: requests },
        { provide: AppStateManager, useValue: { setCurrentView: jest.fn() } },
        {
          provide: ClaudeRpcService,
          useValue: {
            call: jest.fn().mockResolvedValue({
              isSuccess: () => true,
              data: {
                isConfigured: false,
                hasClaudeConfig: false,
                presets: [],
              },
            }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(SetupHubComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('hands Configure to the adapter', async () => {
    await fixture.componentInstance.openHarnessBuilder();
    expect(requests.requestAndNavigate).toHaveBeenCalledWith({
      mode: 'configure-harness',
    });
  });

  it('submits validated intake to the adapter without calling start in the Hub', async () => {
    click('new-project-start');
    fillWhat('Clinic scheduler');
    click('intake-start');
    await fixture.whenStable();
    expect(requests.requestAndNavigate).toHaveBeenCalledWith({
      mode: 'new-project',
      intake: expect.objectContaining({
        what: 'Clinic scheduler',
        audience: 'unsure',
        stack: 'recommend',
      }),
    });
  });

  it('opens the existing confirm before handing a conflicting run to its builder dialog', async () => {
    runningMode.set('configure-harness');
    fixture.detectChanges();
    click('new-project-start');
    fillWhat('Clinic scheduler');
    click('intake-start');
    expect(element('new-project-discard-confirm').textContent).toContain(
      'Save as draft',
    );
    expect(requests.requestAndNavigate).not.toHaveBeenCalled();
    click('new-project-discard-confirm-button');
    await fixture.whenStable();
    expect(requests.requestAndNavigate).toHaveBeenCalledWith({
      mode: 'new-project',
      intake: expect.objectContaining({ what: 'Clinic scheduler' }),
    });
  });

  it('Cancel on the Hub confirm keeps the old run', () => {
    runningMode.set('configure-harness');
    fixture.detectChanges();
    click('new-project-start');
    fillWhat('Clinic scheduler');
    click('intake-start');
    element('new-project-discard-confirm').querySelector('button')?.click();
    fixture.detectChanges();
    expect(requests.requestAndNavigate).not.toHaveBeenCalled();
  });

  it('resumes New Project through the adapter', async () => {
    resumableMode.set('new-project');
    fixture.detectChanges();
    click('new-project-resume');
    await fixture.whenStable();
    expect(requests.requestAndNavigate).toHaveBeenCalledWith({
      mode: 'new-project',
    });
  });

  it('shows persistent warning and malformed-relay error lines until dismissed', () => {
    requests.hubWarning.set('Previous session could not be stopped');
    requests.hubError.set('Invalid builder request');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Previous session could not be stopped',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Invalid builder request',
    );
    fixture.nativeElement
      .querySelector('[aria-label="Dismiss session warning"]')
      .click();
    fixture.nativeElement
      .querySelector('[aria-label="Dismiss builder error"]')
      .click();
    expect(requests.dismissHubWarning).toHaveBeenCalledTimes(1);
    expect(requests.dismissHubError).toHaveBeenCalledTimes(1);
  });
});
