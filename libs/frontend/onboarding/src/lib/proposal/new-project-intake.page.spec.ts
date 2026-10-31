import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { NewProjectIntakePage } from './new-project-intake.page';
import { ProposalFlowStore } from './proposal-flow.store';

describe('NewProjectIntakePage', () => {
  const makePage = () =>
    TestBed.runInInjectionContext(() => new NewProjectIntakePage());
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            workspaceRoot: signal('/ws'),
            records: { readDraft: () => null },
            actionError: signal(null),
            leaveOpen: signal(false),
          },
        },
        { provide: Router, useValue: { navigate: jest.fn() } },
      ],
    }),
  );
  it('validates required brief and other stack on submit', async () => {
    const page = makePage();
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(page.errors()).toContain('What are you building is required.');
    page.what.set('A planning app');
    page.stack.set('other');
    expect(page.errors()).toContain('Enter your stack.');
  });
  it('resets stack and custom stack when platform changes', () => {
    const page = makePage();
    page.stack.set('other');
    page.stackOther.set('Rust');
    page.setPlatform('python');
    expect(page.stack()).toBe('recommend');
    expect(page.stackOther()).toBe('');
  });
  it('uses one registry option per stack, including the other platform', () => {
    const page = makePage();
    const labels = page.stackOptions().map((option) => option.label);
    expect(labels.filter((label) => label === 'Recommend for me')).toHaveLength(
      1,
    );
    expect(labels.filter((label) => label === 'Other')).toHaveLength(1);
    page.setPlatform('other');
    expect(page.stackOptions().map((option) => option.value)).toEqual([
      'recommend',
      'other',
    ]);
  });
  it('starts a valid brief and discards its new session when navigation is cancelled', async () => {
    const start = jest.fn().mockResolvedValue('new-tab');
    const discardCancelledStart = jest.fn().mockResolvedValue(undefined);
    TestBed.overrideProvider(ProposalFlowStore, {
      useValue: {
        workspaceRoot: signal('/ws'),
        records: { readDraft: () => null },
        actionError: signal(null),
        leaveOpen: signal(false),
        lastStartCreated: signal(true),
        start,
        discardCancelledStart,
      },
    });
    const navigate = jest.fn().mockResolvedValue(false);
    TestBed.overrideProvider(Router, { useValue: { navigate } });
    const page = makePage();
    page.what.set('Planning app');
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'new-project',
        workspaceRoot: '/ws',
        intake: expect.objectContaining({ what: 'Planning app' }),
      }),
    );
    expect(navigate).toHaveBeenCalled();
    expect(discardCancelledStart).toHaveBeenCalledTimes(1);
  });
});
