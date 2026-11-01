import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ProposalFlowStore } from './proposal-flow.store';
import { TeamBuilderStartPage } from './team-builder-start.page';

describe('TeamBuilderStartPage', () => {
  it('requires an intent and discards a new session when navigation is cancelled', async () => {
    const start = jest.fn().mockResolvedValue('new-tab');
    const discardCancelledStart = jest.fn().mockResolvedValue(undefined);
    const navigate = jest.fn().mockResolvedValue(false);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            workspaceRoot: signal('/ws'),
            records: { readDraft: () => null },
            actionError: signal(null),
            leaveOpen: signal(false),
            lastStartCreated: signal(true),
            start,
            discardCancelledStart,
          },
        },
        { provide: Router, useValue: { navigate } },
      ],
    });
    const page = TestBed.runInInjectionContext(
      () => new TeamBuilderStartPage(),
    );
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).not.toHaveBeenCalled();
    page.intent.set('A research team');
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).toHaveBeenCalledWith({
      mode: 'configure-harness',
      workspaceRoot: '/ws',
      intent: 'A research team',
    });
    expect(navigate).toHaveBeenCalled();
    expect(discardCancelledStart).toHaveBeenCalledTimes(1);
  });
});
