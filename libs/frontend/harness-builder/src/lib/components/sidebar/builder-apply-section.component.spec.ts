import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoggingService } from '@ptah-extension/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import { HarnessProposalHydrationService } from '../../services/harness-proposal-hydration.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';
import { BuilderApplySectionComponent } from './builder-apply-section.component';

describe('BuilderApplySectionComponent workspace targeting', () => {
  it('applies to the original case-sensitive UNC path', async () => {
    const originalRoot = '\\\\wsl.localhost\\Ubuntu\\home\\User\\Proj';
    const apply = jest
      .fn()
      .mockResolvedValue({ appliedPaths: [], warnings: [] });
    TestBed.configureTestingModule({
      imports: [BuilderApplySectionComponent],
      providers: [
        { provide: HarnessRpcService, useValue: { apply } },
        {
          provide: HarnessProposalHydrationService,
          useValue: {
            config: signal({ name: 'Proj' }),
            isConfigComplete: signal(true),
          },
        },
        {
          provide: HarnessHealthStore,
          useValue: {
            loading: signal(false),
            summary: signal({ level: 'unknown', label: '' }),
            refresh: jest.fn(),
          },
        },
        { provide: LoggingService, useValue: { error: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(BuilderApplySectionComponent);
    fixture.componentRef.setInput('workspaceRoot', originalRoot);
    fixture.componentRef.setInput('initialized', true);
    fixture.detectChanges();
    const button = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('button.btn-primary');
    expect(button).not.toBeNull();
    button?.click();
    await fixture.whenStable();
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: originalRoot,
      }),
    );
  });
});

describe('BuilderApplySectionComponent explicit config contract', () => {
  it('uses config input and emits applied response after a successful apply', async () => {
    const response = { appliedPaths: ['/workspace/a/CLAUDE.md'], warnings: [] };
    const apply = jest.fn().mockResolvedValue(response);
    TestBed.configureTestingModule({
      imports: [BuilderApplySectionComponent],
      providers: [
        { provide: HarnessRpcService, useValue: { apply } },
        { provide: HarnessProposalHydrationService, useValue: { config: signal({ name: 'Old' }), isConfigComplete: signal(true) } },
        { provide: HarnessHealthStore, useValue: { loading: signal(false), summary: signal({ level: 'unknown', label: '' }), refresh: jest.fn() } },
        { provide: LoggingService, useValue: { error: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(BuilderApplySectionComponent);
    const applied: Array<typeof response> = [];
    fixture.componentInstance.applied.subscribe((value) => applied.push(value));
    fixture.componentRef.setInput('workspaceRoot', '/workspace/a');
    fixture.componentRef.setInput('initialized', true);
    fixture.componentRef.setInput('config', { name: 'Chosen' });
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.btn-primary')?.click();
    await fixture.whenStable();
    expect(apply.mock.calls[0][0].config.name).toBe('Chosen');
    expect(applied).toEqual([response]);
  });
});
