/**
 * SetupHubComponent — New Project intake (TASK_2026_263).
 *
 * Three things are pinned here:
 *   1. The intake gate: "Start planning" stays disabled until the one required
 *      answer exists, so the flow can never start from an empty description.
 *   2. The call site: submitting goes through the TYPED
 *      `HarnessRpcService.startNewProject` wrapper, which had been dead code
 *      while the component issued the raw `rpc.call` itself.
 *   3. The cross-mode guard: starting a New Project while a Configure Harness
 *      run is live asks before destroying it, rather than either silently
 *      dropping the request or silently killing the other run.
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  ClaudeRpcService,
  WebviewNavigationService,
} from '@ptah-extension/core';
import { STACK_PROFILES, getStackProfile } from '@ptah-extension/shared';
import type { NewProjectIntake } from '@ptah-extension/shared';
import { HarnessRpcService } from '../services/harness-rpc.service';
import { HarnessWorkflowService } from '../services/harness-workflow.service';
import { SetupHubComponent } from './setup-hub.component';

interface WorkflowStub {
  isActive: ReturnType<typeof signal<boolean>>;
  isProcessing: ReturnType<typeof signal<boolean>>;
  viewMode: ReturnType<typeof signal<string>>;
  abortAndDispose: jest.Mock;
}

describe('SetupHubComponent — New Project intake', () => {
  let fixture: ComponentFixture<SetupHubComponent>;
  let harnessRpc: { startNewProject: jest.Mock };
  let workflow: WorkflowStub;
  let navigation: { navigateToView: jest.Mock };

  function el(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function required(testId: string): HTMLElement {
    const found = el(testId);
    if (!found) throw new Error(`No element with data-testid="${testId}"`);
    return found;
  }

  function click(testId: string): void {
    required(testId).click();
    fixture.detectChanges();
  }

  /**
   * The stack chip values currently on screen, in order. Buttons only — the
   * free-text input for `other` shares its sibling chip's testid.
   */
  function stackChipValues(): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll<HTMLElement>(
        'button[data-testid^="intake-stack-"]',
      ),
    ).map((chip) =>
      (chip.dataset['testid'] ?? '').replace('intake-stack-', ''),
    );
  }

  function typeWhat(text: string): void {
    const textarea = required('intake-what') as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    harnessRpc = {
      startNewProject: jest.fn().mockResolvedValue({ success: true }),
    };
    workflow = {
      isActive: signal(false),
      isProcessing: signal(false),
      viewMode: signal('configure-harness'),
      abortAndDispose: jest.fn().mockResolvedValue(undefined),
    };
    navigation = { navigateToView: jest.fn().mockResolvedValue(undefined) };

    TestBed.configureTestingModule({
      imports: [SetupHubComponent],
      providers: [
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
        { provide: HarnessRpcService, useValue: harnessRpc },
        { provide: HarnessWorkflowService, useValue: workflow },
        { provide: WebviewNavigationService, useValue: navigation },
      ],
    });

    fixture = TestBed.createComponent(SetupHubComponent);
    // ngOnInit fires the status/presets RPCs; the cards only render once the
    // first load has resolved.
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ---- intake validation ---------------------------------------------------

  it('keeps "Start planning" disabled until the description is filled', () => {
    click('new-project-start');
    expect(el('new-project-intake')).not.toBeNull();

    expect((required('intake-start') as HTMLButtonElement).disabled).toBe(true);

    typeWhat('A scheduling tool for physiotherapy clinics');
    expect((required('intake-start') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('re-disables the button when the description is cleared again', () => {
    click('new-project-start');
    typeWhat('something');
    typeWhat('   ');

    expect((required('intake-start') as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires the free-text stack when "other" is selected', () => {
    click('new-project-start');
    typeWhat('A scheduling tool');
    click('intake-stack-other');

    expect((required('intake-start') as HTMLButtonElement).disabled).toBe(true);
  });

  // ---- platform → stack derivation (TASK_2026_270 Batch 4) -----------------

  it('renders one platform chip per registered stack profile, plus Other', () => {
    click('new-project-start');

    const ids = Array.from(
      fixture.nativeElement.querySelectorAll<HTMLElement>(
        '[data-testid^="intake-platform-"]',
      ),
    ).map((chip) => chip.dataset['testid']);

    expect(ids).toEqual([
      ...STACK_PROFILES.map((profile) => `intake-platform-${profile.id}`),
      'intake-platform-other',
    ]);
  });

  it('opens on Node/TypeScript, so the stack chips are the ones they always were', () => {
    click('new-project-start');

    expect(stackChipValues()).toEqual([
      'recommend',
      'angular-nestjs',
      'react-nestjs',
      'other',
    ]);
  });

  it('re-renders the stack chips from the selected platform’s profile', () => {
    click('new-project-start');
    click('intake-platform-dotnet');

    expect(stackChipValues()).toEqual(
      getStackProfile('dotnet').stackOptions.map((option) => option.value),
    );
    // The Node chips are gone, not merely deselected.
    expect(el('intake-stack-angular-nestjs')).toBeNull();
  });

  it('falls back to the two platform-independent chips for Other', () => {
    click('new-project-start');
    click('intake-platform-other');

    expect(stackChipValues()).toEqual(['recommend', 'other']);
  });

  it('resets the stack when the platform changes under it', async () => {
    click('new-project-start');
    typeWhat('A claims processing service');
    click('intake-stack-angular-nestjs');
    // `angular-nestjs` has no chip under .NET; leaving it selected would submit
    // a stack the user can no longer see.
    click('intake-platform-dotnet');
    click('intake-start');
    await fixture.whenStable();

    expect(harnessRpc.startNewProject).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'dotnet', stack: 'recommend' }),
    );
  });

  it('submits the platform once it is no longer the default', async () => {
    click('new-project-start');
    typeWhat('A claims processing service');
    click('intake-platform-dotnet');
    click('intake-stack-aspnetcore-api');
    click('intake-start');
    await fixture.whenStable();
    fixture.detectChanges();

    const expected: NewProjectIntake = {
      what: 'A claims processing service',
      audience: 'unsure',
      platform: 'dotnet',
      stack: 'aspnetcore-api',
    };
    expect(harnessRpc.startNewProject).toHaveBeenCalledWith(expected);
  });

  it('omits the platform entirely while it is still Node/TypeScript', async () => {
    click('new-project-start');
    typeWhat('A scheduling tool');
    // Selecting the default explicitly must still produce the pre-Batch-4
    // payload — that is what keeps the existing e2e suite a valid bar.
    click('intake-platform-dotnet');
    click('intake-platform-node-ts');
    click('intake-start');
    await fixture.whenStable();

    const [sent] = harnessRpc.startNewProject.mock.calls[0] as [
      NewProjectIntake,
    ];
    expect('platform' in sent).toBe(false);
  });

  it('clears a stale free-text stack when the platform changes', async () => {
    click('new-project-start');
    typeWhat('A claims processing service');
    click('intake-stack-other');
    // Chip and input share the testid (mirrors the e2e spec) — reach the
    // input by tag.
    const freeText = fixture.nativeElement.querySelector(
      'input[data-testid="intake-stack-other"]',
    ) as HTMLInputElement;
    freeText.value = 'Ruby on Rails';
    freeText.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    click('intake-platform-python');
    click('intake-stack-django');
    click('intake-start');
    await fixture.whenStable();

    const [sent] = harnessRpc.startNewProject.mock.calls[0] as [
      NewProjectIntake,
    ];
    expect(sent).toMatchObject({ platform: 'python', stack: 'django' });
    expect(sent.stackOther).toBeUndefined();
  });

  // ---- submit --------------------------------------------------------------

  it('submits through the typed startNewProject wrapper with the exact intake', async () => {
    click('new-project-start');
    typeWhat('A scheduling tool for physiotherapy clinics');
    click('intake-audience-b2b');
    click('intake-stack-angular-nestjs');

    click('intake-start');
    await fixture.whenStable();
    fixture.detectChanges();

    const expected: NewProjectIntake = {
      what: 'A scheduling tool for physiotherapy clinics',
      audience: 'b2b',
      stack: 'angular-nestjs',
    };
    expect(harnessRpc.startNewProject).toHaveBeenCalledTimes(1);
    expect(harnessRpc.startNewProject).toHaveBeenCalledWith(expected);
    // The backend broadcast drives navigation; the modal must not linger.
    expect(el('new-project-intake')).toBeNull();
  });

  it('keeps the modal open and shows the reason when the start fails', async () => {
    harnessRpc.startNewProject.mockResolvedValueOnce({
      success: false,
      error: 'no provider configured',
    });

    click('new-project-start');
    typeWhat('A scheduling tool');
    click('intake-start');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el('new-project-intake')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'no provider configured',
    );
  });

  it('shows the reason when the wrapper throws', async () => {
    harnessRpc.startNewProject.mockRejectedValueOnce(
      new Error('transport exploded'),
    );

    click('new-project-start');
    typeWhat('A scheduling tool');
    click('intake-start');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('transport exploded');
  });

  // ---- resume state --------------------------------------------------------

  it('offers Resume instead of Start while a New Project run is active', () => {
    workflow.isActive.set(true);
    workflow.viewMode.set('new-project');
    fixture.detectChanges();

    expect(el('new-project-resume')).not.toBeNull();
    expect(el('new-project-start')).toBeNull();

    click('new-project-resume');
    expect(navigation.navigateToView).toHaveBeenCalledWith('harness-builder');
    expect(harnessRpc.startNewProject).not.toHaveBeenCalled();
  });

  // ---- cross-mode confirm --------------------------------------------------

  it('asks before discarding a live Configure Harness run', () => {
    workflow.isActive.set(true);
    workflow.viewMode.set('configure-harness');
    fixture.detectChanges();

    // A configure-harness run is not a New Project run, so the card still
    // offers Start — the conflict is resolved at submit time, not here.
    click('new-project-start');
    typeWhat('A scheduling tool');
    click('intake-start');

    expect(el('new-project-discard-confirm')).not.toBeNull();
    expect(workflow.abortAndDispose).not.toHaveBeenCalled();
    expect(harnessRpc.startNewProject).not.toHaveBeenCalled();
  });

  it('cancelling the discard leaves the other workflow alone', () => {
    workflow.isActive.set(true);
    workflow.viewMode.set('configure-harness');
    fixture.detectChanges();

    click('new-project-start');
    typeWhat('A scheduling tool');
    click('intake-start');
    required('new-project-discard-confirm')
      .querySelectorAll('button')[0]
      .click();
    fixture.detectChanges();

    expect(el('new-project-discard-confirm')).toBeNull();
    expect(workflow.abortAndDispose).not.toHaveBeenCalled();
    expect(harnessRpc.startNewProject).not.toHaveBeenCalled();
  });

  it('confirming tears the other workflow down BEFORE starting the new one', async () => {
    workflow.isActive.set(true);
    workflow.viewMode.set('configure-harness');
    fixture.detectChanges();

    const order: string[] = [];
    workflow.abortAndDispose.mockImplementation(async () => {
      order.push('abortAndDispose');
    });
    harnessRpc.startNewProject.mockImplementation(async () => {
      order.push('startNewProject');
      return { success: true };
    });

    click('new-project-start');
    typeWhat('A scheduling tool');
    click('intake-start');
    click('new-project-discard-confirm-button');
    await fixture.whenStable();
    fixture.detectChanges();

    // Ordering matters: the open request races the still-claimed surface if the
    // old workflow has not released it yet.
    expect(order).toEqual(['abortAndDispose', 'startNewProject']);
    expect(harnessRpc.startNewProject).toHaveBeenCalledWith(
      expect.objectContaining({ what: 'A scheduling tool' }),
    );
  });

  it('does not start the new project when the old one refuses to stop', async () => {
    workflow.isActive.set(true);
    workflow.viewMode.set('configure-harness');
    workflow.abortAndDispose.mockRejectedValueOnce(new Error('abort failed'));
    fixture.detectChanges();

    click('new-project-start');
    typeWhat('A scheduling tool');
    click('intake-start');
    click('new-project-discard-confirm-button');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(harnessRpc.startNewProject).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('abort failed');
  });
});
